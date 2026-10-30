import { describe, expect, it } from "vitest";
import {
  buildResultSummary,
  sessionQuestionInfos,
  UNKNOWN_CATEGORY,
  type SessionQuestionInfo,
} from "@/lib/quiz/summary";
import { shuffle } from "@/lib/shuffle";

describe("shuffle", () => {
  it("원본 배열을 바꾸지 않고 같은 원소를 모두 담은 새 배열을 돌려준다", () => {
    const items = [1, 2, 3, 4, 5];
    const result = shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual(items);
  });

  it("주입한 random에 따라 Fisher–Yates 순서로 섞는다", () => {
    // random() = 0이면 매 단계 i번째와 0번째를 바꾼다.
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
    // random()이 1에 가까우면 j = i가 되어 순서가 그대로다.
    expect(shuffle([1, 2, 3, 4], () => 0.999)).toEqual([1, 2, 3, 4]);
  });
});

describe("buildResultSummary", () => {
  const questions: SessionQuestionInfo[] = [
    { id: 11, categoryName: "과학", categorySortOrder: 2 },
    { id: 1, categoryName: "한국사", categorySortOrder: 1 },
    { id: 12, categoryName: "과학", categorySortOrder: 2 },
    { id: 2, categoryName: "한국사", categorySortOrder: 1 },
  ];

  it("점수·정답률·카테고리별 정답 수를 계산하고 카테고리 순서대로 정렬한다", () => {
    const summary = buildResultSummary(questions, [
      { questionId: 11, isCorrect: true },
      { questionId: 1, isCorrect: true },
      { questionId: 12, isCorrect: false },
      { questionId: 2, isCorrect: true },
    ]);

    expect(summary).toEqual({
      score: 30,
      maxScore: 40,
      correctCount: 3,
      answeredCount: 4,
      totalCount: 4,
      accuracy: 75,
      byCategory: [
        { category: "한국사", correct: 2, total: 2 },
        { category: "과학", correct: 1, total: 2 },
      ],
    });
  });

  it("답하지 않은 문제는 오답으로 세고 total에는 포함한다", () => {
    const summary = buildResultSummary(questions, [{ questionId: 1, isCorrect: true }]);
    expect(summary.correctCount).toBe(1);
    expect(summary.answeredCount).toBe(1);
    expect(summary.totalCount).toBe(4);
    expect(summary.accuracy).toBe(25);
  });

  it("세션에 없는 문제의 답안은 점수에 반영하지 않는다", () => {
    const summary = buildResultSummary(questions, [{ questionId: 999, isCorrect: true }]);
    expect(summary.correctCount).toBe(0);
    expect(summary.score).toBe(0);
  });
});

describe("sessionQuestionInfos (만점 기준 = 출제된 문제 목록)", () => {
  const rows = [
    { id: 2, category: { name: "한국사", sortOrder: 1 } },
    { id: 11, category: { name: "과학", sortOrder: 2 } },
  ];

  it("출제 순서대로, 문제마다 카테고리 정보를 붙인다", () => {
    expect(sessionQuestionInfos([11, 2], rows)).toEqual([
      { id: 11, categoryName: "과학", categorySortOrder: 2 },
      { id: 2, categoryName: "한국사", categorySortOrder: 1 },
    ]);
  });

  it("정보를 찾지 못한 문제도 빠뜨리지 않아 총 문제 수(만점)가 줄지 않는다", () => {
    const infos = sessionQuestionInfos([11, 2, 99], rows);
    expect(infos).toHaveLength(3);
    expect(infos[2]).toMatchObject({ id: 99, categoryName: UNKNOWN_CATEGORY });

    const summary = buildResultSummary(infos, [
      { questionId: 11, isCorrect: true },
      { questionId: 2, isCorrect: true },
      { questionId: 99, isCorrect: true },
    ]);
    expect(summary).toMatchObject({ totalCount: 3, maxScore: 30, correctCount: 3, score: 30 });
    // 카테고리별 합계가 총 문제 수와 같다 (알 수 없음은 맨 뒤)
    expect(summary.byCategory.reduce((sum, c) => sum + c.total, 0)).toBe(summary.totalCount);
    expect(summary.byCategory.at(-1)).toEqual({ category: UNKNOWN_CATEGORY, correct: 1, total: 1 });
  });
});
