// 정리 작업 실행기의 시간 예산·실패 처리. DB 대신 정리 함수 자체를 모킹해 느림·실패를 재현한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupExpiredSessions: vi.fn<() => Promise<number>>(),
  pruneRateLimits: vi.fn<() => Promise<number>>(),
}));
vi.mock("@/lib/quiz/sessions", () => ({ cleanupExpiredSessions: mocks.cleanupExpiredSessions }));
vi.mock("@/lib/rate-limit", () => ({ pruneRateLimits: mocks.pruneRateLimits }));

import { createMaintenanceRunner } from "@/lib/maintenance";

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.cleanupExpiredSessions.mockReset().mockResolvedValue(0);
  mocks.pruneRateLimits.mockReset().mockResolvedValue(0);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMaintenanceRunner", () => {
  it("정리할 것이 없으면 로그를 남기지 않는다", async () => {
    await expect(createMaintenanceRunner(0, 1000)()).resolves.toBe(true);
    expect(info).not.toHaveBeenCalled();
  });

  it("지운 것이 있으면 개수를 기록한다", async () => {
    mocks.cleanupExpiredSessions.mockResolvedValue(3);
    mocks.pruneRateLimits.mockResolvedValue(7);
    await createMaintenanceRunner(0, 1000)();
    expect(info).toHaveBeenCalledWith("[maintenance] removed", { sessions: 3, rateLimits: 7 });
  });

  it("예산을 넘기면 기다리지 않고 먼저 반환하고, 정리는 뒤에서 마저 끝낸다", async () => {
    mocks.cleanupExpiredSessions.mockImplementation(() => settle(100).then(() => 5));
    const started = performance.now();
    await expect(createMaintenanceRunner(0, 20)()).resolves.toBe(true);
    expect(performance.now() - started).toBeLessThan(90);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("still running after 20ms"));

    await settle(150); // 백그라운드 작업이 끝날 때까지
    expect(mocks.pruneRateLimits).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("[maintenance] removed", { sessions: 5, rateLimits: 0 });
  });

  it("정리 작업이 실패해도 예외를 던지지 않고 기록만 한다 (사용자 요청은 계속)", async () => {
    mocks.cleanupExpiredSessions.mockRejectedValue(new Error("db down"));
    await expect(createMaintenanceRunner(0, 1000)()).resolves.toBe(true);
    expect(error).toHaveBeenCalledWith("[maintenance] failed", expect.objectContaining({ message: "db down" }));
    expect(mocks.pruneRateLimits).not.toHaveBeenCalled();
  });

  it("예산을 넘긴 뒤에 실패해도 처리되지 않은 거절(unhandled rejection)이 생기지 않는다", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      mocks.cleanupExpiredSessions.mockImplementation(() =>
        settle(60).then(() => Promise.reject(new Error("late failure"))),
      );
      await createMaintenanceRunner(0, 10)();
      await settle(120);
      expect(unhandled).toEqual([]);
      expect(error).toHaveBeenCalledWith("[maintenance] failed", expect.objectContaining({ message: "late failure" }));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("간격 안의 호출은 실행하지 않고 false, 간격이 지나면 다시 실행한다", async () => {
    const runIfDue = createMaintenanceRunner(1000, 100);
    const t0 = new Date("2026-10-30T00:00:00Z");
    expect(await runIfDue(t0)).toBe(true);
    expect(await runIfDue(new Date(t0.getTime() + 999))).toBe(false);
    expect(mocks.cleanupExpiredSessions).toHaveBeenCalledTimes(1);
    expect(await runIfDue(new Date(t0.getTime() + 1000))).toBe(true);
    expect(mocks.cleanupExpiredSessions).toHaveBeenCalledTimes(2);
  });

  it("실행기마다 마지막 실행 시각을 따로 가진다", async () => {
    const a = createMaintenanceRunner(60_000, 100);
    const b = createMaintenanceRunner(60_000, 100);
    expect(await a()).toBe(true);
    expect(await b()).toBe(true);
  });
});
