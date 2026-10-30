// @vitest-environment jsdom
// 퀴즈 진행 훅: 서버 통신·1초 간격 맞추기·재시도·실패 후 보기 고정·완료 이동.
// fetch와 라우터를 가짜로 바꾸고, 가짜 시계로 시간 흐름을 직접 진행한다.
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuizSession } from "@/app/quiz/use-quiz-session";
import { MIN_ANSWER_INTERVAL_MS } from "@/lib/limits";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const question = (id: number) => ({ id, category: "과학", question: `Q${id}`, options: ["a", "b", "c", "d"] });
const SESSION = { sessionId: "s-1", questions: [question(11), question(12)] };
const CORRECT = { isCorrect: true, answerIndex: 1, explanation: "해설" };

type Reply = { status: number; body?: unknown } | Error;
let fetchMock: ReturnType<typeof vi.fn>;

/** 요청 순서대로 응답을 준비한다. Error는 네트워크 실패. */
function replies(...list: Reply[]) {
  fetchMock = vi.fn();
  for (const r of list) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else
      fetchMock.mockResolvedValueOnce({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: () => null },
        json: async () => r.body ?? null,
      });
  }
  vi.stubGlobal("fetch", fetchMock);
}

const callsTo = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

/** 가짜 시계를 ms만큼 진행하고 그사이 생긴 상태 변화를 반영한다. */
async function elapse(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startedHook(categorySlug: string | null = "science", onFeedback?: () => void) {
  const hook = renderHook(() => useQuizSession(categorySlug, onFeedback));
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
    replies({ status: 201, body: SESSION });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    renderHook(() => useQuizSession("science"), { wrapper });
    await elapse();
    expect(callsTo("/api/sessions")).toHaveLength(1);
    expect(bodyOf(callsTo("/api/sessions")[0])).toEqual({ mode: "CATEGORY", categorySlug: "science" });
  });

  it("카테고리가 없으면 전체 모드로 시작한다", async () => {
    replies({ status: 201, body: SESSION });
    await startedHook(null);
    expect(bodyOf(callsTo("/api/sessions")[0])).toEqual({ mode: "ALL" });
  });

  it("시작에 실패하면 안내를 보여 주고 자동으로 다시 보내지 않는다 (재전송마다 세션이 생기므로)", async () => {
    replies(new TypeError("Failed to fetch"), { status: 201, body: SESSION });
    const { result } = await startedHook();
    await elapse(5_000);
    expect(result.current.state.loadError).toContain("네트워크");
    expect(callsTo("/api/sessions")).toHaveLength(1);
  });
});

describe("답안 전송", () => {
  it("세션 시작 직후 고르면 1초를 채운 뒤에 보낸다 (그동안 고른 보기는 '채점 중')", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT });
    const onFeedback = vi.fn();
    const { result } = await startedHook("science", onFeedback);

    act(() => void result.current.select(1));
    expect(result.current.state).toMatchObject({ selected: 1, pending: true });
    await elapse(MIN_ANSWER_INTERVAL_MS - 1);
    expect(callsTo("/answers")).toHaveLength(0);

    await elapse(1);
    expect(callsTo("/answers")).toHaveLength(1);
    expect(bodyOf(callsTo("/answers")[0])).toEqual({ questionId: 11, selectedIndex: 1 });
    expect(result.current.state).toMatchObject({ feedback: CORRECT, pending: false, correctCount: 1 });
    expect(onFeedback).toHaveBeenCalledWith(CORRECT);
  });

  it("이미 1초가 지났으면 기다리지 않고 바로 보낸다", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT });
    const { result } = await startedHook();
    await elapse(5_000);
    act(() => void result.current.select(0));
    await elapse(0);
    expect(callsTo("/answers")).toHaveLength(1);
  });

  it("같은 순간에 두 번 눌러도 한 번만 보낸다", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT }, { status: 200, body: CORRECT });
    const { result } = await startedHook();
    act(() => {
      void result.current.select(0);
      void result.current.select(2);
    });
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(callsTo("/answers")).toHaveLength(1);
    expect(result.current.state.selected).toBe(0);
  });

  it("채점이 끝난 문제나 범위 밖 상태에서는 고를 수 없다", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT });
    const { result } = await startedHook();
    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => void result.current.select(2));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(callsTo("/answers")).toHaveLength(1);
  });

  it("네트워크가 계속 끊기면 2번 재시도 후 실패를 알리고, 고른 보기는 고정된다", async () => {
    const offline = new TypeError("Failed to fetch");
    replies({ status: 201, body: SESSION }, offline, offline, offline, { status: 200, body: CORRECT });
    const { result } = await startedHook();

    act(() => void result.current.select(2));
    await elapse(MIN_ANSWER_INTERVAL_MS + 500 + 1_500);
    expect(callsTo("/answers")).toHaveLength(3);
    expect(result.current.state).toMatchObject({ selected: 2, pending: false });
    expect(result.current.state.answerError).toContain("네트워크");

    // 다른 보기로는 바꿀 수 없다 (서버에 이미 기록됐을 수 있음)
    act(() => void result.current.select(0));
    await elapse(0);
    expect(callsTo("/answers")).toHaveLength(3);

    // 같은 보기의 재전송은 허용된다
    act(() => void result.current.select(2));
    await elapse(0);
    expect(callsTo("/answers")).toHaveLength(4);
    expect(bodyOf(callsTo("/answers")[3])).toEqual({ questionId: 11, selectedIndex: 2 });
    expect(result.current.state).toMatchObject({ feedback: CORRECT, answerError: null });
  });

  it("세션이 만료(404)되면 새 퀴즈 시작 화면으로 바꾸고, 다시 시작하면 처음부터 진행한다", async () => {
    const expired = { error: { code: "NOT_FOUND", message: "만료된 세션입니다. 새 퀴즈를 시작해 주세요." } };
    replies({ status: 201, body: SESSION }, { status: 404, body: expired }, { status: 201, body: { ...SESSION, sessionId: "s-2" } });
    const { result } = await startedHook();

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    expect(result.current.state).toMatchObject({ loadError: expired.error.message, pending: false });

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toMatchObject({ loadError: null, index: 0, selected: null, correctCount: 0 });
    expect(result.current.state.session?.sessionId).toBe("s-2");
  });

  it("응답을 기다리는 사이 바뀐 콜백(예: 효과음 끄기)이 있으면 최신 콜백을 부른다", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT });
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useQuizSession("science", cb), {
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

describe("다음 문제·완료", () => {
  it("마지막이 아니면 다음 문제로, 마지막이면 결과 화면으로 이동한다", async () => {
    replies({ status: 201, body: SESSION }, { status: 200, body: CORRECT }, { status: 200, body: CORRECT });
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const { result } = await startedHook();

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => result.current.next());
    expect(result.current.state).toMatchObject({ index: 1, selected: null, feedback: null });
    expect(result.current.isLast).toBe(true);
    expect(scrollTo).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    act(() => void result.current.select(1));
    await elapse(MIN_ANSWER_INTERVAL_MS);
    act(() => result.current.next());
    expect(result.current.state.finishing).toBe(true);
    expect(router.push).toHaveBeenCalledWith("/result/s-1");
  });

  it("세션이 없을 때 next는 아무것도 하지 않는다", async () => {
    replies(new TypeError("offline"));
    const { result } = await startedHook();
    act(() => result.current.next());
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.state.index).toBe(0);
  });
});
