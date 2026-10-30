import { describe, expect, it } from "vitest";
import {
  type AnswerRecord,
  buildResultSummary,
  scoreSession,
  sessionQuestionInfos,
  UNKNOWN_CATEGORY,
  type SessionQuestionInfo,
} from "@/lib/quiz/summary";
import { shuffle } from "@/lib/shuffle";

/** 힌트 없이, 시간 보너스 없이 답한 답안 */
const answer = (questionId: number, isCorrect: boolean): AnswerRecord => ({
  questionId,
  isCorrect,
  elapsedMs: null,
  hintUsed: false,
});

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
    { id: 11, categoryName: "과학", categorySortOrder: 2, difficulty: "EASY" },
    { id: 1, categoryName: "한국사", categorySortOrder: 1, difficulty: "EASY" },
    { id: 12, categoryName: "과학", categorySortOrder: 2, difficulty: "EASY" },
    { id: 2, categoryName: "한국사", categorySortOrder: 1, difficulty: "EASY" },
  ];

  it("점수·정답률·카테고리별 정답 수를 계산하고 카테고리 순서대로 정렬한다", () => {
    const summary = buildResultSummary(questions, [
      answer(11, true),
      answer(1, true),
      answer(12, false),
      answer(2, true),
    ]);

    expect(summary).toEqual({
      // 정답 3개 × (기본 10 + 힌트 미사용 2), 3번째에서 끊겨 콤보 없음
      score: 36,
      // 4문제 × (10 + 3 + 2) + 3연속 콤보 2
      maxScore: 62,
      breakdown: { base: 30, time: 0, hint: 6, combo: 0 },
      maxStreak: 2,
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
    const summary = buildResultSummary(questions, [answer(1, true)]);
    expect(summary.correctCount).toBe(1);
    expect(summary.answeredCount).toBe(1);
    expect(summary.totalCount).toBe(4);
    expect(summary.accuracy).toBe(25);
  });

  it("세션에 없는 문제의 답안은 점수에 반영하지 않는다", () => {
    const summary = buildResultSummary(questions, [answer(999, true)]);
    expect(summary.correctCount).toBe(0);
    expect(summary.score).toBe(0);
  });

  it("연속 정답은 답한 순서가 아니라 출제 순서로 센다", () => {
    // 출제 순서 11, 1, 12, 2 → 앞의 세 문제를 맞히면 3연속 콤보
    const summary = buildResultSummary(questions, [answer(12, true), answer(1, true), answer(11, true)]);
    expect(summary.breakdown.combo).toBe(2);
    expect(summary.maxStreak).toBe(3);
  });
});

describe("scoreSession", () => {
  const questions: SessionQuestionInfo[] = [
    { id: 5, categoryName: "한국사", categorySortOrder: 1, difficulty: "HARD" },
    { id: 7, categoryName: "한국사", categorySortOrder: 1, difficulty: "MEDIUM" },
  ];

  it("출제 순서대로 문제별 점수를 매기고, 답하지 않은 문제는 null", () => {
    expect(scoreSession(questions, [{ questionId: 5, isCorrect: true, elapsedMs: 3000, hintUsed: true }])).toEqual([
      { base: 20, time: 3, hint: 0, combo: 0, total: 23, streak: 1 },
      null,
    ]);
  });

  it("문제 정보의 난이도를 쓴다 (답안 쪽에는 난이도가 없다)", () => {
    expect(scoreSession(questions, [answer(7, true)])[1]?.base).toBe(15);
  });
});

describe("sessionQuestionInfos (만점 기준 = 출제된 문제 목록)", () => {
  const rows = [
    { id: 2, difficulty: "HARD" as const, category: { name: "한국사", sortOrder: 1 } },
    { id: 11, difficulty: "EASY" as const, category: { name: "과학", sortOrder: 2 } },
  ];

  it("출제 순서대로, 문제마다 카테고리 정보를 붙인다", () => {
    expect(sessionQuestionInfos([11, 2], rows)).toEqual([
      { id: 11, categoryName: "과학", categorySortOrder: 2, difficulty: "EASY" },
      { id: 2, categoryName: "한국사", categorySortOrder: 1, difficulty: "HARD" },
    ]);
  });

  it("정보를 찾지 못한 문제도 빠뜨리지 않아 총 문제 수(만점)가 줄지 않는다", () => {
    const infos = sessionQuestionInfos([11, 2, 99], rows);
    expect(infos).toHaveLength(3);
    expect(infos[2]).toEqual({
      id: 99,
      categoryName: UNKNOWN_CATEGORY,
      categorySortOrder: Number.MAX_SAFE_INTEGER,
      difficulty: "MEDIUM",
    });

    const summary = buildResultSummary(infos, [answer(11, true), answer(2, true), answer(99, true)]);
    // 기본 10 + 20 + 15, 힌트 미사용 2 × 3, 3연속 콤보 2 / 만점은 여기에 시간 보너스 3 × 3
    expect(summary).toMatchObject({ totalCount: 3, maxScore: 62, correctCount: 3, score: 53 });
    // 카테고리별 합계가 총 문제 수와 같다 (알 수 없음은 맨 뒤)
    expect(summary.byCategory.reduce((sum, c) => sum + c.total, 0)).toBe(summary.totalCount);
    expect(summary.byCategory.at(-1)).toEqual({ category: UNKNOWN_CATEGORY, correct: 1, total: 1 });
  });
});
