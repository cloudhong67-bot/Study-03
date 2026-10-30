// 브라우저에서 API를 호출할 때 쓰는 공용 클라이언트 (서버 전용 모듈을 import하지 않는다).
import { sleep } from "@/lib/async";

/** 응답이 이 시간 안에 오지 않으면 포기한다. 모바일 네트워크를 고려해 넉넉히 잡는다. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** 재시도 사이 대기 시간 (n번째 재시도에 n번째 값, 모자라면 마지막 값). */
export const DEFAULT_RETRY_DELAYS_MS = [500, 1500];
/** 서버가 보낸 Retry-After를 따르되, 화면이 너무 오래 멈춰 있지 않도록 이 값까지만 기다린다. */
const MAX_RETRY_AFTER_MS = 5_000;
/** 잠시 뒤 다시 보내면 성공할 수 있는 응답 (게이트웨이·서버 일시 장애). 4xx는 재시도하지 않는다. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export type ApiErrorCode = string; // 서버의 error.code 또는 "TIMEOUT" | "NETWORK_ERROR"

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    /** HTTP 상태. 응답을 받지 못했으면 0 */
    readonly status: number,
    readonly code?: ApiErrorCode,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  /**
   * 실패 시 다시 보낼 횟수. **같은 요청을 여러 번 보내도 결과가 같은(멱등) API에만** 0보다 크게 준다.
   * (답안 제출·점수 등록은 서버가 재전송을 인식해 처음 결과를 돌려주므로 안전하다.)
   */
  retries?: number;
  retryDelaysMs?: number[];
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController(); // AbortSignal.timeout이 없는 오래된 브라우저
  setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
  return controller.signal;
}

function fallbackMessage(status: number): string {
  if (status === 503 || status === 502 || status === 504) {
    return "서버가 잠시 응답할 수 없어요. 잠시 후 다시 시도해 주세요.";
  }
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function networkFailure(error: unknown): ApiError {
  const name = (error as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new ApiError("서버 응답이 늦어지고 있어요. 네트워크 상태를 확인하고 다시 시도해 주세요.", 0, "TIMEOUT");
  }
  return new ApiError("네트워크에 연결할 수 없어요. 연결 상태를 확인하고 다시 시도해 주세요.", 0, "NETWORK_ERROR");
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
}

/**
 * JSON을 POST하고 성공 응답 본문을 돌려준다. 실패하면 항상 ApiError(사용자에게 보여 줄 한국어 메시지)를 던진다.
 * - 시간 초과·네트워크 오류·502/503/504는 retries만큼 다시 보낸다 (Retry-After가 있으면 그만큼 기다림)
 * - 4xx는 서버가 판단을 내린 것이므로 다시 보내지 않는다
 */
export async function postJson<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = options;

  for (let attempt = 0; ; attempt++) {
    let failure: ApiError;
    let waitMs = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 0;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: timeoutSignal(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) return data as T;

      const message = data?.error?.issues?.[0]?.message ?? data?.error?.message ?? fallbackMessage(response.status);
      failure = new ApiError(message, response.status, data?.error?.code);
      if (!RETRYABLE_STATUS.has(response.status)) throw failure;
      waitMs = Math.max(waitMs, retryAfterMs(response) ?? 0);
    } catch (error) {
      if (error instanceof ApiError) throw error; // 재시도하지 않는 서버 응답
      failure = networkFailure(error);
    }
    if (attempt >= retries) throw failure;
    await sleep(waitMs);
  }
}

/** 화면에 보여 줄 메시지. ApiError가 아닌 예상 밖의 오류도 일반 안내로 바꾼다. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "예상하지 못한 오류가 발생했어요. 다시 시도해 주세요.";
}
