import { describe, expect, it } from "vitest";
import {
  calculateAccuracy,
  calculateMaxScore,
  calculateScore,
} from "@/lib/scoring";

describe("scoring", () => {
  it("문제당 10점으로 점수를 계산한다", () => {
    expect(calculateScore(7)).toBe(70);
  });

  it("카테고리 모드는 100점, 전체 모드는 400점 만점이다", () => {
    expect(calculateMaxScore(10)).toBe(100);
    expect(calculateMaxScore(40)).toBe(400);
  });

  it("정답률을 소수점 첫째 자리까지 계산한다", () => {
    expect(calculateAccuracy(1, 3)).toBe(33.3);
    expect(calculateAccuracy(0, 0)).toBe(0);
  });
});
