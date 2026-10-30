import { describe, expect, it } from "vitest";
import { periodStart } from "@/lib/leaderboard-period";

const at = (iso: string) => new Date(iso);
const start = (period: "all" | "weekly" | "daily", iso: string) => periodStart(period, at(iso))?.toISOString() ?? null;

// 2026-10-26(월)~11-01(일). 한국 시간 = UTC+9
describe("periodStart", () => {
  it("전체 기간은 시작 시각이 없다", () => {
    expect(start("all", "2026-10-30T03:00:00Z")).toBeNull();
  });

  it("일일: 한국 시간 오늘 0시 (UTC로는 전날 15시)", () => {
    expect(start("daily", "2026-10-30T03:00:00Z")).toBe("2026-10-29T15:00:00.000Z");
  });

  it("일일 경계: 0시 정각은 그날, 1ms 전은 전날", () => {
    expect(start("daily", "2026-10-29T15:00:00.000Z")).toBe("2026-10-29T15:00:00.000Z");
    expect(start("daily", "2026-10-29T14:59:59.999Z")).toBe("2026-10-28T15:00:00.000Z");
  });

  it("UTC 날짜가 아니라 한국 날짜로 자른다 (UTC 10/29 20시 = 한국 10/30 05시)", () => {
    expect(start("daily", "2026-10-29T20:00:00Z")).toBe("2026-10-29T15:00:00.000Z");
  });

  it("주간: 한국 시간 이번 주 월요일 0시", () => {
    expect(start("weekly", "2026-10-30T03:00:00Z")).toBe("2026-10-25T15:00:00.000Z"); // 금요일
    expect(start("weekly", "2026-11-01T14:59:59.999Z")).toBe("2026-10-25T15:00:00.000Z"); // 일요일 끝
  });

  it("주간 경계: 월요일 0시 정각은 새 주, 1ms 전(일요일)은 지난주", () => {
    expect(start("weekly", "2026-10-25T15:00:00.000Z")).toBe("2026-10-25T15:00:00.000Z");
    expect(start("weekly", "2026-10-25T14:59:59.999Z")).toBe("2026-10-18T15:00:00.000Z");
  });

  it("UTC로는 일요일이어도 한국 시간이 월요일이면 새 주다", () => {
    expect(start("weekly", "2026-10-25T20:00:00Z")).toBe("2026-10-25T15:00:00.000Z");
  });

  it("월·연도가 바뀌는 주도 이어서 센다 (2026-01-01은 목요일)", () => {
    expect(start("weekly", "2026-01-01T00:00:00Z")).toBe("2025-12-28T15:00:00.000Z");
  });

  it("유효하지 않은 시각이면 RangeError", () => {
    expect(() => periodStart("daily", new Date(NaN))).toThrow(RangeError);
    expect(() => periodStart("weekly", new Date("not a date"))).toThrow(RangeError);
  });

  it("Date 범위 끝: 가장 늦은 시각은 계산되고, 가장 이른 시각의 주 시작은 표현할 수 없어 RangeError", () => {
    expect(periodStart("weekly", new Date(8.64e15))?.getTime()).toBeLessThanOrEqual(8.64e15);
    expect(() => periodStart("weekly", new Date(-8.64e15))).toThrow(RangeError);
    expect(periodStart("all", new Date(NaN))).toBeNull();
  });
});
