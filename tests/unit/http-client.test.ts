import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessage, postJson } from "@/lib/http-client";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

const NO_DELAY = { retryDelaysMs: [0] };

/** 실패해야 하는 호출의 ApiError를 돌려준다 (성공하면 테스트 실패). */
const failureOf = (promise: Promise<unknown>): Promise<ApiError> =>
  promise.then(
    () => {
      throw new Error("실패해야 하는 요청이 성공했습니다");
    },
    (error: ApiError) => error,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("postJson", () => {
  it("성공 응답 본문을 돌려주고 JSON으로 POST한다", async () => {
    const fetch = mockFetch(json(201, { sessionId: "s1" }));
    await expect(postJson("/api/sessions", { mode: "ALL" })).resolves.toEqual({ sessionId: "s1" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ mode: "ALL" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("서버 오류 메시지(검증 오류는 첫 항목)를 ApiError로 던진다", async () => {
    mockFetch(json(400, { error: { code: "BAD_REQUEST", message: "요청 값이 올바르지 않습니다.", issues: [{ message: "닉네임은 2~12자여야 합니다." }] } }));
    const error = await failureOf(postJson("/x", {}));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "BAD_REQUEST", message: "닉네임은 2~12자여야 합니다." });
  });

  it.each([400, 404, 409, 413, 429])("%i 응답은 다시 보내지 않는다 (서버가 판단한 결과)", async (status) => {
    const fetch = mockFetch(json(status, { error: { code: "X", message: "m" } }), json(200, {}));
    await expect(postJson("/x", {}, { retries: 2, ...NO_DELAY })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([502, 503, 504])("%i 응답은 retries만큼 다시 보내고, 성공하면 결과를 돌려준다", async (status) => {
    const fetch = mockFetch(json(status, {}), json(200, { ok: 1 }));
    await expect(postJson("/x", {}, { retries: 2, ...NO_DELAY })).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("네트워크 오류도 다시 보낸다", async () => {
    const fetch = mockFetch(new TypeError("Failed to fetch"), json(200, { ok: 1 }));
    await expect(postJson("/x", {}, { retries: 1, ...NO_DELAY })).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("재시도를 모두 실패하면 마지막 실패를 한국어 메시지로 던진다 (원문 'Failed to fetch' 노출 안 함)", async () => {
    const fetch = mockFetch(new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch"));
    const error = await failureOf(postJson("/x", {}, { retries: 2, ...NO_DELAY }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
    expect(error.message).toContain("네트워크");
    expect(error.message).not.toContain("Failed to fetch");
  });

  it("retries를 주지 않으면(멱등이 아닌 요청) 한 번만 보낸다", async () => {
    const fetch = mockFetch(json(503, {}), json(200, {}));
    await expect(postJson("/x", {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("응답이 제한 시간 안에 오지 않으면 TIMEOUT으로 실패한다", async () => {
    // 실제 fetch처럼 signal이 중단되면 그 사유로 거절한다.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    ));
    const error = await failureOf(postJson("/x", {}, { timeoutMs: 20 }));
    expect(error).toMatchObject({ status: 0, code: "TIMEOUT" });
    expect(error.message).toContain("응답이 늦어지고");
  });

  it("503의 Retry-After를 따르되 5초까지만 기다린다", async () => {
    vi.useFakeTimers();
    const fetch = mockFetch(json(503, {}, { "retry-after": "60" }), json(200, { ok: 1 }));
    const pending = postJson("/x", {}, { retries: 1, retryDelaysMs: [500] });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("본문이 JSON이 아닌 오류 응답(프록시 HTML 등)도 일반 안내로 바꾼다", async () => {
    mockFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await failureOf(postJson("/x", {}));
    expect(error).toMatchObject({ status: 502 });
    expect(error.message).toContain("서버가 잠시 응답할 수 없어요");
  });
});

describe("errorMessage", () => {
  it("ApiError가 아닌 오류는 내부 메시지 대신 일반 안내를 보여 준다", () => {
    expect(errorMessage(new ApiError("서버 메시지", 400))).toBe("서버 메시지");
    expect(errorMessage(new Error("Cannot read properties of undefined"))).toContain("예상하지 못한 오류");
  });
});

describe("postJson: 네트워크·시간 제한 경계", () => {
  it("AbortSignal.timeout이 없는 오래된 브라우저에서도 시간 제한이 동작한다", async () => {
    const original = AbortSignal.timeout;
    // @ts-expect-error 오래된 브라우저 흉내
    AbortSignal.timeout = undefined;
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
      ));
      const error = await failureOf(postJson("/x", {}, { timeoutMs: 20 }));
      expect(error).toMatchObject({ status: 0, code: "TIMEOUT" });
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it("500 응답의 본문이 JSON이 아니면 일반 안내를 보여 주고 다시 보내지 않는다", async () => {
    const fetch = mockFetch(new Response("Internal Server Error", { status: 500 }), json(200, {}));
    const error = await failureOf(postJson("/x", {}, { retries: 2, ...NO_DELAY }));
    expect(error.status).toBe(500);
    expect(error.message).toBe("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["날짜 형식", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["숫자 아님", "soon"],
    ["0", "0"],
    ["음수", "-5"],
  ])("Retry-After가 %s이면 무시하고 기본 재시도 간격을 쓴다", async (_label, retryAfter) => {
    vi.useFakeTimers();
    const fetch = mockFetch(json(503, {}, { "retry-after": retryAfter }), json(200, { ok: 1 }));
    const pending = postJson("/x", {}, { retries: 1, retryDelaysMs: [300] });
    await vi.advanceTimersByTimeAsync(299);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: 1 });
  });

  it("재시도 간격 배열이 비어 있어도 예외 없이 바로 다시 보낸다", async () => {
    const fetch = mockFetch(json(503, {}), json(200, { ok: 1 }));
    await expect(postJson("/x", {}, { retries: 1, retryDelaysMs: [] })).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("성공 응답의 본문이 비어 있으면 null을 돌려준다 (예외로 바꾸지 않음)", async () => {
    mockFetch(new Response(null, { status: 200 }));
    await expect(postJson("/x", {})).resolves.toBeNull();
  });

  it("fetch가 Error가 아닌 값을 던져도 네트워크 오류로 정리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("connection reset"));
    const error = await failureOf(postJson("/x", {}));
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("마지막 재시도까지 503이면 마지막 서버 응답의 오류를 던진다", async () => {
    const fetch = mockFetch(
      json(503, { error: { code: "SERVICE_UNAVAILABLE", message: "첫 번째" } }),
      json(503, { error: { code: "SERVICE_UNAVAILABLE", message: "마지막" } }),
    );
    const error = await failureOf(postJson("/x", {}, { retries: 1, ...NO_DELAY }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE", message: "마지막" });
  });
});
