"use client";

import { useEffect } from "react";
import { useLatest } from "@/lib/use-latest";

/** 키보드 1~4로 보기를 고른다 (다음 문제는 포커스된 버튼에서 Enter). 조합키는 무시한다. */
export function useOptionHotkeys(onSelect: (optionIndex: number) => void, enabled: boolean) {
  // 콜백이 렌더마다 바뀌어도 리스너를 다시 달지 않도록 최신 콜백을 ref로 읽는다.
  const onSelectRef = useLatest(onSelect);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const n = Number(event.key);
      if (n >= 1 && n <= 4) onSelectRef.current(n - 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onSelectRef]);
}
