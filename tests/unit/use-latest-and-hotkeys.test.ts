// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOptionHotkeys } from "@/app/quiz/use-option-hotkeys";
import { useLatest } from "@/lib/use-latest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLatest", () => {
  it("다시 렌더링하면 같은 ref 객체에 최신 값이 들어 있다", () => {
    const { result, rerender } = renderHook(({ value }) => useLatest(value), { initialProps: { value: 1 } });
    const ref = result.current;
    expect(ref.current).toBe(1);
    rerender({ value: 2 });
    expect(result.current).toBe(ref);
    expect(ref.current).toBe(2);
  });

  it("undefined·null 같은 값도 그대로 보관한다", () => {
    const { result, rerender } = renderHook(({ value }) => useLatest<number | null | undefined>(value), {
      initialProps: { value: 1 as number | null | undefined },
    });
    rerender({ value: null });
    expect(result.current.current).toBeNull();
    rerender({ value: undefined });
    expect(result.current.current).toBeUndefined();
  });
});

describe("useOptionHotkeys", () => {
  const press = (key: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));

  it("1~4를 보기 0~3으로 바꿔 전달한다", () => {
    const onSelect = vi.fn();
    renderHook(() => useOptionHotkeys(onSelect, true));
    for (const key of ["1", "2", "3", "4"]) press(key);
    expect(onSelect.mock.calls).toEqual([[0], [1], [2], [3]]);
  });

  it.each(["0", "5", "9", "a", "Enter", " ", "", "１"])("보기 번호가 아닌 키 %j는 무시한다", (key) => {
    const onSelect = vi.fn();
    renderHook(() => useOptionHotkeys(onSelect, true));
    press(key);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])("조합키(%o)와 함께 누르면 무시한다 (브라우저 단축키 보호)", (mod) => {
    const onSelect = vi.fn();
    renderHook(() => useOptionHotkeys(onSelect, true));
    press("1", mod);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift는 조합키로 보지 않는다 (일부 키보드 배열에서 숫자 입력에 쓰임)", () => {
    const onSelect = vi.fn();
    renderHook(() => useOptionHotkeys(onSelect, true));
    press("2", { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("비활성화하면 키를 받지 않고, 다시 켜면 받는다", () => {
    const onSelect = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useOptionHotkeys(onSelect, enabled), {
      initialProps: { enabled: false },
    });
    press("1");
    expect(onSelect).not.toHaveBeenCalled();
    rerender({ enabled: true });
    press("1");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("콜백이 바뀌어도 리스너를 다시 달지 않고 최신 콜백을 부른다", () => {
    const add = vi.spyOn(window, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useOptionHotkeys(cb, true), { initialProps: { cb: first } });
    rerender({ cb: second });
    press("3");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(2);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
  });

  it("언마운트하면 리스너를 떼어 낸다 (화면을 떠난 뒤 키 입력 무시)", () => {
    const onSelect = vi.fn();
    const { unmount } = renderHook(() => useOptionHotkeys(onSelect, true));
    unmount();
    press("1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
