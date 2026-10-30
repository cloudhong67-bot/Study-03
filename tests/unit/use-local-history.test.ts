// @vitest-environment jsdom
// use-local-history는 모듈 수준 상태(관리자 하나)를 가지므로, 테스트마다 모듈을 새로 불러온다.
// React와 Testing Library도 함께 새로 불러와야 같은 React 인스턴스를 공유한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameResultInput } from "@/lib/data-manager";

let cleanupCurrent: (() => void) | undefined;

async function fresh() {
  vi.resetModules();
  const rtl = await import("@testing-library/react");
  const hook = await import("@/lib/use-local-history");
  cleanupCurrent = rtl.cleanup;
  return { ...rtl, ...hook };
}

const result: GameResultInput = {
  mode: "CATEGORY",
  category: "과학",
  categorySlug: "science",
  completed: true,
  score: 152,
  maxScore: 217,
  correctCount: 7,
  totalCount: 10,
  maxStreak: 4,
  timedOutCount: 0,
  byCategory: [{ category: "과학", correct: 7, total: 10 }],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanupCurrent?.();
  vi.restoreAllMocks();
});

describe("useLocalHistory", () => {
  it("기록하면 구독 중인 화면이 바로 바뀌고 localStorage에 남는다", async () => {
    const { renderHook, act, useLocalHistory, recordLocalGame } = await fresh();
    const { result: hook } = renderHook(() => useLocalHistory());
    expect(hook.current?.stats.gamesPlayed).toBe(0);

    act(() => {
      recordLocalGame("a", result);
    });
    expect(hook.current?.games.map((g) => g.sessionId)).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem("trivia:history")!).games).toHaveLength(1);
  });

  it("서버 렌더에서는 null(아직 모름)이다", async () => {
    const { useLocalHistory } = await fresh();
    const { renderToString } = await import("react-dom/server");
    const { createElement } = await import("react");
    function Probe() {
      return createElement("span", null, useLocalHistory() === null ? "null" : "loaded");
    }
    expect(renderToString(createElement(Probe))).toContain("null");
  });

  it("다른 탭이 기록을 지우면(storage 이벤트) 따라 바뀌고, 관계없는 키는 무시한다", async () => {
    const { renderHook, act, useLocalHistory, recordLocalGame } = await fresh();
    const { result: hook } = renderHook(() => useLocalHistory());
    act(() => {
      recordLocalGame("a", result);
    });

    const before = hook.current;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "trivia:sound" }));
    });
    expect(hook.current).toBe(before);

    localStorage.removeItem("trivia:history");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "trivia:history" }));
    });
    expect(hook.current?.games).toEqual([]);
  });

  it("clearLocalHistory는 기록과 통계를 모두 지운다", async () => {
    const { renderHook, act, useLocalHistory, recordLocalGame, clearLocalHistory } = await fresh();
    const { result: hook } = renderHook(() => useLocalHistory());
    act(() => {
      recordLocalGame("a", result);
      clearLocalHistory();
    });
    expect(hook.current?.stats.gamesPlayed).toBe(0);
    expect(localStorage.getItem("trivia:history")).toBeNull();
  });

  it("localStorage 접근이 막혀도(SecurityError) 메모리로 동작한다", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { renderHook, act, useLocalHistory, recordLocalGame } = await fresh();
    const { result: hook } = renderHook(() => useLocalHistory());
    act(() => {
      recordLocalGame("a", result);
    });
    expect(hook.current?.stats.gamesPlayed).toBe(1);
  });
});
