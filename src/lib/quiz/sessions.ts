// 퀴즈 세션: 생성(출제) → 답안 채점 → 결과 조회 → 만료·정리
import type { Prisma, QuizSession } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { MIN_ANSWER_INTERVAL_MS } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { getCategoryBySlug } from "@/lib/quiz/categories";
import { buildResultSummary, type ResultSummary, sessionQuestionInfos } from "@/lib/quiz/summary";
import { shuffle } from "@/lib/shuffle";
import type { CreateSessionInput, SubmitAnswerInput } from "@/lib/validation";

/** 점수를 등록하지 않은 세션은 이 시간이 지나면 만료되고 정리 대상이 된다. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// ── 오류 ────────────────────────────────────────────────

export const sessionNotFound = () => new AppError("NOT_FOUND", "세션을 찾을 수 없습니다.");
const sessionExpired = () => new AppError("NOT_FOUND", "만료된 세션입니다. 새 퀴즈를 시작해 주세요.");
const alreadyAnswered = () => new AppError("CONFLICT", "이미 답한 문제입니다.");

/** 시작 후 SESSION_TTL_MS가 지난 세션이면 404 (만료). */
export function assertNotExpired(session: Pick<QuizSession, "startedAt">, now: Date = new Date()): void {
  if (now.getTime() - session.startedAt.getTime() > SESSION_TTL_MS) throw sessionExpired();
}

async function findSessionOrThrow(sessionId: string) {
  const session = await prisma.quizSession.findUnique({ where: { id: sessionId } });
  if (!session) throw sessionNotFound();
  return session;
}

// ── 세션 생성 ────────────────────────────────────────────

/** 세션을 만들고 문제 순서를 섞어 고정한다. 응답에는 정답·해설을 넣지 않는다 (PRD 6.3). */
export async function createSession(input: CreateSessionInput, random: () => number = Math.random) {
  const category = input.mode === "CATEGORY" ? await getCategoryBySlug(input.categorySlug) : null;

  const questions = await prisma.question.findMany({
    where: category ? { categoryId: category.id } : undefined,
    orderBy: { id: "asc" },
    select: { id: true, question: true, options: true, category: { select: { name: true } } },
  });
  if (questions.length === 0) {
    throw new AppError("CONFLICT", "출제할 문제가 없습니다.");
  }

  const ordered = shuffle(questions, random);
  const session = await prisma.quizSession.create({
    data: {
      mode: input.mode,
      categoryId: category?.id ?? null,
      questionIds: ordered.map((q) => q.id),
      // 답안 간격·만료 판단을 모두 같은 시계(앱 서버)로 하기 위해 DB 기본값 대신 직접 넣는다.
      startedAt: new Date(),
    },
  });

  return {
    sessionId: session.id,
    questions: ordered.map((q) => ({
      id: q.id,
      category: q.category.name,
      question: q.question,
      options: q.options,
    })),
  };
}

// ── 답안 채점 ────────────────────────────────────────────

/**
 * 답안을 서버에서 채점하고 즉시 정답·해설을 돌려준다. 한 문제에는 한 번만 답할 수 있다.
 * - 같은 세션의 직전 답안(첫 답안은 세션 시작)으로부터 MIN_ANSWER_INTERVAL_MS가 지나지 않았으면 429
 * - 멱등성: 이미 답한 문제에 **같은 보기**로 다시 보내면(응답을 못 받아 재시도한 경우) 처음과 같은 결과,
 *   다른 보기면 409. 재전송은 새 답안이 아니므로 간격 제한보다 먼저 확인한다.
 */
export async function submitAnswer(sessionId: string, input: SubmitAnswerInput) {
  const session = await findSessionOrThrow(sessionId);
  assertNotExpired(session);
  if (!session.questionIds.includes(input.questionId)) {
    throw new AppError("BAD_REQUEST", "이 세션에 포함되지 않은 문제입니다.");
  }

  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
    select: { answerIndex: true, explanation: true },
  });
  if (!question) throw new AppError("NOT_FOUND", "문제를 찾을 수 없습니다.");
  const isCorrect = input.selectedIndex === question.answerIndex;

  try {
    await prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      // 같은 답안의 재전송이면 저장할 것이 없다. 결과(isCorrect 등)도 처음과 같다.
      if (await isReplayOfStoredAnswer(tx, sessionId, input)) return;

      const now = new Date();
      await assertAnswerPacing(tx, session, now);
      await tx.sessionAnswer.create({
        data: {
          sessionId,
          questionId: input.questionId,
          selectedIndex: input.selectedIndex,
          isCorrect,
          answeredAt: now,
        },
      });
      await markCompletedIfAllAnswered(tx, session, now);
    });
  } catch (error) {
    // 잠금 덕분에 보통은 생기지 않지만, 고유 제약이 최종 방어선이다.
    if (isUniqueViolation(error)) throw alreadyAnswered();
    throw error;
  }

  return { isCorrect, answerIndex: question.answerIndex, explanation: question.explanation };
}

type Tx = Prisma.TransactionClient;

/**
 * 세션 행을 잠가 같은 세션의 답안을 한 번에 하나씩 처리한다.
 * (잠그지 않으면 여러 답안을 동시에 보내 간격 검사를 한꺼번에 통과할 수 있다.)
 */
async function lockSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "quiz_sessions" WHERE "id" = ${sessionId}::uuid FOR UPDATE`;
}

/** 이미 같은 보기로 답한 문제면 true (재전송), 다른 보기로 답했으면 409, 처음이면 false. */
async function isReplayOfStoredAnswer(tx: Tx, sessionId: string, input: SubmitAnswerInput): Promise<boolean> {
  const existing = await tx.sessionAnswer.findUnique({
    where: { sessionId_questionId: { sessionId, questionId: input.questionId } },
    select: { selectedIndex: true },
  });
  if (!existing) return false;
  if (existing.selectedIndex !== input.selectedIndex) throw alreadyAnswered();
  return true;
}

/** 직전 답안(없으면 세션 시작)으로부터 MIN_ANSWER_INTERVAL_MS가 지나지 않았으면 429. */
async function assertAnswerPacing(tx: Tx, session: QuizSession, now: Date): Promise<void> {
  const last = await tx.sessionAnswer.findFirst({
    where: { sessionId: session.id },
    orderBy: { answeredAt: "desc" },
    select: { answeredAt: true },
  });
  const elapsed = now.getTime() - (last?.answeredAt ?? session.startedAt).getTime();
  if (elapsed < MIN_ANSWER_INTERVAL_MS) {
    throw new AppError(
      "TOO_MANY_REQUESTS",
      "너무 빨리 답했어요. 문제를 읽고 다시 선택해 주세요.",
      Math.ceil((MIN_ANSWER_INTERVAL_MS - elapsed) / 1000),
    );
  }
}

async function markCompletedIfAllAnswered(tx: Tx, session: QuizSession, now: Date): Promise<void> {
  const answered = await tx.sessionAnswer.count({ where: { sessionId: session.id } });
  if (answered >= session.questionIds.length) {
    await tx.quizSession.updateMany({
      where: { id: session.id, completedAt: null },
      data: { completedAt: now },
    });
  }
}

// ── 결과 집계·조회 ───────────────────────────────────────

/**
 * 세션의 점수·정답률·카테고리별 정답 수. 결과 화면(getResult)과 점수 등록(submitScore)이
 * 반드시 이 함수 하나로 계산해 두 값이 어긋나지 않게 한다. 만점 기준은 출제된 문제 id 목록이다.
 */
export async function summarizeSession(
  session: Pick<QuizSession, "questionIds">,
  answers: readonly { questionId: number; isCorrect: boolean }[],
): Promise<ResultSummary> {
  const rows = await prisma.question.findMany({
    where: { id: { in: session.questionIds } },
    select: { id: true, category: { select: { name: true, sortOrder: true } } },
  });
  return buildResultSummary(sessionQuestionInfos(session.questionIds, rows), answers);
}

export async function getResult(sessionId: string) {
  const session = await prisma.quizSession.findUnique({
    where: { id: sessionId },
    include: {
      category: { select: { name: true, slug: true } },
      answers: { select: { questionId: true, isCorrect: true } },
      score: { select: { id: true } },
    },
  });
  if (!session) throw sessionNotFound();

  const summary = await summarizeSession(session, session.answers);

  return {
    mode: session.mode,
    category: session.category?.name ?? null,
    categorySlug: session.category?.slug ?? null,
    completed: session.completedAt !== null,
    submitted: session.score !== null,
    ...summary,
  };
}

// ── 정리 ────────────────────────────────────────────────

/** 점수를 등록하지 않은 채 만료된 세션을 지운다 (답안은 CASCADE). 순위표에 오른 세션은 남긴다. */
export async function cleanupExpiredSessions(now: Date = new Date()): Promise<number> {
  const expiredBefore = new Date(now.getTime() - SESSION_TTL_MS);
  const { count } = await prisma.quizSession.deleteMany({
    where: { startedAt: { lt: expiredBefore }, score: null },
  });
  return count;
}

// ── API 응답 타입 (클라이언트는 `import type`으로 가져다 쓴다) ──

export type CreatedSession = Awaited<ReturnType<typeof createSession>>;
export type SessionQuestion = CreatedSession["questions"][number];
export type AnswerFeedback = Awaited<ReturnType<typeof submitAnswer>>;
export type QuizResult = Awaited<ReturnType<typeof getResult>>;
