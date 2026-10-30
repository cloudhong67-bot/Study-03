import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BODY_READ_TIMEOUT_MS, DB_UNAVAILABLE_RETRY_AFTER_SECONDS, handle, readJson } from "@/lib/api";
import { isTransientDatabaseError } from "@/lib/db-errors";
import { DB_TIMEOUT_DEFAULTS, withDbTimeouts } from "@/lib/prisma";

const CLIENT_VERSION = "6.19.3";
const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`error ${code}`, { code, clientVersion: CLIENT_VERSION });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DB 일시 장애 → 503 + Retry-After", () => {
  it.each(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"])("%s는 일시 장애로 본다", (code) => {
    expect(isTransientDatabaseError(known(code))).toBe(true);
  });

  it("연결 초기화 실패도 일시 장애로 본다", () => {
    expect(isTransientDatabaseError(new Prisma.PrismaClientInitializationError("no db", CLIENT_VERSION))).toBe(true);
  });

  it.each(["P2002", "P2025"])("데이터 오류 %s는 일시 장애가 아니다", (code) => {
    expect(isTransientDatabaseError(known(code))).toBe(false);
  });

  it("handle()은 일시 장애를 503·Retry-After로, 그 밖의 예외는 500으로 응답한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const unavailable = await handle(async () => {
      throw known("P1001");
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Retry-After")).toBe(String(DB_UNAVAILABLE_RETRY_AFTER_SECONDS));
    expect((await unavailable.json()).error.code).toBe("SERVICE_UNAVAILABLE");

    const bug = await handle(async () => {
      throw new TypeError("boom");
    });
    expect(bug.status).toBe(500);
    expect(await bug.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." } });
  });
});

describe("요청 본문 읽기 실패", () => {
  const streamRequest = (stream: ReadableStream<Uint8Array>) =>
    new Request("http://localhost/api/x", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node(undici)는 스트림 본문에 duplex 지정이 필요하다
      duplex: "half",
    });

  it("클라이언트가 전송 중에 끊으면 500이 아니라 400 (BAD_REQUEST)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"mode":'));
        controller.error(new Error("socket hang up"));
      },
    });
    await expect(readJson(streamRequest(stream))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it(`본문이 ${BODY_READ_TIMEOUT_MS / 1000}초 안에 다 오지 않으면 408 (REQUEST_TIMEOUT)`, async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"mode":'));
        // 나머지를 보내지 않고 연결을 붙잡아 둔다
      },
    });
    const pending = readJson(streamRequest(stream));
    const assertion = expect(pending).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS);
    await assertion;
  });
});

describe("DB 연결 문자열 시간 제한 기본값", () => {
  it("지정하지 않은 시간 제한만 채운다", () => {
    const url = new URL(withDbTimeouts("postgresql://u:p@db:5432/trivia?sslmode=require&socket_timeout=30"));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("socket_timeout")).toBe("30");
    expect(url.searchParams.get("connect_timeout")).toBe(DB_TIMEOUT_DEFAULTS.connect_timeout);
    expect(url.searchParams.get("pool_timeout")).toBe(DB_TIMEOUT_DEFAULTS.pool_timeout);
  });

  it("해석할 수 없는 값은 그대로 둔다 (Prisma가 원래 오류를 내도록)", () => {
    expect(withDbTimeouts("not a url")).toBe("not a url");
  });
});

describe("요청 본문 경계", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/x", { method: "POST", body, headers });

  it("본문이 아예 없는 POST는 400 (JSON 아님)", async () => {
    await expect(readJson(post(null))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("숫자가 아닌 Content-Length는 무시하고 실제 본문을 읽는다", async () => {
    await expect(readJson(post('{"a":1}', { "content-length": "abc" }))).resolves.toEqual({ a: 1 });
  });

  it("정확히 4096바이트는 받고, 4097바이트는 413 (바이트 기준, 한글 3바이트 포함)", async () => {
    const make = (bytes: number) => {
      const prefix = '{"p":"';
      const suffix = '"}';
      const body = prefix + "가".repeat(1000); // 3,000바이트
      const ascii = bytes - Buffer.byteLength(body + suffix);
      return body + "a".repeat(ascii) + suffix;
    };
    const exact = make(4096);
    expect(Buffer.byteLength(exact)).toBe(4096);
    await expect(readJson(post(exact))).resolves.toHaveProperty("p");
    await expect(readJson(post(make(4097)))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("JSON의 __proto__ 키로 Object.prototype을 오염시킬 수 없다", async () => {
    const parsed = (await readJson(post('{"mode":"ALL","__proto__":{"polluted":true}}'))) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it.each(["null", "[]", "42", '"ALL"', "true"])("객체가 아닌 JSON %s도 읽기는 성공하고(검증은 스키마가 담당) 예외가 나지 않는다", async (text) => {
    await expect(readJson(post(text))).resolves.toEqual(JSON.parse(text));
  });
});
