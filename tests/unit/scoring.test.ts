import { describe, expect, it } from "vitest";
import {
  basePoints,
  calculateAccuracy,
  calculateMaxScore,
  comboBonus,
  type Difficulty,
  FAST_ANSWER_MS,
  isFastAnswer,
  maxStreak,
  type ScoredAnswer,
  scoreAnswers,
  sumPoints,
} from "@/lib/scoring";

/** 힌트 없이 천천히(시간 보너스 없음) 답한 답안 */
const slow = (isCorrect: boolean, difficulty: Difficulty = "EASY"): ScoredAnswer => ({
  isCorrect,
  difficulty,
  elapsedMs: FAST_ANSWER_MS,
  hintUsed: false,
});

const totals = (answers: (ScoredAnswer | null)[]) => scoreAnswers(answers).map((p) => p?.total ?? null);

describe("basePoints: 10점 × 난이도 배수", () => {
  it("쉬움 10점, 보통 15점, 어려움 20점", () => {
    expect(basePoints("EASY")).toBe(10);
    expect(basePoints("MEDIUM")).toBe(15);
    expect(basePoints("HARD")).toBe(20);
  });

  it.each(["constructor", "toString", "__proto__", ""])("알 수 없는 난이도 %j는 1배로 본다", (difficulty) => {
    expect(basePoints(difficulty as Difficulty)).toBe(10);
  });
});

describe("isFastAnswer: 10초 미만이면 시간 보너스", () => {
  it.each([0, 1, FAST_ANSWER_MS - 1])("%dms는 빠른 답", (ms) => {
    expect(isFastAnswer(ms)).toBe(true);
  });

  it.each([FAST_ANSWER_MS, FAST_ANSWER_MS + 1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null])(
    "%s는 빠른 답이 아니다",
    (ms) => {
      expect(isFastAnswer(ms)).toBe(false);
    },
  );
});

describe("comboBonus: 연속 정답 3·5·10개째에 한 번", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 2],
    [4, 0],
    [5, 5],
    [6, 0],
    [9, 0],
    [10, 10],
    [11, 0],
    [20, 0],
    [-3, 0],
    [Number.NaN, 0],
    [Number.MAX_SAFE_INTEGER + 1, 0],
  ])("연속 %s개째 → +%d", (streak, bonus) => {
    expect(comboBonus(streak)).toBe(bonus);
  });
});

describe("scoreAnswers", () => {
  it("빈 배열은 빈 결과", () => {
    expect(scoreAnswers([])).toEqual([]);
  });

  it("정답 하나의 점수 = 기본 + 시간 + 힌트 미사용 (+ 콤보)", () => {
    expect(scoreAnswers([{ isCorrect: true, difficulty: "HARD", elapsedMs: 4000, hintUsed: false }])).toEqual([
      { base: 20, time: 3, hint: 2, combo: 0, total: 25, streak: 1 },
    ]);
  });

  it("힌트를 쓰면 힌트 미사용 보너스가 없고, 10초 이상이면 시간 보너스가 없다", () => {
    expect(scoreAnswers([{ isCorrect: true, difficulty: "MEDIUM", elapsedMs: 10_000, hintUsed: true }])).toEqual([
      { base: 15, time: 0, hint: 0, combo: 0, total: 15, streak: 1 },
    ]);
  });

  it("시간을 모르는 답안(null)은 시간 보너스가 없다", () => {
    expect(scoreAnswers([{ isCorrect: true, difficulty: "EASY", elapsedMs: null, hintUsed: false }])[0]?.time).toBe(0);
  });

  it("오답은 보너스 없이 0점이고 연속 정답을 끊는다", () => {
    expect(scoreAnswers([slow(true), slow(false)])[1]).toEqual({
      base: 0,
      time: 0,
      hint: 0,
      combo: 0,
      total: 0,
      streak: 0,
    });
  });

  it("오답은 시간·힌트 조건이 좋아도 0점", () => {
    expect(totals([{ isCorrect: false, difficulty: "HARD", elapsedMs: 1, hintUsed: false }])).toEqual([0]);
  });

  it("콤보 보너스는 3·5·10연속째 문제에서 한 번씩 받는다", () => {
    const points = scoreAnswers(Array.from({ length: 12 }, () => slow(true)));
    expect(points.map((p) => p?.combo)).toEqual([0, 0, 2, 0, 5, 0, 0, 0, 0, 10, 0, 0]);
    expect(points.map((p) => p?.streak)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("연속이 끊기면 처음부터 다시 세어 콤보를 다시 받을 수 있다", () => {
    const answers = [slow(true), slow(true), slow(true), slow(false), slow(true), slow(true), slow(true)];
    expect(scoreAnswers(answers).map((p) => p?.combo)).toEqual([0, 0, 2, 0, 0, 0, 2]);
  });

  it("답하지 않은 문제(null)는 결과도 null이고 연속을 끊는다", () => {
    const points = scoreAnswers([slow(true), slow(true), null, slow(true)]);
    expect(points[2]).toBeNull();
    expect(points[3]?.streak).toBe(1);
  });
});

describe("sumPoints·maxStreak", () => {
  it("항목별로 더하고 null은 건너뛴다", () => {
    const points = scoreAnswers([
      { isCorrect: true, difficulty: "EASY", elapsedMs: 100, hintUsed: false },
      null,
      { isCorrect: true, difficulty: "HARD", elapsedMs: 20_000, hintUsed: true },
      slow(false),
    ]);
    expect(sumPoints(points)).toEqual({ base: 30, time: 3, hint: 2, combo: 0, total: 35 });
    expect(maxStreak(points)).toBe(1);
  });

  it("빈 입력은 모두 0", () => {
    expect(sumPoints([])).toEqual({ base: 0, time: 0, hint: 0, combo: 0, total: 0 });
    expect(maxStreak([])).toBe(0);
  });
});

describe("calculateMaxScore", () => {
  const perfect = (difficulties: Difficulty[]) =>
    sumPoints(
      scoreAnswers(difficulties.map((difficulty) => ({ isCorrect: true, difficulty, elapsedMs: 0, hintUsed: false }))),
    ).total;

  it("문제가 없으면 0점", () => {
    expect(calculateMaxScore([])).toBe(0);
  });

  it("10문제 이하는 전부 빠르게·힌트 없이 맞힌 점수와 같다", () => {
    const category: Difficulty[] = ["EASY", "EASY", "EASY", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "HARD", "HARD", "HARD"];
    // 기본 30 + 60 + 60, 보너스 (3 + 2) × 10, 콤보 2 + 5 + 10
    expect(calculateMaxScore(category)).toBe(150 + 50 + 17);
    expect(calculateMaxScore(category)).toBe(perfect(category));
    expect(calculateMaxScore(["HARD"])).toBe(25);
  });

  it("문제가 많으면 쉬운 문제 하나를 틀려 콤보를 다시 받는 쪽이 더 높을 수 있고, 그 점수를 만점으로 한다", () => {
    // 쉬움 21개: 전부 맞히면 15 × 21 + 17 = 332
    // 11번째를 틀리면 15 × 20 + 17 (1~10번) + 17 (12~21번) = 334
    const easy21 = Array<Difficulty>(21).fill("EASY");
    expect(perfect(easy21)).toBe(332);
    expect(calculateMaxScore(easy21)).toBe(334);

    const withBreak = easy21.map((difficulty, i) => ({
      isCorrect: i !== 10,
      difficulty,
      elapsedMs: 0,
      hintUsed: false,
    }));
    expect(sumPoints(scoreAnswers(withBreak)).total).toBe(334);
  });

  it("어떤 정답·오답 조합도 만점을 넘지 않는다 (작은 경우 전수 확인)", () => {
    const difficulties: Difficulty[] = ["EASY", "HARD", "EASY", "MEDIUM", "EASY", "EASY", "HARD", "EASY", "EASY", "EASY", "EASY", "EASY"];
    const max = calculateMaxScore(difficulties);
    let best = 0;
    for (let mask = 0; mask < 1 << difficulties.length; mask++) {
      const answers = difficulties.map((difficulty, i) => ({
        isCorrect: (mask & (1 << i)) !== 0,
        difficulty,
        elapsedMs: 0,
        hintUsed: false,
      }));
      best = Math.max(best, sumPoints(scoreAnswers(answers)).total);
    }
    expect(best).toBe(max);
  });
});

describe("calculateAccuracy", () => {
  it("정답률을 소수점 첫째 자리까지 계산한다", () => {
    expect(calculateAccuracy(1, 3)).toBe(33.3);
    expect(calculateAccuracy(0, 0)).toBe(0);
  });
});
