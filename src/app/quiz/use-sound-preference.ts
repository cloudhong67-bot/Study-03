"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadSoundEnabled, saveSoundEnabled } from "@/lib/sound";

// 효과음 설정을 외부 저장소(localStorage)로 보고 useSyncExternalStore로 구독한다.
// - 서버 렌더·hydration 때는 기본값(켜짐)을 쓰고, 이후 저장된 값으로 바뀐다 (불일치·추가 렌더 없음)
// - 다른 탭에서 바꾸면(storage 이벤트) 따라 바뀐다
// - 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서도 이번 방문 동안은 메모리 값으로 유지된다

let current: boolean | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith("trivia:")) return;
  current = loadSoundEnabled();
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): boolean {
  current ??= loadSoundEnabled();
  return current;
}

const getServerSnapshot = () => true;

/** 효과음 켜기/끄기. 선택은 이 브라우저(localStorage)에 기억한다. */
export function useSoundPreference() {
  const soundOn = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleSound = useCallback(() => {
    current = !getSnapshot();
    saveSoundEnabled(current);
    notify();
  }, []);

  return { soundOn, toggleSound };
}
