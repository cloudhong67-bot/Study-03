// @vitest-environment jsdom
// 퀴즈 진행 훅: 서버 통신·문제 열기·힌트·1초 간격 맞추기·제한 시간·재시도·실패 후 보기 고정·완료 이동.
// fetch와 라우터를 가짜로 바꾸고, 가짜 시계로 시간 흐름을 직접 진행한다.
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuizSession } from "@/app/quiz/use-quiz-session";
import { MIN_ANSWER_INTERVAL_MS, SPEED_TIME_LIMIT_MS } from "@/lib/limits";
import type { QuizTarget } from "@/lib/routes";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const question = (id: number) => ({
  id,
  category: "과학",
  difficulty: "EASY",
  question: `Q${id}`,
  options: ["a", "b", "c", "d"],
});
const SESSION = { sessionId: "s-1", mode: "CATEGORY", timeLimitMs: null, questions: [question(11), question(12)] };
const SPEED_SESSION = { ...SESSION, mode: "SPEED", timeLimitMs: SPEED_TIME_LIMIT_MS };
const CORRECT = {
  isCorrect: true,
  timedOut: false,
  answerIndex: 1,
  explanation: "해설",
  points: { base: 10, time: 3, hint: 2, combo: 0, total: 15 },
  streak: 1,
  score: 15,
};
const TIMED_OUT = {
  ...CORRECT,
  isCorrect: false,
  timedOut: true,
  points: { base: 0, time: 0, hint: 0, combo: 0, total: 0 },
  streak: 0,
  score: 0,
};

type Reply = { status: number; body?: unknown } | Error;
type Route = "create" | "views" | "hints" | "answers";
let fetchMock: ReturnType<typeof vi.fn>;
let queues: Record<Route, Reply[]>;

function routeOf(url: string): Route {
  if (url.endsWith("/views")) return "views";
  if (url.endsWith("/hints")) return "hints";
  if (url.endsWith("/answers")) return "answers";
  return "create";
}

/**
 * 요청 종류별로 응답을 순서대로 준비한다. Error는 네트워크 실패.
 * 문제 열기(views)는 준비한 응답이 없으면 "제한 시간 없음, 힌트 안 씀"으로 성공한다.
 */
function replies(list: Partial<Record<Route, Reply[]>>) {
  queues = { create: [], views: [], hints: [], answers: [], ...list };
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const route = routeOf(String(url));
    const reply =
      queues[route].shift() ??
      (route === "views"
        ? {
            status: 200,
            body: { questionId: JSON.parse(init.body as string).questionId, timeLimitMs: null, remainingMs: null, removedOptions: [] },
          }
        : new TypeError(`준비한 ${route} 응답이 없음`));
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      json: async () => reply.body ?? null,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
}

const callsTo = (route: Route) => fetchMock.mock.calls.filter(([url]) => routeOf(String(url)) === route);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

/** 가짜 시계를 ms만큼 진행하고 그사이 생긴 상태 변화를 반영한다. */
async function elapse(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startedHook(target: QuizTarget = { mode: "CATEGORY", categorySlug: "science" }, onFeedback?: () => void) {
  const hook = renderHook(() => useQuizSession(target, onFeedback));
  await elapse();
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  router.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("세션 시작", () => {
  it("StrictMode에서 effect가 두 번 실행돼도 세션은 하나만 만든다", async () => {
    replies({ create: [{ status: 201, body: SESSION }] });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    renderHook(() => useQuizSession({ mode: "CATEGORY", categorySlug: "science" }), { wrapper });
    await elapse();
    expect(callsTo("create")).toHaveLength(1);
    expect(bodyOf(callsTo("create")[0])).toEqual({ mode: "CATEGORY", categorySlug: "science" });
  });

  it.each([
    [{ mode: "ALL" } as QuizTarget, { mode: "ALL" }],
    [{}, { mode: "ALL" }],
    [{ mode: "SPEED" } as QuizTarget, { mode: "SPEED" }],
  ])("%j → 세션 생성 요청 %j", async (target, body) => {
    replies({ create: [{ status: 201, body: SESSION }] });
    await startedHook(target);
    expect(bodyOf(callsTo("create")[0])).toEqual(body);
  });

  it("세션을 만들면 첫 문제를 열고, 열기 전에는 고를 수 없다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], views: [new TypeError("offline"), new TypeError("offline"), new TypeError("offline")] });
    const { result } = await startedHook();
    expect(bodyOf(callsTo("views")[0])).toEqual({ questionId: 11 });
    expect(result.current.state.opened).toBe(false);

    act(() => void result.current.select(1));
    await elapse(5_000);
    expect(callsTo("answers")).toHaveLength(0);
    expect(result.current.state.openError).toContain("네트워크");

    // 다시 불러오기 (자동 재시도 2번은 이미 썼다)
    act(() => result.current.retryOpen());
    await elapse();
    expect(callsTo("views")).toHaveLength(4);
    expect(result.current.state).toMatchObject({ opened: true, openError: null });
  });

  it("시작에 실패하면 안내를 보여 주고 자동으로 다시 보내지 않는다 (재전송마다 세션이 생기므로)", async () => {
    replies({ create: [new TypeError("Failed to fetch"), { status: 201, body: SESSION }] });
    const { result } = await startedHook();
    await elapse(5_000);
    expect(result.current.state.loadError).toContain("네트워크");
    expect(callsTo("create")).toHaveLength(1);
    expect(callsTo("views")).toHaveLength(0);
  });
});

describe("답안 전송", () => {
  it("세션 시작 직후 고르면 1초를 채운 뒤에 보낸다 (그동안 고른 보기는 '채점 중')", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }] });
    const onFeedback = vi.fn();
    const { result } = await startedHook(undefined, onFeedback);

    act(() => void result.current.select(1));
    expect(result.current.state).toMatchObject({ selected: 1, pending: true });
    await elapse(MIN_ANSWER_INTERVAL_MS - 1);
    expect(callsTo("answers")).toHaveLength(0);

    await elapse(1);
    expect(callsTo("answers")).toHaveLength(1);
    expect(bodyOf(callsTo("answers")[0])).toEqual({ questionId: 11, selectedIndex: 1 });
    expect(result.current.state).toMatchObject({ feedback: CORRECT, pending: false, correctCount: 1, score: 15, streak: 1 });
    expect(onFeedback).toHaveBeenCalledWith(CORRECT);
  });

  it("이미 1초가 지났으면 기다리지 않고 바로 보낸다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }] });
    const { result } = await startedHook();
    await elapse(5_000);
    act(() => void result.current.select(0));
    await elapse(0);
    expect(callsTo("answers")).toHaveLength(1);
  });

  it("같은 순간에 두 번 눌러도 한 번만 보낸다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }, { status: 200, body: CORRECT }] });
    const { result } = await startedHook();
    act(() => {
      void result.current.select(0);
      void result.current.select(2);
    });
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(callsTo("answers")).toHaveLength(1);
    expect(result.current.state.selected).toBe(0);
  });

  it("채점이 끝난 문제나 범위 밖 상태에서는 고를 수 없다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }] });
    const { result } = await startedHook();
    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => void result.current.select(2));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(callsTo("answers")).toHaveLength(1);
  });

  it("네트워크가 계속 끊기면 2번 재시도 후 실패를 알리고, 고른 보기는 고정된다", async () => {
    const offline = new TypeError("Failed to fetch");
    replies({ create: [{ status: 201, body: SESSION }], answers: [offline, offline, offline, { status: 200, body: CORRECT }] });
    const { result } = await startedHook();

    act(() => void result.current.select(2));
    await elapse(MIN_ANSWER_INTERVAL_MS + 500 + 1_500);
    expect(callsTo("answers")).toHaveLength(3);
    expect(result.current.state).toMatchObject({ selected: 2, pending: false });
    expect(result.current.state.answerError).toContain("네트워크");

    // 다른 보기로는 바꿀 수 없다 (서버에 이미 기록됐을 수 있음)
    act(() => void result.current.select(0));
    await elapse(0);
    expect(callsTo("answers")).toHaveLength(3);

    // 같은 보기의 재전송은 허용된다 ([다시 시도]도 같은 보기를 보낸다)
    act(() => void result.current.retryAnswer());
    await elapse(0);
    expect(callsTo("answers")).toHaveLength(4);
    expect(bodyOf(callsTo("answers")[3])).toEqual({ questionId: 11, selectedIndex: 2 });
    expect(result.current.state).toMatchObject({ feedback: CORRECT, answerError: null });
  });

  it("세션이 만료(404)되면 새 퀴즈 시작 화면으로 바꾸고, 다시 시작하면 처음부터 진행한다", async () => {
    const expired = { error: { code: "NOT_FOUND", message: "만료된 세션입니다. 새 퀴즈를 시작해 주세요." } };
    replies({
      create: [{ status: 201, body: SESSION }, { status: 201, body: { ...SESSION, sessionId: "s-2" } }],
      answers: [{ status: 404, body: expired }],
    });
    const { result } = await startedHook();

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(result.current.state).toMatchObject({ loadError: expired.error.message, pending: false });

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toMatchObject({ loadError: null, index: 0, selected: null, correctCount: 0, opened: true });
    expect(result.current.state.session?.sessionId).toBe("s-2");
  });

  it("응답을 기다리는 사이 바뀐 콜백(예: 효과음 끄기)이 있으면 최신 콜백을 부른다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }] });
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useQuizSession({ categorySlug: "science" }, cb), {
      initialProps: { cb: first },
    });
    await elapse();
    act(() => void result.current.select(1));
    rerender({ cb: second });
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(CORRECT);
  });
});

describe("50:50 힌트", () => {
  it("지운 보기를 받으면 그 보기는 고를 수 없고, 같은 문제에 다시 쓸 수 없다", async () => {
    replies({
      create: [{ status: 201, body: SESSION }],
      hints: [{ status: 200, body: { questionId: 11, removedOptions: [0, 3] } }],
      answers: [{ status: 200, body: CORRECT }],
    });
    const { result } = await startedHook();
    expect(result.current.hintAvailable).toBe(true);

    act(() => void result.current.hint());
    expect(result.current.state.hintPending).toBe(true);
    await elapse();
    expect(bodyOf(callsTo("hints")[0])).toEqual({ questionId: 11 });
    expect(result.current.state.removed).toEqual([0, 3]);
    expect(result.current.hintAvailable).toBe(false);

    act(() => void result.current.hint());
    act(() => void result.current.select(0));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(callsTo("hints")).toHaveLength(1);
    expect(callsTo("answers")).toHaveLength(0);
  });

  it("힌트 요청이 실패하면 안내하고 다시 쓸 수 있다", async () => {
    const conflict = { error: { code: "CONFLICT", message: "이미 답한 문제입니다." } };
    replies({ create: [{ status: 201, body: SESSION }], hints: [{ status: 409, body: conflict }] });
    const { result } = await startedHook();
    act(() => void result.current.hint());
    await elapse();
    expect(result.current.state.hintError).toBe("이미 답한 문제입니다.");
    expect(result.current.hintAvailable).toBe(true);
  });

  it("다시 연 문제에 이미 쓴 힌트가 있으면 그 상태로 시작한다", async () => {
    replies({
      create: [{ status: 201, body: SESSION }],
      views: [{ status: 200, body: { questionId: 11, timeLimitMs: null, remainingMs: null, removedOptions: [1, 2] } }],
    });
    const { result } = await startedHook();
    expect(result.current.state.removed).toEqual([1, 2]);
    expect(result.current.hintAvailable).toBe(false);
  });
});

describe("스피드 퀴즈 제한 시간", () => {
  const speedView = (remainingMs: number) => ({
    status: 200,
    body: { questionId: 11, timeLimitMs: SPEED_TIME_LIMIT_MS, remainingMs, removedOptions: [] },
  });

  it("남은 시간이 끝나면 보기 없이(null) 답안을 보내 시간 초과로 처리한다", async () => {
    replies({ create: [{ status: 201, body: SPEED_SESSION }], views: [speedView(SPEED_TIME_LIMIT_MS)], answers: [{ status: 200, body: TIMED_OUT }] });
    const { result } = await startedHook({ mode: "SPEED" });
    expect(result.current.state.deadline).toBe(Date.now() + SPEED_TIME_LIMIT_MS);

    await elapse(SPEED_TIME_LIMIT_MS - 1);
    expect(callsTo("answers")).toHaveLength(0);
    await elapse(1);
    expect(bodyOf(callsTo("answers")[0])).toEqual({ questionId: 11, selectedIndex: null });
    expect(result.current.state).toMatchObject({ timeUp: true, feedback: TIMED_OUT });
  });

  it("서버가 알려 준 남은 시간(재시도로 늦게 받은 경우)을 기준으로 한다", async () => {
    replies({ create: [{ status: 201, body: SPEED_SESSION }], views: [speedView(3000)], answers: [{ status: 200, body: TIMED_OUT }] });
    await startedHook({ mode: "SPEED" });
    await elapse(3000);
    expect(callsTo("answers")).toHaveLength(1);
  });

  it("시간 안에 고르면 타이머가 멈추고 시간 초과 답안을 보내지 않는다", async () => {
    replies({ create: [{ status: 201, body: SPEED_SESSION }], views: [speedView(SPEED_TIME_LIMIT_MS)], answers: [{ status: 200, body: CORRECT }] });
    const { result } = await startedHook({ mode: "SPEED" });
    await elapse(2000);
    act(() => void result.current.select(1));
    await elapse(SPEED_TIME_LIMIT_MS * 2);
    expect(callsTo("answers")).toHaveLength(1);
    expect(bodyOf(callsTo("answers")[0]).selectedIndex).toBe(1);
  });

  it("시간 초과 답안 전송이 실패하면 [다시 시도]가 null을 다시 보낸다", async () => {
    const offline = new TypeError("Failed to fetch");
    replies({
      create: [{ status: 201, body: SPEED_SESSION }],
      views: [speedView(1000)],
      answers: [offline, offline, offline, { status: 200, body: TIMED_OUT }],
    });
    const { result } = await startedHook({ mode: "SPEED" });
    await elapse(1000 + 500 + 1500);
    expect(result.current.state).toMatchObject({ timeUp: true, pending: false });
    expect(result.current.state.answerError).toContain("네트워크");

    // 실패한 뒤에는 타이머가 다시 보내지 않고, 보기도 고를 수 없다
    await elapse(SPEED_TIME_LIMIT_MS);
    act(() => void result.current.select(1));
    await elapse();
    expect(callsTo("answers")).toHaveLength(3);

    act(() => void result.current.retryAnswer());
    await elapse();
    expect(bodyOf(callsTo("answers")[3])).toEqual({ questionId: 11, selectedIndex: null });
    expect(result.current.state.feedback).toEqual(TIMED_OUT);
  });
});

describe("다음 문제·완료", () => {
  it("마지막이 아니면 다음 문제를 열고, 마지막이면 결과 화면으로 이동한다", async () => {
    replies({ create: [{ status: 201, body: SESSION }], answers: [{ status: 200, body: CORRECT }, { status: 200, body: CORRECT }] });
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const { result } = await startedHook();

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => result.current.next());
    expect(result.current.state).toMatchObject({ index: 1, selected: null, feedback: null, opened: false });
    expect(result.current.isLast).toBe(true);
    expect(scrollTo).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    await elapse();
    expect(bodyOf(callsTo("views")[1])).toEqual({ questionId: 12 });
    expect(result.current.state.opened).toBe(true);

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => result.current.next());
    expect(result.current.state.finishing).toBe(true);
    expect(router.push).toHaveBeenCalledWith("/result/s-1");
  });

  it("세션이 없을 때 next·retryOpen·hint는 아무것도 하지 않는다", async () => {
    replies({ create: [new TypeError("offline")] });
    const { result } = await startedHook();
    act(() => {
      result.current.next();
      result.current.retryOpen();
      void result.current.hint();
      void result.current.retryAnswer();
    });
    await elapse();
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.state.index).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
