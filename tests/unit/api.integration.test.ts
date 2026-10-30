// API Route 통합 테스트: 라우트 핸들러를 직접 호출하고, 테스트 DB(*_test)에 실제로 읽고 쓴다.
// 준비 과정(DB 생성·마이그레이션·시드)은 tests/global-setup.ts가 맡는다.
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getCategories } from "@/app/api/categories/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getLeaderboard } from "@/app/api/leaderboard/route";
import { POST as postAnswer } from "@/app/api/sessions/[id]/answers/route";
import { POST as postHint } from "@/app/api/sessions/[id]/hints/route";
import { GET as getResult } from "@/app/api/sessions/[id]/result/route";
import { POST as postSubmit } from "@/app/api/sessions/[id]/submit/route";
import { POST as postView } from "@/app/api/sessions/[id]/views/route";
import { POST as postSession } from "@/app/api/sessions/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api";
import { MIN_ANSWER_INTERVAL_MS, SPEED_QUESTION_COUNT, SPEED_TIME_LIMIT_MS } from "@/lib/limits";
import { createMaintenanceRunner, MAINTENANCE_INTERVAL_MS } from "@/lib/maintenance";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredSessions, SESSION_TTL_MS, SPEED_DEADLINE_GRACE_MS } from "@/lib/quiz/sessions";
import { consumeRateLimit, pruneRateLimits, RATE_LIMITS } from "@/lib/rate-limit";

const UNKNOWN_SESSION_ID = "00000000-0000-4000-8000-000000000000";

type Body = Record<string, unknown> & { error?: { code: string; message: string } };
type SessionQuestion = { id: number; category: string; difficulty: string; question: string; options: string[] };
type Points = { base: number; time: number; hint: number; combo: number; total: number };
type Feedback = {
  isCorrect: boolean;
  timedOut: boolean;
  answerIndex: number;
  explanation: string;
  points: Points;
  streak: number;
  score: number;
};
type LeaderboardEntry = { rank: number; username: string; score: number; maxScore: number; created_at: string };

/** clientIp를 주면 X-Forwarded-For로 보낸다 (요청 횟수 제한의 클라이언트 식별). */
function request(path: string, body?: unknown, clientIp?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(clientIp ? { "x-forwarded-for": clientIp } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function read<T = Body>(response: Response) {
  return { status: response.status, body: (await response.json()) as T };
}

type CreatedSession = { sessionId: string; mode: string; timeLimitMs: number | null; questions: SessionQuestion[] };

async function createSession(body: unknown) {
  const { status, body: data } = await read<CreatedSession>(await postSession(request("/api/sessions", body)));
  expect(status).toBe(201);
  return data;
}

async function answerKey(ids: number[]) {
  const rows = await prisma.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, answerIndex: true },
  });
  return new Map(rows.map((r) => [r.id, r.answerIndex]));
}

/** 문제를 연다 (답안 시간 측정 시작). 이미 열었으면 처음 연 시각 그대로다. */
function openQuestion(sessionId: string, questionId: unknown) {
  return postView(request(`/api/sessions/${sessionId}/views`, { questionId }), ctx(sessionId));
}

function requestHint(sessionId: string, questionId: unknown) {
  return postHint(request(`/api/sessions/${sessionId}/hints`, { questionId }), ctx(sessionId));
}

/** 문제를 열지 않고 답안만 보낸다. */
function postAnswerOnly(sessionId: string, questionId: number, selectedIndex: number | null) {
  return postAnswer(request(`/api/sessions/${sessionId}/answers`, { questionId, selectedIndex }), ctx(sessionId));
}

/** 문제를 열고 시계를 진행하지 않고 바로 답한다 (1초 간격 제한 검증용). */
async function answerNow(sessionId: string, questionId: number, selectedIndex: number | null) {
  await openQuestion(sessionId, questionId);
  return postAnswerOnly(sessionId, questionId, selectedIndex);
}

/** 문제를 열고, 사람이 문제를 읽는 시간만큼 (가짜) 시계를 진행한 뒤 답한다 (시간 보너스를 받는 빠르기). */
async function answer(sessionId: string, questionId: number, selectedIndex: number | null) {
  await openQuestion(sessionId, questionId);
  advanceClock(MIN_ANSWER_INTERVAL_MS);
  return postAnswerOnly(sessionId, questionId, selectedIndex);
}

/** Date만 가짜로 바꿔 두었으므로(setTimeout 등은 실제) Prisma 동작에는 영향이 없다. */
function advanceClock(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

/**
 * 세션을 만들고 앞에서부터 correctCount개만 맞히도록 전부 답한다 (모두 빠르게, 힌트 없이).
 * 점수가 출제 순서(난이도·연속 정답)에 따라 달라지므로, 출제 순서를 id 오름차순으로 고정해 점수를 예측할 수 있게 한다.
 */
async function playSession(body: unknown, correctCount: number) {
  const created = await createSession(body);
  const session = { ...created, questions: [...created.questions].sort((a, b) => a.id - b.id) };
  await prisma.quizSession.update({
    where: { id: session.sessionId },
    data: { questionIds: session.questions.map((q) => q.id) },
  });
  const key = await answerKey(session.questions.map((q) => q.id));
  for (const [i, q] of session.questions.entries()) {
    const correct = key.get(q.id)!;
    const res = await answer(session.sessionId, q.id, i < correctCount ? correct : (correct + 1) % 4);
    expect(res.status).toBe(200);
  }
  return session;
}

function submit(sessionId: string, username: unknown) {
  return postSubmit(request(`/api/sessions/${sessionId}/submit`, { username }), ctx(sessionId));
}

async function leaderboard(query: string) {
  return read<LeaderboardEntry[]>(await getLeaderboard(request(`/api/leaderboard${query}`)));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await prisma.$executeRawUnsafe(
    'TRUNCATE "scores", "session_answers", "quiz_sessions", "rate_limits" RESTART IDENTITY CASCADE',
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/categories", () => {
  it("카테고리 4개를 정렬 순서대로, 문제 수와 함께 돌려준다", async () => {
    const { status, body } = await read(await getCategories());
    expect(status).toBe(200);
    expect(body).toEqual([
      { slug: "korean-history", name: "한국사", questionCount: 10 },
      { slug: "science", name: "과학", questionCount: 10 },
      { slug: "geography", name: "지리", questionCount: 10 },
      { slug: "general", name: "일반상식", questionCount: 10 },
    ]);
  });
});

describe("POST /api/sessions", () => {
  it("카테고리 모드: 해당 카테고리 10문제를 정답·해설 없이 돌려주고, 출제 순서를 DB에 고정한다", async () => {
    const session = await createSession({ mode: "CATEGORY", categorySlug: "science" });

    expect(session.questions).toHaveLength(10);
    for (const q of session.questions) {
      expect(Object.keys(q).sort()).toEqual(["category", "difficulty", "id", "options", "question"]);
      expect(q.category).toBe("과학");
      expect(q.options).toHaveLength(4);
    }

    expect(session).toMatchObject({ mode: "CATEGORY", timeLimitMs: null });
    const stored = await prisma.quizSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.mode).toBe("CATEGORY");
    expect(stored.questionIds).toEqual(session.questions.map((q) => q.id));
  });

  it("전체 모드: 40문제를 중복 없이 돌려준다", async () => {
    const session = await createSession({ mode: "ALL" });
    const ids = session.questions.map((q) => q.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    expect(new Set(session.questions.map((q) => q.category)).size).toBe(4);
  });

  it("스피드 모드: 전체 문제에서 무작위 20문제, 문제당 15초 제한", async () => {
    const session = await createSession({ mode: "SPEED" });
    const ids = session.questions.map((q) => q.id);
    expect(session).toMatchObject({ mode: "SPEED", timeLimitMs: SPEED_TIME_LIMIT_MS });
    expect(ids).toHaveLength(SPEED_QUESTION_COUNT);
    expect(new Set(ids).size).toBe(SPEED_QUESTION_COUNT);
    const stored = await prisma.quizSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored).toMatchObject({ mode: "SPEED", categoryId: null, questionIds: ids });
  });

  it("문제 순서를 섞는다 (전체 모드 세션 두 개의 순서가 모두 id 순일 수는 없다)", async () => {
    const sorted = Array.from({ length: 40 }, (_, i) => i + 1);
    const a = (await createSession({ mode: "ALL" })).questions.map((q) => q.id);
    const b = (await createSession({ mode: "ALL" })).questions.map((q) => q.id);
    expect(a.join() === sorted.join() && b.join() === sorted.join()).toBe(false);
  });

  it.each([
    ["알 수 없는 mode", { mode: "RANDOM" }],
    ["CATEGORY인데 categorySlug 없음", { mode: "CATEGORY" }],
    ["JSON이 아닌 본문", "{not json"],
  ])("%s → 400", async (_label, body) => {
    const { status, body: data } = await read(await postSession(request("/api/sessions", body)));
    expect(status).toBe(400);
    expect(data.error?.code).toBe("BAD_REQUEST");
  });

  it("존재하지 않는 카테고리 → 404", async () => {
    const res = await postSession(request("/api/sessions", { mode: "CATEGORY", categorySlug: "music" }));
    expect(res.status).toBe(404);
  });
});

describe("요청 본문 크기 제한 (4KB)", () => {
  it("Content-Length 없이 상한을 넘는 본문은 끝까지 읽지 않고 413", async () => {
    const big = JSON.stringify({ mode: "ALL", padding: "a".repeat(MAX_JSON_BODY_BYTES) });
    const { status, body } = await read(await postSession(request("/api/sessions", big)));
    expect(status).toBe(413);
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
    expect(await prisma.quizSession.count()).toBe(0);
  });

  it("Content-Length로 큰 본문을 예고하면 읽기 전에 413", async () => {
    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10000000" },
      body: JSON.stringify({ mode: "ALL" }),
    });
    expect((await postSession(req)).status).toBe(413);
  });

  it("상한 이내의 정상 요청과 다른 POST 라우트는 그대로 동작한다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    expect((await answer(sessionId, questions[0].id, 0)).status).toBe(200);
    const huge = await postAnswer(
      request(`/api/sessions/${sessionId}/answers`, { questionId: questions[1].id, selectedIndex: 0, x: "a".repeat(5000) }),
      ctx(sessionId),
    );
    expect(huge.status).toBe(413);
  });
});

describe("POST /api/sessions/[id]/answers", () => {
  it("정답이면 isCorrect=true와 정답 인덱스·해설을 돌려준다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "geography" });
    const q = questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;

    const { status, body } = await read(await answer(sessionId, q.id, correct));
    expect(status).toBe(200);
    expect(body).toMatchObject({ isCorrect: true, answerIndex: correct });
    expect(typeof body.explanation).toBe("string");
  });

  it("오답이면 isCorrect=false와 함께 실제 정답 인덱스를 돌려준다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "geography" });
    const q = questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;

    const { body } = await read(await answer(sessionId, q.id, (correct + 1) % 4));
    expect(body).toMatchObject({ isCorrect: false, answerIndex: correct });
  });

  it("같은 문제에 다시 답하면 409이고, 첫 답안은 바뀌지 않는다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "geography" });
    const q = questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;

    expect((await answer(sessionId, q.id, (correct + 1) % 4)).status).toBe(200);
    const retry = await read(await answer(sessionId, q.id, correct));
    expect(retry.status).toBe(409);
    expect(retry.body.error?.code).toBe("CONFLICT");

    const stored = await prisma.sessionAnswer.findMany({ where: { sessionId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].isCorrect).toBe(false);
  });

  it("세션에 포함되지 않은 문제 → 400", async () => {
    const { sessionId } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const historyQuestion = await prisma.question.findFirstOrThrow({
      where: { category: { slug: "korean-history" } },
    });
    expect((await answer(sessionId, historyQuestion.id, 0)).status).toBe(400);
  });

  it("selectedIndex가 범위를 벗어나면 400", async () => {
    const { sessionId, questions } = await createSession({ mode: "ALL" });
    expect((await answer(sessionId, questions[0].id, 4)).status).toBe(400);
  });

  it.each([UNKNOWN_SESSION_ID, "not-a-uuid"])("존재하지 않는 세션 %s → 404", async (id) => {
    expect((await answer(id, 1, 0)).status).toBe(404);
  });

  it("마지막 문제에 답하면 세션이 완료(completedAt) 처리된다", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 5);
    const stored = await prisma.quizSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.completedAt).not.toBeNull();
  });
});

describe("GET /api/sessions/[id]/result", () => {
  it("진행 중인 세션은 completed=false와 지금까지 답한 수를 돌려준다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    await answer(sessionId, questions[0].id, 0);

    const { status, body } = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
    expect(status).toBe(200);
    expect(body).toMatchObject({ completed: false, submitted: false, answeredCount: 1, totalCount: 10 });
  });

  it("카테고리 모드 결과: 7/10 정답 → 152점 / 217점, 정답률 70%", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 7);

    const { body } = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
    // 과학 11~20번 난이도: 쉬움 11·18·20, 보통 12·14·16·17, 어려움 13·15·19
    // 11~17번 정답: 기본 10+15+20+15+20+15+15 = 110, 빠른 답 3×7, 힌트 미사용 2×7, 콤보 2+5
    // 만점: 기본 150 + (3+2)×10 + 콤보 2+5+10 = 217
    expect(body).toEqual({
      mode: "CATEGORY",
      category: "과학",
      categorySlug: "science",
      completed: true,
      submitted: false,
      timedOutCount: 0,
      score: 152,
      maxScore: 217,
      breakdown: { base: 110, time: 21, hint: 14, combo: 7 },
      maxStreak: 7,
      correctCount: 7,
      answeredCount: 10,
      totalCount: 10,
      accuracy: 70,
      byCategory: [{ category: "과학", correct: 7, total: 10 }],
    });
  });

  it("전체 모드 결과: 카테고리 4개가 정렬 순서대로 나오고, 만점은 콤보를 다시 받는 경우까지 따진다", async () => {
    const { sessionId } = await playSession({ mode: "ALL" }, 40);

    const { body } = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
    // 전부 정답: 기본 4×150 + (3+2)×40 + 콤보 17 = 817
    // 만점: 1~40번 순서에서 쉬운 11번·23번을 틀리면 1~10, 12~22, 24~40번이 각각 10연속 이상이 되어
    // 콤보 17을 두 번 더 받는다 (17×2 − 15×2 = +4) → 821
    expect(body).toMatchObject({ mode: "ALL", category: null, categorySlug: null, score: 817, maxScore: 821, accuracy: 100 });
    expect(body.byCategory).toEqual([
      { category: "한국사", correct: 10, total: 10 },
      { category: "과학", correct: 10, total: 10 },
      { category: "지리", correct: 10, total: 10 },
      { category: "일반상식", correct: 10, total: 10 },
    ]);
  });

  it("존재하지 않는 세션 → 404", async () => {
    const res = await getResult(request(`/api/sessions/${UNKNOWN_SESSION_ID}/result`), ctx(UNKNOWN_SESSION_ID));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sessions/[id]/submit", () => {
  it("완료한 세션의 점수를 서버에서 계산해 등록하고 순위를 돌려준다", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 8);

    const { status, body } = await read(await submit(sessionId, "  퀴즈왕  "));
    expect(status).toBe(201);
    expect(body).toEqual({ rank: 1, score: 167, maxScore: 217 });

    const stored = await prisma.score.findUniqueOrThrow({ where: { sessionId } });
    expect(stored).toMatchObject({
      username: "퀴즈왕",
      score: 167,
      correctCount: 8,
      totalCount: 10,
      mode: "CATEGORY",
    });

    const result = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
    expect(result.body.submitted).toBe(true);
  });

  it("같은 세션으로 다시 등록하면 409", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 8);
    expect((await submit(sessionId, "첫번째")).status).toBe(201);
    expect((await submit(sessionId, "두번째")).status).toBe(409);
    expect(await prisma.score.count()).toBe(1);
  });

  it("모든 문제에 답하기 전에는 409", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    await answer(sessionId, questions[0].id, 0);
    const { status, body } = await read(await submit(sessionId, "성급한사람"));
    expect(status).toBe(409);
    expect(body.error?.code).toBe("CONFLICT");
  });

  it.each(["가", "가나다라마바사아자차카타파", 123])("잘못된 닉네임 %j → 400", async (username) => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 1);
    expect((await submit(sessionId, username)).status).toBe(400);
  });

  it("존재하지 않는 세션 → 404", async () => {
    expect((await submit(UNKNOWN_SESSION_ID, "아무개")).status).toBe(404);
  });

  it("사칭용 문자(방향 전환·한글 채움 문자)가 든 닉네임은 400이고 점수가 저장되지 않는다", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 3);
    for (const username of ["ad‮min", "ㅤㅤㅤ"]) {
      const { status, body } = await read(await submit(sessionId, username));
      expect(status).toBe(400);
      expect(JSON.stringify(body)).toContain("보이지 않는 문자");
    }
    expect(await prisma.score.count()).toBe(0);
  });

  it("자모 분해형(NFD) 한글 닉네임은 완성형(NFC)으로 정규화해 저장한다", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 3);
    expect((await submit(sessionId, "홍길동".normalize("NFD"))).status).toBe(201);
    const stored = await prisma.score.findUniqueOrThrow({ where: { sessionId } });
    expect(stored.username).toBe("홍길동");
    expect(stored.username).toBe(stored.username.normalize("NFC"));
  });
});

describe("GET /api/leaderboard", () => {
  it("점수 내림차순, 동점이면 먼저 등록한 사람이 위에 오고 submit의 순위와 일치한다", async () => {
    const slow = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 6);
    const best = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 9);
    const fast = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 6);

    expect((await read(await submit(slow.sessionId, "먼저옴"))).body.rank).toBe(1);
    expect((await read(await submit(best.sessionId, "일등"))).body.rank).toBe(1);
    expect((await read(await submit(fast.sessionId, "나중옴"))).body.rank).toBe(3);

    const { status, body } = await leaderboard("?mode=CATEGORY&category=science");
    expect(status).toBe(200);
    expect(body.map(({ rank, username, score }) => ({ rank, username, score }))).toEqual([
      { rank: 1, username: "일등", score: 192 },
      { rank: 2, username: "먼저옴", score: 132 },
      { rank: 3, username: "나중옴", score: 132 },
    ]);
  });

  it("모드·카테고리별로 순위표를 분리한다", async () => {
    const all = await playSession({ mode: "ALL" }, 40);
    const science = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 10);
    await submit(all.sessionId, "전체모드");
    await submit(science.sessionId, "과학모드");

    const allBoard = (await leaderboard("")).body;
    expect(allBoard.map((e) => [e.username, e.maxScore])).toEqual([["전체모드", 821]]);
    expect((await leaderboard("?mode=SPEED")).body).toEqual([]);

    const scienceBoard = (await leaderboard("?mode=CATEGORY&category=science")).body;
    expect(scienceBoard.map((e) => e.username)).toEqual(["과학모드"]);

    expect((await leaderboard("?mode=CATEGORY&category=geography")).body).toEqual([]);
  });

  it("응답 항목은 PRD 필드명(created_at)을 쓰고, limit 기본값은 10이다", async () => {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "general" } });
    for (let i = 0; i < 12; i++) {
      const session = await prisma.quizSession.create({
        data: { mode: "CATEGORY", categoryId: category.id, questionIds: [] },
      });
      await prisma.score.create({
        data: {
          sessionId: session.id,
          username: `user${i}`,
          score: i * 10,
          maxScore: 100,
          correctCount: i,
          totalCount: 10,
          mode: "CATEGORY",
          categoryId: category.id,
        },
      });
    }

    const top10 = (await leaderboard("?mode=CATEGORY&category=general")).body;
    expect(top10).toHaveLength(10);
    expect(Object.keys(top10[0]).sort()).toEqual(["created_at", "maxScore", "rank", "score", "username"]);
    expect(top10[0]).toMatchObject({ rank: 1, username: "user11" });

    const top50 = (await leaderboard("?mode=CATEGORY&category=general&limit=50")).body;
    expect(top50).toHaveLength(12);
  });

  it.each(["?limit=20", "?mode=CATEGORY", "?mode=WEEKLY"])("잘못된 쿼리 %s → 400", async (query) => {
    expect((await leaderboard(query)).status).toBe(400);
  });

  it("존재하지 않는 카테고리 → 404", async () => {
    expect((await leaderboard("?mode=CATEGORY&category=music")).status).toBe(404);
  });
});

describe("GET /api/health", () => {
  it("DB에 연결되면 200 ok", async () => {
    const { status, body } = await read(await getHealth());
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("DB 쿼리가 실패하면 503", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    try {
      const { status, body } = await read(await getHealth());
      expect(status).toBe(503);
      expect(body.status).toBe("error");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("답안 간격 제한 (세션당 1초)", () => {
  it("세션 시작 직후나 직전 답안 직후에 온 답안은 429이고 저장되지 않는다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });

    const tooFast = await answerNow(sessionId, questions[0].id, 0);
    expect(tooFast.status).toBe(429);
    expect(tooFast.headers.get("Retry-After")).toBe("1");
    expect((await tooFast.json()).error.message).toContain("너무 빨리");
    expect(await prisma.sessionAnswer.count()).toBe(0);

    advanceClock(MIN_ANSWER_INTERVAL_MS);
    expect((await answerNow(sessionId, questions[0].id, 0)).status).toBe(200);
    expect((await answerNow(sessionId, questions[1].id, 0)).status).toBe(429);
    advanceClock(MIN_ANSWER_INTERVAL_MS - 1);
    expect((await answerNow(sessionId, questions[1].id, 0)).status).toBe(429);
    advanceClock(1);
    expect((await answerNow(sessionId, questions[1].id, 0)).status).toBe(200);
  });

  it("같은 문제에 다른 보기를 동시에 보내도 하나만 받아들인다 (세션 행 잠금)", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    await openQuestion(sessionId, questions[0].id);
    advanceClock(MIN_ANSWER_INTERVAL_MS);

    const responses = await Promise.all([0, 1, 2, 3].map((i) => postAnswerOnly(sessionId, questions[0].id, i)));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    expect(await prisma.sessionAnswer.count({ where: { sessionId } })).toBe(1);
  });

  it("세션마다 따로 잰다: 다른 세션의 답안은 영향을 주지 않는다", async () => {
    const a = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const b = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    advanceClock(MIN_ANSWER_INTERVAL_MS);
    expect((await answerNow(a.sessionId, a.questions[0].id, 0)).status).toBe(200);
    expect((await answerNow(b.sessionId, b.questions[0].id, 0)).status).toBe(200);
  });
});

describe("IP별 요청 횟수 제한", () => {
  const { limit, windowSeconds } = RATE_LIMITS.createSession;
  const create = (xff: string) => postSession(request("/api/sessions", { mode: "ALL" }, xff));

  it("세션 생성: 같은 IP에서 한도를 넘으면 429와 Retry-After, 다른 IP는 영향 없음, 윈도가 지나면 풀린다", async () => {
    for (let i = 0; i < limit; i++) expect((await create("203.0.113.7")).status).toBe(201);

    const blocked = await create("203.0.113.7");
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);
    expect((await blocked.json()).error.code).toBe("TOO_MANY_REQUESTS");
    expect(await prisma.quizSession.count()).toBe(limit);

    expect((await create("203.0.113.8")).status).toBe(201);

    advanceClock(retryAfter * 1000);
    expect((await create("203.0.113.7")).status).toBe(201);
  });

  it("X-Forwarded-For 왼쪽에 다른 IP를 끼워 넣어도 우회되지 않는다 (오른쪽 끝 값으로 식별)", async () => {
    for (let i = 0; i < limit; i++) expect((await create(`198.51.100.${i}, 203.0.113.7`)).status).toBe(201);
    expect((await create("198.51.100.250, 203.0.113.7")).status).toBe(429);
  });

  it("검증에 실패하는 요청도 횟수에 포함한다 (본문을 읽기 전에 검사)", async () => {
    for (let i = 0; i < limit; i++) {
      expect((await postSession(request("/api/sessions", "{bad json", "203.0.113.9"))).status).toBe(400);
    }
    expect((await create("203.0.113.9")).status).toBe(429);
  });

  it("문제 열기·힌트·답안·점수 등록 라우트에도 한도가 걸려 있다", async () => {
    const { sessionId, questions } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 5);
    const windowStart = (seconds: number) =>
      new Date(Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000);
    // 현재 윈도의 카운터를 한도까지 채워 둔다 (unknown = X-Forwarded-For가 없는 요청).
    // playSession이 이미 answer 카운터를 만들었으므로 upsert로 덮어쓴다.
    for (const rule of ["openQuestion", "hint", "answer", "submitScore"] as const) {
      const where = {
        key_windowStart: { key: `${rule}:unknown`, windowStart: windowStart(RATE_LIMITS[rule].windowSeconds) },
      };
      const count = RATE_LIMITS[rule].limit;
      await prisma.rateLimit.upsert({ where, update: { count }, create: { ...where.key_windowStart, count } });
    }
    expect((await openQuestion(sessionId, questions[0].id)).status).toBe(429);
    expect((await requestHint(sessionId, questions[0].id)).status).toBe(429);
    expect((await postAnswerOnly(sessionId, questions[0].id, 0)).status).toBe(429);
    expect((await submit(sessionId, "한도초과")).status).toBe(429);
    expect(await prisma.score.count()).toBe(0);
  });
});

describe("세션 만료와 정리", () => {
  // 라우트를 거치면 세션 생성 시 정리 작업(maybeRunMaintenance)이 함께 돌므로, 정리 함수만 검증할 때는 DB에 직접 만든다.
  const insertSession = async (startedAt: Date) =>
    (await prisma.quizSession.create({ data: { mode: "ALL", questionIds: [], startedAt } })).id;

  it("시작 후 24시간이 지난 세션에는 답하거나 점수를 등록할 수 없다", async () => {
    const pending = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const done = await playSession({ mode: "CATEGORY", categorySlug: "geography" }, 5);

    advanceClock(SESSION_TTL_MS + 1000);
    const late = await answer(pending.sessionId, pending.questions[0].id, 0);
    expect(late.status).toBe(404);
    expect((await late.json()).error.message).toContain("만료");
    expect((await submit(done.sessionId, "늦은등록")).status).toBe(404);
  });

  it("만료된 미등록 세션(답안 포함)만 지우고, 순위표에 오른 세션과 최근 세션은 남긴다", async () => {
    const abandoned = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 3);
    const ranked = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 7);
    expect((await submit(ranked.sessionId, "남는기록")).status).toBe(201);

    advanceClock(SESSION_TTL_MS + 60_000);
    const fresh = await insertSession(new Date());

    expect(await cleanupExpiredSessions()).toBe(1);
    const remaining = (await prisma.quizSession.findMany({ select: { id: true } })).map((s) => s.id).sort();
    expect(remaining).toEqual([ranked.sessionId, fresh].sort());
    expect(await prisma.sessionAnswer.count({ where: { sessionId: abandoned.sessionId } })).toBe(0);
    expect(await prisma.score.count()).toBe(1);
  });

  it("세션 생성 라우트가 시간당 한 번 정리 작업을 실행한다", async () => {
    advanceClock(MAINTENANCE_INTERVAL_MS); // 이전 테스트에서 실행된 정리와 겹치지 않게
    const old = await insertSession(new Date(Date.now() - SESSION_TTL_MS - 60_000));
    await createSession({ mode: "ALL" });
    expect(await prisma.quizSession.count({ where: { id: old } })).toBe(0);
  });

  it("끝난 윈도의 요청 횟수 카운터를 지운다", async () => {
    const now = new Date();
    await prisma.rateLimit.createMany({
      data: [
        { key: "createSession:old", windowStart: new Date(now.getTime() - 2 * 60 * 60 * 1000), count: 5 },
        { key: "createSession:current", windowStart: new Date(now.getTime() - 60 * 1000), count: 5 },
      ],
    });
    expect(await pruneRateLimits(now)).toBe(1);
    expect((await prisma.rateLimit.findMany()).map((r) => r.key)).toEqual(["createSession:current"]);
  });

  it("정리 작업은 인스턴스마다 1시간에 한 번만 실행된다", async () => {
    const stale = () => insertSession(new Date(Date.now() - SESSION_TTL_MS - 60_000));
    const runIfDue = createMaintenanceRunner(); // 앱 공유 인스턴스와 상태가 섞이지 않게 새로 만든다

    const first = await stale();
    expect(await runIfDue()).toBe(true);
    expect(await prisma.quizSession.count({ where: { id: first } })).toBe(0);

    const second = await stale();
    expect(await runIfDue()).toBe(false); // 1시간이 지나지 않았으므로 실행되지 않는다
    expect(await prisma.quizSession.count({ where: { id: second } })).toBe(1);

    advanceClock(MAINTENANCE_INTERVAL_MS);
    expect(await runIfDue()).toBe(true);
    expect(await prisma.quizSession.count({ where: { id: second } })).toBe(0);
  });
});

describe("멱등성: 응답을 못 받아 같은 요청을 다시 보낸 경우", () => {
  it("같은 문제에 같은 보기로 다시 보내면 처음과 같은 결과(200)를 돌려주고, 저장은 한 번뿐이다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const q = questions[0];

    const first = await read(await answer(sessionId, q.id, 2));
    expect(first.status).toBe(200);
    // 재전송은 새 답안이 아니므로 1초 간격 제한에 걸리지 않는다(시계를 진행하지 않고 바로 보낸다).
    const replay = await read(await answerNow(sessionId, q.id, 2));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.sessionAnswer.count({ where: { sessionId } })).toBe(1);

    // 다른 보기로 바꿔 보내는 것은 재전송이 아니라 두 번째 답안이므로 409
    expect((await answerNow(sessionId, q.id, 3)).status).toBe(409);
  });

  it("마지막 문제의 재전송도 완료 처리를 망가뜨리지 않는다", async () => {
    const { sessionId, questions } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 4);
    const last = questions.at(-1)!;
    const stored = await prisma.sessionAnswer.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: last.id } },
    });
    expect(stored.selectedIndex).not.toBeNull();
    expect((await answerNow(sessionId, last.id, stored.selectedIndex)).status).toBe(200);
    const result = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
    expect(result.body).toMatchObject({ completed: true, answeredCount: 10, correctCount: 4 });
  });

  it("점수 등록을 같은 닉네임으로 다시 보내면 처음 결과를 200으로 돌려주고, 다른 닉네임은 409", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 6);
    const first = await read(await submit(sessionId, "재전송왕"));
    expect(first.status).toBe(201);

    const replay = await read(await submit(sessionId, "재전송왕"));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.score.count()).toBe(1);

    expect((await submit(sessionId, "다른이름")).status).toBe(409);
  });

  it("같은 세션의 점수 등록이 동시에 들어와도 한 건만 저장되고, 둘 다 같은 결과를 받는다", async () => {
    const { sessionId } = await playSession({ mode: "CATEGORY", categorySlug: "science" }, 6);
    const [a, b] = await Promise.all([submit(sessionId, "동시등록"), submit(sessionId, "동시등록")]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect(await prisma.score.count()).toBe(1);
  });
});

describe("헬스 체크 시간 제한", () => {
  it("DB 쿼리가 끝나지 않으면 무한정 기다리지 않고 3초 안에 503(timeout)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(prisma, "$queryRaw").mockImplementationOnce((() => new Promise(() => {})) as never);
    try {
      const started = performance.now();
      const { status, body } = await read(await getHealth());
      const elapsed = performance.now() - started;
      expect(status).toBe(503);
      expect(body).toEqual({ status: "error", database: "timeout" });
      expect(elapsed).toBeGreaterThanOrEqual(2_900);
      expect(elapsed).toBeLessThan(4_500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("결과 화면과 점수 등록의 일관성", () => {
  it("결과 화면의 점수·만점·정답 수와 순위표에 저장되는 값이 같다", async () => {
    for (const [body, correct] of [
      [{ mode: "CATEGORY", categorySlug: "science" }, 7],
      [{ mode: "ALL" }, 23],
    ] as const) {
      const { sessionId } = await playSession(body, correct);
      const result = await read(await getResult(request(`/api/sessions/${sessionId}/result`), ctx(sessionId)));
      expect((await submit(sessionId, "일관성검사")).status).toBe(201);

      const stored = await prisma.score.findUniqueOrThrow({ where: { sessionId } });
      expect({
        score: stored.score,
        maxScore: stored.maxScore,
        correctCount: stored.correctCount,
        totalCount: stored.totalCount,
      }).toEqual({
        score: result.body.score,
        maxScore: result.body.maxScore,
        correctCount: result.body.correctCount,
        totalCount: result.body.totalCount,
      });
    }
  });

  it("세션이 참조하는 문제는 지우거나 id를 바꿀 수 없다 (DB 트리거)", async () => {
    const { questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const referenced = questions[0].id;

    // 트리거는 foreign_key_violation으로 거부하므로 Prisma에는 일반 외래 키 위반(P2003)으로 보인다.
    const fkViolation = { code: "P2003" };
    await expect(prisma.question.delete({ where: { id: referenced } })).rejects.toMatchObject(fkViolation);
    await expect(
      prisma.question.update({ where: { id: referenced }, data: { id: 9_000 } }),
    ).rejects.toMatchObject(fkViolation);
    // 내용 수정(시드 upsert와 같은 경우)은 허용된다.
    const { explanation } = await prisma.question.findUniqueOrThrow({ where: { id: referenced } });
    await expect(
      prisma.question.update({ where: { id: referenced }, data: { explanation } }),
    ).resolves.toMatchObject({ id: referenced });
    expect(await prisma.question.count({ where: { id: referenced } })).toBe(1);
  });

  it("어떤 세션도 참조하지 않는 문제는 지울 수 있다", async () => {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "science" } });
    const temp = await prisma.question.create({
      data: { categoryId: category.id, question: "임시", options: ["a", "b", "c", "d"], answerIndex: 0, explanation: "임시" },
    });
    await expect(prisma.question.delete({ where: { id: temp.id } })).resolves.toMatchObject({ id: temp.id });
  });
});

describe("경계 입력: 라우트가 500 없이 거절한다", () => {
  it.each(["null", "[]", "42", '"ALL"', "true"])("객체가 아닌 JSON 본문 %s → POST 라우트 모두 400", async (text) => {
    const { sessionId } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    expect((await postSession(request("/api/sessions", text))).status).toBe(400);
    expect((await postView(request(`/api/sessions/${sessionId}/views`, text), ctx(sessionId))).status).toBe(400);
    expect((await postHint(request(`/api/sessions/${sessionId}/hints`, text), ctx(sessionId))).status).toBe(400);
    expect((await postAnswer(request(`/api/sessions/${sessionId}/answers`, text), ctx(sessionId))).status).toBe(400);
    expect((await postSubmit(request(`/api/sessions/${sessionId}/submit`, text), ctx(sessionId))).status).toBe(400);
  });

  it("본문 없는 POST → 400", async () => {
    const req = new NextRequest("http://localhost/api/sessions", { method: "POST" });
    const { status, body } = await read(await postSession(req));
    expect(status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
  });

  it("__proto__ 키가 든 본문은 정상 처리되고 Object.prototype을 오염시키지 않는다", async () => {
    const res = await postSession(request("/api/sessions", '{"mode":"ALL","__proto__":{"polluted":true}}'));
    expect(res.status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([2 ** 31, Number.MAX_SAFE_INTEGER])(
    "Postgres int4 범위를 넘는 questionId %d도 DB 오류(500) 없이 400",
    async (questionId) => {
      const { sessionId } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
      for (const res of [
        await openQuestion(sessionId, questionId),
        await requestHint(sessionId, questionId),
        await postAnswerOnly(sessionId, questionId, 0),
      ]) {
        const { status, body } = await read(res);
        expect(status).toBe(400);
        expect(body.error?.code).toBe("BAD_REQUEST");
      }
    },
  );

  it("대문자로 쓴 세션 id도 같은 세션으로 찾는다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const upper = sessionId.toUpperCase();
    expect((await answer(upper, questions[0].id, 0)).status).toBe(200);
    const result = await read(await getResult(request(`/api/sessions/${upper}/result`), ctx(upper)));
    expect(result.status).toBe(200);
    expect(result.body.answeredCount).toBe(1);
  });

  it("문제가 하나도 없는 카테고리로 시작하면 409", async () => {
    await prisma.category.create({ data: { slug: "empty-edge", name: "빈 카테고리", sortOrder: 99 } });
    try {
      const { status, body } = await read(
        await postSession(request("/api/sessions", { mode: "CATEGORY", categorySlug: "empty-edge" })),
      );
      expect(status).toBe(409);
      expect(body.error?.message).toContain("출제할 문제가 없습니다");
      // 빈 카테고리의 순위표는 빈 목록 (오류 아님)
      expect((await leaderboard("?mode=CATEGORY&category=empty-edge")).body).toEqual([]);
    } finally {
      await prisma.category.delete({ where: { slug: "empty-edge" } });
    }
  });
});

describe("요청 한도: 시간 창 경계", () => {
  const { limit, windowSeconds } = RATE_LIMITS.submitScore;
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(new Date("2026-10-30T05:00:00Z").getTime() / windowMs) * windowMs);
  const at = (offsetMs: number) => new Date(windowStart.getTime() + offsetMs);

  it("창이 끝나기 1ms 전에 막히면 Retry-After는 최소 1초, 창이 바뀌는 순간 다시 허용된다", async () => {
    for (let i = 0; i < limit; i++) await consumeRateLimit("submitScore", "198.51.100.77", at(0));

    await expect(consumeRateLimit("submitScore", "198.51.100.77", at(windowMs - 1))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      retryAfterSeconds: 1,
    });
    await expect(consumeRateLimit("submitScore", "198.51.100.77", at(windowMs))).resolves.toBeUndefined();
  });

  it("창이 시작되자마자 막히면 Retry-After는 창 길이 전체", async () => {
    for (let i = 0; i < limit; i++) await consumeRateLimit("submitScore", "198.51.100.78", at(0));
    await expect(consumeRateLimit("submitScore", "198.51.100.78", at(0))).rejects.toMatchObject({
      retryAfterSeconds: windowSeconds,
    });
  });

  it("규칙마다 카운터가 따로다 (점수 등록 한도를 다 써도 세션 생성은 가능)", async () => {
    for (let i = 0; i < limit; i++) await consumeRateLimit("submitScore", "198.51.100.79", at(0));
    await expect(consumeRateLimit("createSession", "198.51.100.79", at(0))).resolves.toBeUndefined();
  });
});

describe("POST /api/sessions/[id]/views (문제 열기)", () => {
  it("출제 순서대로만 열 수 있다: 앞 문제에 답하기 전에 다음 문제를 열면 409", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const early = await read(await openQuestion(sessionId, questions[1].id));
    expect(early.status).toBe(409);
    expect(early.body.error?.message).toContain("이전 문제");

    const first = await read(await openQuestion(sessionId, questions[0].id));
    expect(first).toEqual({
      status: 200,
      body: { questionId: questions[0].id, timeLimitMs: null, remainingMs: null, removedOptions: [] },
    });
    expect((await answer(sessionId, questions[0].id, 0)).status).toBe(200);
    expect((await openQuestion(sessionId, questions[1].id)).status).toBe(200);
  });

  it("열지 않은 문제에 답하면 409이고 저장되지 않는다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    advanceClock(MIN_ANSWER_INTERVAL_MS);
    const { status, body } = await read(await postAnswerOnly(sessionId, questions[0].id, 0));
    expect(status).toBe(409);
    expect(body.error?.message).toContain("문제를 먼저 불러와");
    expect(await prisma.sessionAnswer.count({ where: { sessionId } })).toBe(0);
  });

  it("다시 열어도 처음 연 시각을 쓴다 (스피드 모드 남은 시간이 그대로 줄어든다)", async () => {
    const { sessionId, questions } = await createSession({ mode: "SPEED" });
    const id = questions[0].id;
    expect((await read(await openQuestion(sessionId, id))).body).toMatchObject({
      timeLimitMs: SPEED_TIME_LIMIT_MS,
      remainingMs: SPEED_TIME_LIMIT_MS,
    });
    advanceClock(4000);
    expect((await read(await openQuestion(sessionId, id))).body).toMatchObject({ remainingMs: SPEED_TIME_LIMIT_MS - 4000 });
    advanceClock(SPEED_TIME_LIMIT_MS);
    expect((await read(await openQuestion(sessionId, id))).body).toMatchObject({ remainingMs: 0 });
    expect(await prisma.sessionQuestionView.count({ where: { sessionId } })).toBe(1);
  });

  it.each([UNKNOWN_SESSION_ID, "not-a-uuid"])("존재하지 않는 세션 %s → 404", async (id) => {
    expect((await openQuestion(id, 1)).status).toBe(404);
    expect((await requestHint(id, 1)).status).toBe(404);
  });

  it("세션에 없는 문제 → 400, 만료된 세션 → 404", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const history = await prisma.question.findFirstOrThrow({ where: { category: { slug: "korean-history" } } });
    expect((await openQuestion(sessionId, history.id)).status).toBe(400);
    expect((await requestHint(sessionId, history.id)).status).toBe(400);

    advanceClock(SESSION_TTL_MS + 1000);
    expect((await openQuestion(sessionId, questions[0].id)).status).toBe(404);
  });
});

describe("POST /api/sessions/[id]/hints (50:50)", () => {
  it("정답이 아닌 보기 2개를 지우고, 다시 요청하거나 문제를 다시 열어도 같은 보기를 돌려준다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const q = questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;
    await openQuestion(sessionId, q.id);

    const first = await read<{ questionId: number; removedOptions: number[] }>(await requestHint(sessionId, q.id));
    expect(first.status).toBe(200);
    expect(first.body.questionId).toBe(q.id);
    expect(first.body.removedOptions).toHaveLength(2);
    expect(first.body.removedOptions).not.toContain(correct);
    expect(first.body.removedOptions).toEqual([...first.body.removedOptions].sort((a, b) => a - b));

    expect((await read(await requestHint(sessionId, q.id))).body).toEqual(first.body);
    expect((await read(await openQuestion(sessionId, q.id))).body).toMatchObject({
      removedOptions: first.body.removedOptions,
    });
  });

  it("문제를 열기 전에는 409, 답한 뒤에는 409", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const q = questions[0];
    expect((await requestHint(sessionId, q.id)).status).toBe(409);

    expect((await answer(sessionId, q.id, 0)).status).toBe(200);
    const late = await read(await requestHint(sessionId, q.id));
    expect(late.status).toBe(409);
    expect(late.body.error?.message).toBe("이미 답한 문제입니다.");
    const view = await prisma.sessionQuestionView.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: q.id } },
    });
    expect(view.hintRemoved).toEqual([]);
  });

  it("힌트를 쓰고 맞히면 힌트 미사용 보너스가 없고, 답안에 힌트 사용이 기록된다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const q = questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;
    await openQuestion(sessionId, q.id);
    await requestHint(sessionId, q.id);

    const { body } = await read<Feedback>(await answer(sessionId, q.id, correct));
    expect(body.points).toMatchObject({ time: 3, hint: 0 });
    const stored = await prisma.sessionAnswer.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: q.id } },
    });
    expect(stored).toMatchObject({ hintUsed: true, isCorrect: true, timedOut: false });
  });
});

describe("답안 점수: 난이도 배수·시간·힌트·콤보", () => {
  const BASE: Record<string, number> = { EASY: 10, MEDIUM: 15, HARD: 20 };

  it("문제를 연 뒤 10초 안에 맞히면 시간 보너스, 10초가 지나면 없고, 오답은 0점에 연속이 끊긴다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "korean-history" });
    const key = await answerKey(questions.map((q) => q.id));
    const [q0, q1, q2] = questions;

    await openQuestion(sessionId, q0.id);
    advanceClock(9_999);
    const fast = await read<Feedback>(await postAnswerOnly(sessionId, q0.id, key.get(q0.id)!));
    const fastTotal = BASE[q0.difficulty] + 3 + 2;
    expect(fast.body).toMatchObject({
      isCorrect: true,
      timedOut: false,
      points: { base: BASE[q0.difficulty], time: 3, hint: 2, combo: 0, total: fastTotal },
      streak: 1,
      score: fastTotal,
    });

    await openQuestion(sessionId, q1.id);
    advanceClock(10_000);
    const slow = await read<Feedback>(await postAnswerOnly(sessionId, q1.id, key.get(q1.id)!));
    const slowTotal = BASE[q1.difficulty] + 2;
    expect(slow.body).toMatchObject({
      points: { base: BASE[q1.difficulty], time: 0, hint: 2, combo: 0, total: slowTotal },
      streak: 2,
      score: fastTotal + slowTotal,
    });
    const stored = await prisma.sessionAnswer.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: q1.id } },
    });
    expect(stored.elapsedMs).toBe(10_000);

    const wrong = await read<Feedback>(await answer(sessionId, q2.id, (key.get(q2.id)! + 1) % 4));
    expect(wrong.body).toMatchObject({
      isCorrect: false,
      points: { base: 0, time: 0, hint: 0, combo: 0, total: 0 },
      streak: 0,
      score: fastTotal + slowTotal,
    });
  });

  it("3연속째 정답에서 콤보 +2를 받는다", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "geography" });
    const key = await answerKey(questions.map((q) => q.id));
    const combos: number[] = [];
    for (const q of questions.slice(0, 3)) {
      combos.push((await read<Feedback>(await answer(sessionId, q.id, key.get(q.id)!))).body.points.combo);
    }
    expect(combos).toEqual([0, 0, 2]);
  });
});

describe("스피드 퀴즈 제한 시간", () => {
  async function speedFirstQuestion() {
    const session = await createSession({ mode: "SPEED" });
    const q = session.questions[0];
    const correct = (await answerKey([q.id])).get(q.id)!;
    await openQuestion(session.sessionId, q.id);
    return { sessionId: session.sessionId, session, q, correct };
  }

  it("제한 시간 + 여유(네트워크 지연) 안에 온 정답은 인정한다", async () => {
    const { sessionId, q, correct } = await speedFirstQuestion();
    advanceClock(SPEED_TIME_LIMIT_MS + SPEED_DEADLINE_GRACE_MS);
    const { body } = await read<Feedback>(await postAnswerOnly(sessionId, q.id, correct));
    expect(body).toMatchObject({ isCorrect: true, timedOut: false, points: { time: 0 } });
  });

  it("제한 시간 + 여유를 넘긴 답안은 정답이어도 시간 초과 오답이다", async () => {
    const { sessionId, q, correct } = await speedFirstQuestion();
    advanceClock(SPEED_TIME_LIMIT_MS + SPEED_DEADLINE_GRACE_MS + 1);
    const { status, body } = await read<Feedback>(await postAnswerOnly(sessionId, q.id, correct));
    expect(status).toBe(200);
    expect(body).toMatchObject({ isCorrect: false, timedOut: true, answerIndex: correct, points: { total: 0 } });
    const stored = await prisma.sessionAnswer.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: q.id } },
    });
    expect(stored).toMatchObject({ isCorrect: false, timedOut: true, selectedIndex: correct });
  });

  it("보기 없이(null) 보내면 시간 초과로 기록하고, 재전송은 같은 결과, 다른 보기는 409", async () => {
    const { sessionId, q, correct } = await speedFirstQuestion();
    advanceClock(SPEED_TIME_LIMIT_MS);
    const first = await read<Feedback>(await postAnswerOnly(sessionId, q.id, null));
    expect(first.body).toMatchObject({ isCorrect: false, timedOut: true, answerIndex: correct });
    expect(typeof first.body.explanation).toBe("string");

    const replay = await read(await postAnswerOnly(sessionId, q.id, null));
    expect(replay).toEqual(first);
    expect((await postAnswerOnly(sessionId, q.id, correct)).status).toBe(409);
    const stored = await prisma.sessionAnswer.findUniqueOrThrow({
      where: { sessionId_questionId: { sessionId, questionId: q.id } },
    });
    expect(stored.selectedIndex).toBeNull();
  });

  it("제한 시간이 없는 모드에서 보기 없이(null) 보내면 400", async () => {
    const { sessionId, questions } = await createSession({ mode: "CATEGORY", categorySlug: "science" });
    const { status, body } = await read(await answer(sessionId, questions[0].id, null));
    expect(status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(await prisma.sessionAnswer.count({ where: { sessionId } })).toBe(0);
  });

  it("결과에 시간 초과 수가 나오고, 점수는 스피드 순위표에 따로 쌓인다", async () => {
    const session = await createSession({ mode: "SPEED" });
    const key = await answerKey(session.questions.map((q) => q.id));
    for (const [i, q] of session.questions.entries()) {
      const res = await answer(session.sessionId, q.id, i < 3 ? null : key.get(q.id)!);
      expect(res.status).toBe(200);
    }

    const result = await read(await getResult(request(`/api/sessions/${session.sessionId}/result`), ctx(session.sessionId)));
    expect(result.body).toMatchObject({
      mode: "SPEED",
      completed: true,
      timedOutCount: 3,
      correctCount: SPEED_QUESTION_COUNT - 3,
      totalCount: SPEED_QUESTION_COUNT,
    });

    expect((await submit(session.sessionId, "번개손")).status).toBe(201);
    const speedBoard = (await leaderboard("?mode=SPEED")).body;
    expect(speedBoard.map((e) => [e.username, e.score])).toEqual([["번개손", result.body.score]]);
    expect((await leaderboard("")).body).toEqual([]);
  });
});
