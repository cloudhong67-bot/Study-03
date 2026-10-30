// 점수 등록과 순위표
import type { Score } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getCategoryBySlug } from "@/lib/quiz/categories";
import { ANSWER_RECORD_SELECT, assertNotExpired, sessionNotFound, summarizeSession } from "@/lib/quiz/sessions";
import type { LeaderboardQuery, SubmitScoreInput } from "@/lib/validation";

const alreadySubmitted = () => new AppError("CONFLICT", "이미 점수를 등록한 세션입니다.");

/**
 * 점수는 클라이언트 값이 아니라 저장된 답안으로 서버가 계산한다. 세션당 한 번만 등록할 수 있다.
 * 멱등성: 이미 등록한 세션에 같은 닉네임으로 다시 보내면(응답을 못 받아 재시도) 처음 결과를 돌려주고
 * replayed=true로 알린다(라우트가 201 대신 200으로 응답). 다른 닉네임이면 409.
 */
export async function submitScore(sessionId: string, input: SubmitScoreInput) {
  const session = await prisma.quizSession.findUnique({
    where: { id: sessionId },
    include: { answers: { select: ANSWER_RECORD_SELECT }, score: true },
  });
  if (!session) throw sessionNotFound();
  if (session.score) return replay(session.score, input);
  assertNotExpired(session);

  // 결과 화면과 같은 함수로 집계해, 화면에 보인 점수·만점과 순위표에 오르는 값이 항상 같다.
  const summary = await summarizeSession(session, session.answers);
  if (summary.answeredCount < summary.totalCount) {
    throw new AppError("CONFLICT", "모든 문제에 답한 뒤에 점수를 등록할 수 있습니다.");
  }

  let created: Score;
  try {
    created = await prisma.score.create({
      data: {
        sessionId,
        username: input.username,
        score: summary.score,
        maxScore: summary.maxScore,
        correctCount: summary.correctCount,
        totalCount: summary.totalCount,
        mode: session.mode,
        categoryId: session.categoryId,
      },
    });
  } catch (error) {
    // 같은 세션의 등록 요청이 동시에 들어와 다른 요청이 먼저 저장한 경우
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.score.findUnique({ where: { sessionId } });
    if (!existing) throw alreadySubmitted();
    return replay(existing, input);
  }

  return { result: await toSubmittedScore(created), replayed: false };
}

async function replay(existing: Score, input: SubmitScoreInput) {
  if (existing.username !== input.username) throw alreadySubmitted();
  return { result: await toSubmittedScore(existing), replayed: true };
}

async function toSubmittedScore(score: Score) {
  return { rank: await rankOf(score), score: score.score, maxScore: score.maxScore };
}

/** 같은 순위표(mode + category) 안에서의 순위. 동점이면 먼저 기록한 쪽이 위다. */
async function rankOf(score: Score): Promise<number> {
  const ahead = await prisma.score.count({
    where: {
      mode: score.mode,
      categoryId: score.categoryId,
      OR: [
        { score: { gt: score.score } },
        { score: score.score, createdAt: { lt: score.createdAt } },
        { score: score.score, createdAt: score.createdAt, id: { lt: score.id } },
      ],
    },
  });
  return ahead + 1;
}

export async function getLeaderboard(query: LeaderboardQuery) {
  const category = query.category ? await getCategoryBySlug(query.category) : null;

  const scores = await prisma.score.findMany({
    where: { mode: query.mode, categoryId: category?.id ?? null },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    take: query.limit,
    select: { username: true, score: true, maxScore: true, createdAt: true },
  });

  return scores.map((s, i) => ({
    rank: i + 1,
    username: s.username,
    score: s.score,
    maxScore: s.maxScore,
    created_at: s.createdAt.toISOString(),
  }));
}

// ── API 응답 타입 (클라이언트는 `import type`으로 가져다 쓴다) ──

export type SubmittedScore = Awaited<ReturnType<typeof submitScore>>["result"];
export type LeaderboardEntry = Awaited<ReturnType<typeof getLeaderboard>>[number];
