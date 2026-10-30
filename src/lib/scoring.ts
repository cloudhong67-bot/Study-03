// PRD 6.3: 문제당 10점 (카테고리 100점 / 전체 400점 만점)
export const POINTS_PER_QUESTION = 10;

export function calculateScore(correctCount: number): number {
  return correctCount * POINTS_PER_QUESTION;
}

export function calculateMaxScore(totalCount: number): number {
  return totalCount * POINTS_PER_QUESTION;
}

/** 정답률(%)을 소수점 첫째 자리까지 반올림해 돌려준다. */
export function calculateAccuracy(correctCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.round((correctCount / totalCount) * 1000) / 10;
}
