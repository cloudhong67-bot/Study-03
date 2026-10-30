// 결과 집계 (순수 함수, DB 없음)
import { calculateAccuracy, calculateMaxScore, calculateScore } from "@/lib/scoring";

export interface SessionQuestionInfo {
  id: number;
  categoryName: string;
  categorySortOrder: number;
}

export interface CategoryResult {
  category: string;
  correct: number;
  total: number;
}

export interface ResultSummary {
  score: number;
  maxScore: number;
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
 * UNKNOWN_CATEGORY로 넣어, 결과 화면과 점수 등록의 만점이 어긋나지 않게 한다.
 */
export function sessionQuestionInfos(
  questionIds: readonly number[],
  rows: readonly { id: number; category: { name: string; sortOrder: number } }[],
): SessionQuestionInfo[] {
  const byId = new Map(rows.map((r) => [r.id, r.category]));
  return questionIds.map((id) => {
    const category = byId.get(id);
    return {
      id,
      categoryName: category?.name ?? UNKNOWN_CATEGORY,
      categorySortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    };
  });
}

/** 세션의 문제 목록과 답안 기록으로 점수·정답률·카테고리별 정답 수를 계산한다. */
export function buildResultSummary(
  questions: readonly SessionQuestionInfo[],
  answers: readonly { questionId: number; isCorrect: boolean }[],
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

  return {
    score: calculateScore(correctCount),
    maxScore: calculateMaxScore(totalCount),
    correctCount,
    answeredCount: answers.length,
    totalCount,
    accuracy: calculateAccuracy(correctCount, totalCount),
    byCategory: [...byCategory.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ category, correct, total }) => ({ category, correct, total })),
  };
}
