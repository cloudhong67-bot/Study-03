// 결과 집계 (순수 함수, DB 없음)
import {
  type AnswerPoints,
  calculateAccuracy,
  calculateMaxScore,
  type Difficulty,
  maxStreak,
  type PointsBreakdown,
  scoreAnswers,
  sumPoints,
} from "@/lib/scoring";

export interface SessionQuestionInfo {
  id: number;
  categoryName: string;
  categorySortOrder: number;
  difficulty: Difficulty;
}

/** 집계에 쓰는 답안 기록 (session_answers) */
export interface AnswerRecord {
  questionId: number;
  isCorrect: boolean;
  elapsedMs: number | null;
  hintUsed: boolean;
}

export interface CategoryResult {
  category: string;
  correct: number;
  total: number;
}

export interface ResultSummary {
  score: number;
  maxScore: number;
  /** score를 이루는 항목별 합계 (기본 점수·시간·힌트 미사용·콤보 보너스) */
  breakdown: PointsBreakdown;
  maxStreak: number;
  correctCount: number;
  answeredCount: number;
  totalCount: number;
  accuracy: number;
  byCategory: CategoryResult[];
}

/** 문제 정보를 찾지 못한 경우의 카테고리 (DB 트리거로 막혀 있어 정상 운영에서는 생기지 않는다). */
export const UNKNOWN_CATEGORY = "알 수 없음";

/**
 * 세션에 출제된 문제 id 목록을 기준으로 집계용 문제 정보를 만든다.
 * 총 문제 수(만점)의 기준은 항상 "출제된 목록"이다. 정보를 찾지 못한 문제도 빠뜨리지 않고
 * UNKNOWN_CATEGORY(난이도 MEDIUM)로 넣어, 결과 화면과 점수 등록의 만점이 어긋나지 않게 한다.
 */
export function sessionQuestionInfos(
  questionIds: readonly number[],
  rows: readonly { id: number; difficulty: Difficulty; category: { name: string; sortOrder: number } }[],
): SessionQuestionInfo[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return questionIds.map((id) => {
    const row = byId.get(id);
    return {
      id,
      categoryName: row?.category.name ?? UNKNOWN_CATEGORY,
      categorySortOrder: row?.category.sortOrder ?? Number.MAX_SAFE_INTEGER,
      difficulty: row?.difficulty ?? "MEDIUM",
    };
  });
}

/** 출제 순서대로 문제별 점수를 매긴다. 답하지 않은 문제는 null. */
export function scoreSession(
  questions: readonly SessionQuestionInfo[],
  answers: readonly AnswerRecord[],
): (AnswerPoints | null)[] {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  return scoreAnswers(
    questions.map((q) => {
      const answer = byQuestion.get(q.id);
      return answer ? { ...answer, difficulty: q.difficulty } : null;
    }),
  );
}

/** 세션의 문제 목록과 답안 기록으로 점수·정답률·카테고리별 정답 수를 계산한다. */
export function buildResultSummary(
  questions: readonly SessionQuestionInfo[],
  answers: readonly AnswerRecord[],
): ResultSummary {
  const correctIds = new Set(answers.filter((a) => a.isCorrect).map((a) => a.questionId));
  const byCategory = new Map<string, CategoryResult & { sortOrder: number }>();

  for (const q of questions) {
    const entry = byCategory.get(q.categoryName) ?? {
      category: q.categoryName,
      correct: 0,
      total: 0,
      sortOrder: q.categorySortOrder,
    };
    entry.total += 1;
    if (correctIds.has(q.id)) entry.correct += 1;
    byCategory.set(q.categoryName, entry);
  }

  const totalCount = questions.length;
  const correctCount = questions.filter((q) => correctIds.has(q.id)).length;
  const points = scoreSession(questions, answers);
  const { total, ...breakdown } = sumPoints(points);

  return {
    score: total,
    maxScore: calculateMaxScore(questions.map((q) => q.difficulty)),
    breakdown,
    maxStreak: maxStreak(points),
    correctCount,
    answeredCount: answers.length,
    totalCount,
    accuracy: calculateAccuracy(correctCount, totalCount),
    byCategory: [...byCategory.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ category, correct, total }) => ({ category, correct, total })),
  };
}
