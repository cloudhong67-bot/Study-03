"use client";

import { useEffect } from "react";
import type { GameResultInput } from "@/lib/data-manager";
import { recordLocalGame } from "@/lib/use-local-history";

/** 결과 화면을 열면 이 브라우저의 내 기록에 자동으로 저장한다. 같은 세션은 한 번만 센다. */
export function SaveLocalResult({ sessionId, result }: { sessionId: string; result: GameResultInput }) {
  useEffect(() => {
    recordLocalGame(sessionId, result);
  }, [sessionId, result]);

  return null;
}
