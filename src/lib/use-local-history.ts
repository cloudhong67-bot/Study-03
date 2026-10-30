import { useSyncExternalStore } from "react";
import {
  HISTORY_STORAGE_KEY,
  LocalDataManager,
  type GameResultInput,
  type KeyValueStorage,
  type LocalHistory,
} from "@/lib/data-manager";

// 브라우저 하나에 관리자 하나. localStorage를 외부 저장소로 보고 useSyncExternalStore로 구독한다
// (use-sound-preference와 같은 방식). 서버 렌더·hydration 때는 null(아직 모름)이다.

let manager: LocalDataManager | undefined;

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // 쿠키·저장소 차단 시 접근만으로 SecurityError가 난다.
  }
}

function getManager(): LocalDataManager {
  manager ??= new LocalDataManager(browserStorage());
  return manager;
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === HISTORY_STORAGE_KEY) getManager().reload();
}

function subscribe(listener: () => void) {
  const unsubscribe = getManager().subscribe(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => getManager().load();
const getServerSnapshot = () => null;

/** 이 브라우저에 저장된 내 게임 기록과 통계. 서버 렌더와 hydration 중에는 null. */
export function useLocalHistory(): LocalHistory | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** 끝난 게임을 기록한다. 같은 세션은 한 번만 센다. */
export function recordLocalGame(sessionId: string, result: GameResultInput): boolean {
  return getManager().recordGame(sessionId, result);
}

export function clearLocalHistory(): void {
  getManager().clear();
}
