import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "@/lib/async";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("제한 시간 안에 끝나면 결과를 그대로 돌려준다", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("원래 작업의 오류는 그대로 전달한다", async () => {
    await expect(withTimeout(Promise.reject(new Error("db down")), 1000)).rejects.toThrow("db down");
  });

  it("제한 시간을 넘기면 TimeoutError로 거절한다", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 3000);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("시간 초과 뒤에 원래 작업이 실패해도 처리되지 않은 거절(unhandled rejection)이 생기지 않는다", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let failLater!: (e: Error) => void;
      const slow = new Promise((_, reject) => (failLater = reject));
      await expect(withTimeout(slow, 10)).rejects.toBeInstanceOf(TimeoutError);
      failLater(new Error("late failure"));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("먼저 끝나면 타이머를 정리한다", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
