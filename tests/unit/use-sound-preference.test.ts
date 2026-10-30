// @vitest-environment jsdom
// use-sound-preference는 모듈 수준 상태(현재 값·구독자)를 가지므로, 테스트마다 모듈을 새로 불러온다.
// React와 Testing Library도 함께 새로 불러와야 같은 React 인스턴스를 공유한다.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cleanupCurrent: (() => void) | undefined;

async function fresh() {
  vi.resetModules();
  const rtl = await import("@testing-library/react");
  const { useSoundPreference } = await import("@/app/quiz/use-sound-preference");
  cleanupCurrent = rtl.cleanup;
  return { ...rtl, useSoundPreference };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanupCurrent?.();
  vi.restoreAllMocks();
});

describe("useSoundPreference", () => {
  it("저장값이 없으면 켜짐, 끄면 저장소에 'off'로 남는다", async () => {
    const { renderHook, act, useSoundPreference } = await fresh();
    const { result } = renderHook(() => useSoundPreference());
    expect(result.current.soundOn).toBe(true);
    act(() => result.current.toggleSound());
    expect(result.current.soundOn).toBe(false);
    expect(localStorage.getItem("trivia:sound")).toBe("off");
    act(() => result.current.toggleSound());
    expect(localStorage.getItem("trivia:sound")).toBe("on");
  });

  it("저장값이 'off'면 처음부터 꺼짐으로 그린다", async () => {
    localStorage.setItem("trivia:sound", "off");
    const { renderHook, useSoundPreference } = await fresh();
    expect(renderHook(() => useSoundPreference()).result.current.soundOn).toBe(false);
  });

  it("같은 화면의 여러 사용처가 같은 값을 공유한다", async () => {
    const { renderHook, act, useSoundPreference } = await fresh();
    const a = renderHook(() => useSoundPreference());
    const b = renderHook(() => useSoundPreference());
    act(() => a.result.current.toggleSound());
    expect(b.result.current.soundOn).toBe(false);
  });

  it("다른 탭에서 바꾸면(storage 이벤트) 따라 바뀌고, 관계없는 키의 이벤트는 무시한다", async () => {
    const { renderHook, act, useSoundPreference } = await fresh();
    const { result } = renderHook(() => useSoundPreference());

    act(() => {
      localStorage.setItem("other-app", "x");
      window.dispatchEvent(new StorageEvent("storage", { key: "other-app" }));
    });
    expect(result.current.soundOn).toBe(true);

    act(() => {
      localStorage.setItem("trivia:sound", "off");
      window.dispatchEvent(new StorageEvent("storage", { key: "trivia:sound" }));
    });
    expect(result.current.soundOn).toBe(false);
  });

  it("다른 탭이 저장소를 통째로 비우면(key=null) 기본값(켜짐)으로 돌아간다", async () => {
    localStorage.setItem("trivia:sound", "off");
    const { renderHook, act, useSoundPreference } = await fresh();
    const { result } = renderHook(() => useSoundPreference());
    expect(result.current.soundOn).toBe(false);
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current.soundOn).toBe(true);
  });

  it("저장소를 쓸 수 없는 환경에서도 이번 방문 동안은 메모리로 켜고 끈다", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { renderHook, act, useSoundPreference } = await fresh();
    const { result } = renderHook(() => useSoundPreference());
    expect(result.current.soundOn).toBe(true);
    act(() => result.current.toggleSound());
    expect(result.current.soundOn).toBe(false);
  });

  it("마지막 사용처가 사라지면 storage 리스너를 떼어 낸다", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { renderHook, useSoundPreference } = await fresh();
    const a = renderHook(() => useSoundPreference());
    const b = renderHook(() => useSoundPreference());
    a.unmount();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(0);
    b.unmount();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
  });

  it("서버 렌더링은 저장소를 읽지 않고 기본값(켜짐)으로 그린다 (hydration 불일치 방지)", async () => {
    localStorage.setItem("trivia:sound", "off");
    const { useSoundPreference } = await fresh();
    const { renderToString } = await import("react-dom/server");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    function Probe() {
      return createElement("span", null, useSoundPreference().soundOn ? "on" : "off");
    }
    expect(renderToString(createElement(Probe))).toContain("on");
    expect(getItem).not.toHaveBeenCalled();
  });
});
