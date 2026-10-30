// 퀴즈 세션: 생성(출제) → 문제 열기·힌트 → 답안 채점 → 결과 조회 → 만료·정리
import type { Prisma, QuizMode, QuizSession } from "@prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { AppError } from "@/lib/errors";
import { pickFiftyFiftyRemovals } from "@/lib/hint";
import { MIN_ANSWER_INTERVAL_MS, SPEED_QUESTION_COUNT, SPEED_TIME_LIMIT_MS } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import type { AnswerPoints } from "@/lib/scoring";
import { getCategoryBySlug } from "@/lib/quiz/categories";
import {
  type AnswerRecord,
  buildResultSummary,
  type ResultSummary,
  scoreSession,
  type SessionQuestionInfo,
  sessionQuestionInfos,
} from "@/lib/quiz/summary";
import { shuffle } from "@/lib/shuffle";
import type { CreateSessionInput, QuestionRefInput, SubmitAnswerInput } from "@/lib/validation";

/** 점수를 등록하지 않은 세션은 이 시간이 지나면 만료되고 정리 대상이 된다. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 스피드 퀴즈에서 제한 시간을 넘긴 것으로 보기 전의 여유. 서버는 문제 열기 요청이 도착한 때부터 재므로,
 * 응답·답안이 오가는 네트워크 시간 때문에 화면의 타이머 안에 고른 답이 시간 초과가 되지 않게 한다.
 */
export const SPEED_DEADLINE_GRACE_MS = 2000;

/** 모드별 문제당 제한 시간. 없으면 null */
export function timeLimitFor(mode: QuizMode): number | null {
  return mode === "SPEED" ? SPEED_TIME_LIMIT_MS : null;
}

// ── 오류 ────────────────────────────────────────────────

export const sessionNotFound = () => new AppError("NOT_FOUND", "세션을 찾을 수 없습니다.");
const sessionExpired = () => new AppError("NOT_FOUND", "만료된 세션입니다. 새 퀴즈를 시작해 주세요.");
const alreadyAnswered = () => new AppError("CONFLICT", "이미 답한 문제입니다.");
const notInSession = () => new AppError("BAD_REQUEST", "이 세션에 포함되지 않은 문제입니다.");
const questionNotOpened = () => new AppError("CONFLICT", "문제를 먼저 불러와 주세요.");

/** 시작 후 SESSION_TTL_MS가 지난 세션이면 404 (만료). */
export function assertNotExpired(session: Pick<QuizSession, "startedAt">, now: Date = new Date()): void {
  if (now.getTime() - session.startedAt.getTime() > SESSION_TTL_MS) throw sessionExpired();
}

async function findSessionOrThrow(sessionId: string) {
  const session = await prisma.quizSession.findUnique({ where: { id: sessionId } });
  if (!session) throw sessionNotFound();
  return session;
}

/** 만료되지 않은 세션과 그 세션에서 문제의 출제 순서(0부터). 세션에 없는 문제면 400. */
async function findActiveSessionQuestion(sessionId: string, questionId: number) {
  const session = await findSessionOrThrow(sessionId);
  assertNotExpired(session);
  const position = session.questionIds.indexOf(questionId);
  if (position < 0) throw notInSession();
  return { session, position };
}

async function findQuestionOrThrow(questionId: number) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { answerIndex: true, explanation: true },
  });
  if (!question) throw new AppError("NOT_FOUND", "문제를 찾을 수 없습니다.");
  return question;
}

const answerKey = (sessionId: string, questionId: number) => ({ sessionId_questionId: { sessionId, questionId } });

// ── 세션 생성 ────────────────────────────────────────────

/**
 * 세션을 만들고 문제 순서를 섞어 고정한다. 응답에는 정답·해설을 넣지 않는다 (PRD 6.3).
 * 스피드 퀴즈는 전체 문제를 섞은 뒤 앞에서 SPEED_QUESTION_COUNT개만 낸다.
 */
export async function createSession(input: CreateSessionInput, random: () => number = Math.random) {
  const category = input.mode === "CATEGORY" ? await getCategoryBySlug(input.categorySlug) : null;

  const questions = await prisma.question.findMany({
    where: category ? { categoryId: category.id } : undefined,
    orderBy: { id: "asc" },
    select: { id: true, question: true, options: true, difficulty: true, category: { select: { name: true } } },
  });
  if (questions.length === 0) {
    throw new AppError("CONFLICT", "출제할 문제가 없습니다.");
  }

  const shuffled = shuffle(questions, random);
  const ordered = input.mode === "SPEED" ? shuffled.slice(0, SPEED_QUESTION_COUNT) : shuffled;
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
    mode: session.mode,
    timeLimitMs: timeLimitFor(session.mode),
    questions: ordered.map((q) => ({
      id: q.id,
      category: q.category.name,
      difficulty: q.difficulty,
      question: q.question,
      options: q.options,
    })),
  };
}

// ── 문제 열기 ────────────────────────────────────────────

/**
 * 문제를 화면에 띄우기 직전에 부른다. 이때부터 서버 시계로 답안 시간을 잰다 (시간 보너스·스피드 제한 시간).
 * - 출제 순서대로만 열 수 있다 (앞 문제에 답하지 않았으면 409). 답안은 연 문제에만 받으므로 답안도 출제 순서다.
 * - 멱등성: 이미 연 문제를 다시 열면(재시도) 처음 연 시각을 그대로 쓰고, 남은 시간과 힌트 상태를 돌려준다.
 */
export async function openQuestion(sessionId: string, input: QuestionRefInput) {
  const { session, position } = await findActiveSessionQuestion(sessionId, input.questionId);

  const view = await prisma.$transaction(async (tx) => {
    await lockSession(tx, sessionId);
    const answered = await tx.sessionAnswer.count({ where: { sessionId } });
    if (position > answered) throw new AppError("CONFLICT", "이전 문제에 먼저 답해 주세요.");
    return tx.sessionQuestionView.upsert({
      where: answerKey(sessionId, input.questionId),
      create: { sessionId, questionId: input.questionId, viewedAt: new Date() },
      update: {},
      select: { viewedAt: true, hintRemoved: true },
    });
  });

  const timeLimitMs = timeLimitFor(session.mode);
  return {
    questionId: input.questionId,
    timeLimitMs,
    /** 제한 시간이 있으면 남은 시간 (재시도로 늦게 받은 응답도 처음 연 시각 기준) */
    remainingMs: timeLimitMs === null ? null : Math.max(0, timeLimitMs - (Date.now() - view.viewedAt.getTime())),
    removedOptions: view.hintRemoved,
  };
}

// ── 50:50 힌트 ───────────────────────────────────────────

/**
 * 연 문제의 오답 보기 2개를 지운다. 힌트를 쓴 문제는 맞혀도 힌트 미사용 보너스를 받지 못한다.
 * 멱등성: 같은 문제에 다시 요청하면 처음 지운 보기를 그대로 돌려준다 (다시 뽑지 않는다).
 */
export async function requestHint(sessionId: string, input: QuestionRefInput, random: () => number = Math.random) {
  await findActiveSessionQuestion(sessionId, input.questionId);
  const question = await findQuestionOrThrow(input.questionId);
  const key = answerKey(sessionId, input.questionId);

  const removedOptions = await prisma.$transaction(async (tx) => {
    await lockSession(tx, sessionId);
    const view = await tx.sessionQuestionView.findUnique({ where: key, select: { hintRemoved: true } });
    if (!view) throw questionNotOpened();
    if (view.hintRemoved.length > 0) return view.hintRemoved;
    if (await tx.sessionAnswer.findUnique({ where: key, select: { questionId: true } })) throw alreadyAnswered();

    const removed = pickFiftyFiftyRemovals(question.answerIndex, random);
    await tx.sessionQuestionView.update({ where: key, data: { hintRemoved: removed } });
    return removed;
  });

  return { questionId: input.questionId, removedOptions };
}

// ── 답안 채점 ────────────────────────────────────────────

/**
 * 답안을 서버에서 채점하고 즉시 정답·해설·얻은 점수를 돌려준다. 한 문제에는 한 번만 답할 수 있다.
 * - openQuestion으로 연 문제에만 답할 수 있고(409), 답안 시간은 문제를 연 시각부터 서버가 잰다
 * - 같은 세션의 직전 답안(첫 답안은 세션 시작)으로부터 MIN_ANSWER_INTERVAL_MS가 지나지 않았으면 429
 * - 스피드 퀴즈: selectedIndex가 null(화면 타이머 종료)이거나 제한 시간 + 여유를 넘기면 시간 초과(오답)
 * - 멱등성: 이미 답한 문제에 **같은 보기**로 다시 보내면(응답을 못 받아 재시도한 경우) 처음과 같은 결과,
 *   다른 보기면 409. 재전송은 새 답안이 아니므로 간격 제한보다 먼저 확인한다.
 */
export async function submitAnswer(sessionId: string, input: SubmitAnswerInput) {
  const { session } = await findActiveSessionQuestion(sessionId, input.questionId);
  const timeLimitMs = timeLimitFor(session.mode);
  if (input.selectedIndex === null && timeLimitMs === null) {
    throw new AppError("BAD_REQUEST", "보기를 하나 골라 주세요.");
  }
  const question = await findQuestionOrThrow(input.questionId);

  try {
    await prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      // 같은 답안의 재전송이면 저장할 것이 없다. 피드백은 저장된 답안으로 다시 계산하므로 처음과 같다.
      if (await isReplayOfStoredAnswer(tx, sessionId, input)) return;

      const view = await tx.sessionQuestionView.findUnique({
        where: answerKey(sessionId, input.questionId),
        select: { viewedAt: true, hintRemoved: true },
      });
      if (!view) throw questionNotOpened();

      const now = new Date();
      await assertAnswerPacing(tx, session, now);
      const elapsedMs = Math.max(0, now.getTime() - view.viewedAt.getTime());
      const timedOut =
        timeLimitMs !== null && (input.selectedIndex === null || elapsedMs > timeLimitMs + SPEED_DEADLINE_GRACE_MS);
      await tx.sessionAnswer.create({
        data: {
          sessionId,
          questionId: input.questionId,
          selectedIndex: input.selectedIndex,
          isCorrect: !timedOut && input.selectedIndex === question.answerIndex,
          elapsedMs,
          hintUsed: view.hintRemoved.length > 0,
          timedOut,
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

  return answerFeedback(session, input.questionId, question);
}

/** summarizeSession·답안 피드백이 읽는 답안 컬럼 */
export const ANSWER_RECORD_SELECT = {
  questionId: true,
  isCorrect: true,
  elapsedMs: true,
  hintUsed: true,
  timedOut: true,
} satisfies Prisma.SessionAnswerSelect;

const NO_POINTS: AnswerPoints = { base: 0, time: 0, hint: 0, combo: 0, total: 0, streak: 0 };

/** 저장된 답안으로 이 문제의 점수·연속 정답·지금까지의 총점을 계산한다 (결과 화면과 같은 scoreSession). */
async function answerFeedback(
  session: Pick<QuizSession, "id" | "questionIds">,
  questionId: number,
  question: { answerIndex: number; explanation: string },
) {
  const [infos, answers] = await Promise.all([
    loadQuestionInfos(session.questionIds),
    prisma.sessionAnswer.findMany({ where: { sessionId: session.id }, select: ANSWER_RECORD_SELECT }),
  ]);
  const stored = answers.find((a) => a.questionId === questionId);
  // 방금 저장했거나 저장된 것을 확인했으므로, 그사이 세션이 지워진 경우뿐이다.
  if (!stored) throw sessionNotFound();
  const points = scoreSession(infos, answers);
  const { total, streak, ...breakdown } = points[session.questionIds.indexOf(questionId)] ?? NO_POINTS;

  return {
    isCorrect: stored.isCorrect,
    timedOut: stored.timedOut,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    /** 이 문제에서 얻은 점수 (오답·시간 초과면 모두 0) */
    points: { ...breakdown, total },
    /** 이 답안까지의 연속 정답 수 */
    streak,
    /** 지금까지의 총점 */
    score: points.reduce((sum, p) => sum + (p?.total ?? 0), 0),
  };
}

type Tx = Prisma.TransactionClient;

/**
 * 세션 행을 잠가 같은 세션의 요청(문제 열기·힌트·답안)을 한 번에 하나씩 처리한다.
 * (잠그지 않으면 여러 답안을 동시에 보내 간격 검사를 한꺼번에 통과할 수 있다.)
 */
async function lockSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "quiz_sessions" WHERE "id" = ${sessionId}::uuid FOR UPDATE`;
}

/** 이미 같은 보기(시간 초과는 null)로 답한 문제면 true (재전송), 다른 보기로 답했으면 409, 처음이면 false. */
async function isReplayOfStoredAnswer(tx: Tx, sessionId: string, input: SubmitAnswerInput): Promise<boolean> {
  const existing = await tx.sessionAnswer.findUnique({
    where: answerKey(sessionId, input.questionId),
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

async function loadQuestionInfos(questionIds: readonly number[]): Promise<SessionQuestionInfo[]> {
  const rows = await prisma.question.findMany({
    where: { id: { in: [...questionIds] } },
    select: { id: true, difficulty: true, category: { select: { name: true, sortOrder: true } } },
  });
  return sessionQuestionInfos(questionIds, rows);
}

/**
 * 세션의 점수·정답률·카테고리별 정답 수. 결과 화면(getResult)과 점수 등록(submitScore)이
 * 반드시 이 함수 하나로 계산해 두 값이 어긋나지 않게 한다. 만점 기준은 출제된 문제 id 목록이다.
 * (답안마다 돌려주는 점수도 같은 scoreSession으로 계산한다.)
 */
export async function summarizeSession(
  session: Pick<QuizSession, "questionIds">,
  answers: readonly AnswerRecord[],
): Promise<ResultSummary> {
  return buildResultSummary(await loadQuestionInfos(session.questionIds), answers);
}

export async function getResult(sessionId: string) {
  const session = await prisma.quizSession.findUnique({
    where: { id: sessionId },
    include: {
      category: { select: { name: true, slug: true } },
      answers: { select: ANSWER_RECORD_SELECT },
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
    timedOutCount: session.answers.filter((a) => a.timedOut).length,
    ...summary,
  };
}

// ── 정리 ────────────────────────────────────────────────

/** 점수를 등록하지 않은 채 만료된 세션을 지운다 (답안·문제 열기 기록은 CASCADE). 순위표에 오른 세션은 남긴다. */
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
export type OpenedQuestion = Awaited<ReturnType<typeof openQuestion>>;
export type HintResult = Awaited<ReturnType<typeof requestHint>>;
export type AnswerFeedback = Awaited<ReturnType<typeof submitAnswer>>;
export type QuizResult = Awaited<ReturnType<typeof getResult>>;
