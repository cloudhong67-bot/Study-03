// 점수 계산 (순수 함수, DB 없음). 클라이언트도 점수 규칙을 보여 주려고 가져다 쓸 수 있도록 Prisma·zod를 쓰지 않는다.
//
// 맞힌 문제 하나의 점수 = 기본 점수(10점 × 난이도 배수) + 시간 보너스 + 힌트 미사용 보너스 + 콤보 보너스
// 틀리거나 시간이 끝나면 0점이고 연속 정답이 끊긴다.

/** Prisma의 Difficulty enum과 같은 값 (클라이언트 번들에 Prisma를 끌어오지 않도록 따로 둔다) */
export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export const BASE_POINTS = 10;

export const DIFFICULTY_MULTIPLIERS: Readonly<Record<Difficulty, number>> = { EASY: 1, MEDIUM: 1.5, HARD: 2 };

/** 문제를 연 뒤 이 시간 안에 맞히면 시간 보너스 */
export const FAST_ANSWER_MS = 10_000;
export const FAST_ANSWER_BONUS = 3;

/** 50:50 힌트를 쓰지 않고 맞히면 받는 보너스 */
export const NO_HINT_BONUS = 2;

/** 연속 정답이 정확히 이 개수에 이른 문제에서 한 번 받는 보너스 (연속이 끊기면 다시 받을 수 있다) */
export const COMBO_BONUSES: ReadonlyMap<number, number> = new Map([
  [3, 2],
  [5, 5],
  [10, 10],
]);

/** 보너스를 더 받을 수 없는 연속 정답 수. 만점 계산에서 연속 수를 여기까지만 구분한다. */
const LAST_COMBO_STREAK = Math.max(...COMBO_BONUSES.keys());

export interface ScoredAnswer {
  isCorrect: boolean;
  difficulty: Difficulty;
  /** 서버가 잰 답안 시간. 모르면 null (시간 보너스 없음) */
  elapsedMs: number | null;
  hintUsed: boolean;
}

export interface PointsBreakdown {
  base: number;
  time: number;
  hint: number;
  combo: number;
}

export interface AnswerPoints extends PointsBreakdown {
  total: number;
  /** 이 답안까지의 연속 정답 수 (오답이면 0) */
  streak: number;
}

export function basePoints(difficulty: Difficulty): number {
  const multiplier = Object.hasOwn(DIFFICULTY_MULTIPLIERS, difficulty) ? DIFFICULTY_MULTIPLIERS[difficulty] : 1;
  return Math.round(BASE_POINTS * multiplier);
}

export function comboBonus(streak: number): number {
  return COMBO_BONUSES.get(streak) ?? 0;
}

export function isFastAnswer(elapsedMs: number | null): boolean {
  return elapsedMs !== null && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < FAST_ANSWER_MS;
}

const NO_POINTS: PointsBreakdown = { base: 0, time: 0, hint: 0, combo: 0 };

/**
 * 출제 순서대로 놓인 답안의 문제별 점수. null은 아직 답하지 않은 문제로, 연속 정답을 끊는다.
 * (연속 정답은 답한 시각이 아니라 출제 순서로 센다. 그래야 만점 계산과 기준이 같다.)
 */
export function scoreAnswers(answers: readonly (ScoredAnswer | null)[]): (AnswerPoints | null)[] {
  let streak = 0;
  return answers.map((answer) => {
    if (!answer?.isCorrect) {
      streak = 0;
      return answer ? { ...NO_POINTS, total: 0, streak } : null;
    }
    streak += 1;
    const points = {
      base: basePoints(answer.difficulty),
      time: isFastAnswer(answer.elapsedMs) ? FAST_ANSWER_BONUS : 0,
      hint: answer.hintUsed ? 0 : NO_HINT_BONUS,
      combo: comboBonus(streak),
    };
    return { ...points, total: points.base + points.time + points.hint + points.combo, streak };
  });
}

export function sumPoints(points: readonly (AnswerPoints | null)[]): PointsBreakdown & { total: number } {
  const sum = { ...NO_POINTS, total: 0 };
  for (const p of points) {
    if (!p) continue;
    sum.base += p.base;
    sum.time += p.time;
    sum.hint += p.hint;
    sum.combo += p.combo;
    sum.total += p.total;
  }
  return sum;
}

export function maxStreak(points: readonly (AnswerPoints | null)[]): number {
  return points.reduce((max, p) => Math.max(max, p?.streak ?? 0), 0);
}

/**
 * 출제 순서의 난이도로 얻을 수 있는 최고 점수.
 * 콤보 보너스는 연속이 끊기면 다시 받으므로, 문제가 많으면 쉬운 문제 하나를 틀리는 쪽이 전부 맞히는 것보다
 * 점수가 높을 수 있다. 그래서 "전부 정답" 점수가 아니라 연속 정답 수별 최고 점수를 차례로 계산한다.
 */
export function calculateMaxScore(difficulties: readonly Difficulty[]): number {
  // best[s] = 지금까지 문제를 풀고 연속 정답이 s(LAST_COMBO_STREAK에서 멈춤)일 때의 최고 점수
  let best: number[] = [0, ...Array<number>(LAST_COMBO_STREAK).fill(-Infinity)];
  for (const difficulty of difficulties) {
    const perfect = basePoints(difficulty) + FAST_ANSWER_BONUS + NO_HINT_BONUS;
    const next = Array<number>(LAST_COMBO_STREAK + 1).fill(-Infinity);
    next[0] = Math.max(...best); // 틀림
    best.forEach((score, streak) => {
      const reached = Math.min(streak + 1, LAST_COMBO_STREAK);
      next[reached] = Math.max(next[reached], score + perfect + comboBonus(streak + 1));
    });
    best = next;
  }
  return Math.max(...best);
}

/** 정답률(%)을 소수점 첫째 자리까지 반올림해 돌려준다. */
export function calculateAccuracy(correctCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.round((correctCount / totalCount) * 1000) / 10;
}
