// 라우트 핸들러 공통: 오류 → HTTP 응답 변환, 요청 본문·경로 파라미터 읽기
import { NextResponse } from "next/server";
import { z } from "zod";
import { isTransientDatabaseError } from "@/lib/db-errors";
import { AppError, type ErrorCode } from "@/lib/errors";
import { sessionNotFound } from "@/lib/quiz/sessions";
import { sessionIdSchema } from "@/lib/validation";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
};

/**
 * JSON 요청 본문 상한. 가장 큰 정상 요청도 수십 바이트 수준이므로 넉넉히 4KB로 둔다.
 * 상한이 없으면 큰 본문을 반복해서 보내는 것만으로 서버 메모리를 소모시킬 수 있다.
 */
export const MAX_JSON_BODY_BYTES = 4 * 1024;

/** 본문을 이 시간 안에 다 받지 못하면 408 (본문을 아주 천천히 보내 연결을 붙잡아 두는 것을 막는다). */
export const BODY_READ_TIMEOUT_MS = 10_000;

/** DB에 일시적으로 닿지 않을 때 클라이언트에 다시 시도하라고 알려 주는 대기 시간(초). */
export const DB_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

export type SessionRouteContext = { params: Promise<{ id: string }> };

function errorResponse(status: number, code: string, message: string, issues?: unknown) {
  return NextResponse.json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

/**
 * 핸들러에서 던진 오류를 PRD 9장 규칙(400 / 404 / 408 / 409 / 413 / 429 / 503)에 맞는 응답으로 바꾼다.
 * 어떤 예외도 처리되지 않은 채 Next.js까지 올라가지 않는다.
 */
export async function handle(fn: () => Promise<unknown>, successStatus = 200) {
  try {
    const result = await fn();
    if (result instanceof WithStatus) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json(result, { status: successStatus });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return errorResponse(400, "BAD_REQUEST", "요청 값이 올바르지 않습니다.", issues);
    }
    if (error instanceof AppError) {
      const response = errorResponse(STATUS_BY_CODE[error.code], error.code, error.message);
      if (error.retryAfterSeconds !== undefined) {
        response.headers.set("Retry-After", String(error.retryAfterSeconds));
      }
      return response;
    }
    if (isTransientDatabaseError(error)) {
      console.warn("[api] database temporarily unavailable:", (error as Error).message.split("\n")[0]);
      const response = errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "서버가 잠시 응답할 수 없어요. 잠시 후 다시 시도해 주세요.",
      );
      response.headers.set("Retry-After", String(DB_UNAVAILABLE_RETRY_AFTER_SECONDS));
      return response;
    }
    console.error(error);
    return errorResponse(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.");
  }
}

/** 핸들러가 성공 상태 코드를 직접 정할 때 쓴다 (예: 같은 요청을 다시 보낸 경우 201 대신 200). */
export class WithStatus<T = unknown> {
  constructor(
    readonly body: T,
    readonly status: number,
  ) {}
}

function payloadTooLarge() {
  return new AppError("PAYLOAD_TOO_LARGE", `요청 본문은 ${MAX_JSON_BODY_BYTES}바이트를 넘을 수 없습니다.`);
}

/**
 * 상한까지만, 제한 시간 안에만 읽는다.
 * - Content-Length가 없거나 거짓이어도 상한을 넘는 순간 읽기를 멈춘다 (413)
 * - 클라이언트가 전송 중에 끊으면 400, BODY_READ_TIMEOUT_MS 안에 다 오지 않으면 408
 */
async function readBodyWithLimit(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, BODY_READ_TIMEOUT_MS);

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (timedOut) throw requestTimeout();
    throw new AppError("BAD_REQUEST", "요청 본문을 읽지 못했습니다. 다시 시도해 주세요.");
  } finally {
    clearTimeout(timer);
  }
  // cancel()은 대기 중인 read()를 done으로 끝내므로, 오류 없이 빠져나와도 시간 초과였는지 확인한다.
  if (timedOut) throw requestTimeout();
  return Buffer.concat(chunks).toString("utf8");
}

function requestTimeout() {
  return new AppError("REQUEST_TIMEOUT", "요청 본문을 제시간에 받지 못했습니다. 다시 시도해 주세요.");
}

/** 본문을 JSON으로 읽고 zod 스키마로 검증한다 (검증 실패는 handle()이 400으로 바꾼다). */
export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  return schema.parse(await readJson(request));
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await readBodyWithLimit(request, MAX_JSON_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("BAD_REQUEST", "요청 본문이 올바른 JSON이 아닙니다.");
  }
}

/** UUID 형식이 아닌 세션 id는 존재하지 않는 세션과 같게 404로 처리한다. */
export async function readSessionId(context: SessionRouteContext): Promise<string> {
  const { id } = await context.params;
  const parsed = sessionIdSchema.safeParse(id);
  if (!parsed.success) throw sessionNotFound();
  return parsed.data;
}
