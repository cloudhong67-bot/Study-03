"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
  /** 마감 시각 (Date.now() 기준 ms) */
  deadline: number;
  totalMs: number;
  /** 답을 보냈으면 멈춘다 */
  stopped: boolean;
}

const TICK_MS = 100;
/** 이 시간 이하로 남으면 경고 색으로 바꾼다 */
const WARNING_MS = 5000;

/** 스피드 퀴즈의 남은 시간 표시. 시간 초과 처리는 useQuizSession의 타이머가 맡는다. */
export function Countdown({ deadline, totalMs, stopped }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (stopped) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [stopped]);

  // 첫 틱 전(렌더 중에는 시계를 읽지 않는다)에는 전체 시간을 보여 준다.
  const clamped = now === null ? totalMs : Math.min(Math.max(0, deadline - now), totalMs);
  const seconds = Math.ceil(clamped / 1000);
  const warning = clamped <= WARNING_MS;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">⏱ 남은 시간</span>
        <span
          className={`font-bold tabular-nums ${warning ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}
          aria-live={warning ? "polite" : "off"}
        >
          {seconds}초
        </span>
      </div>
      <div
        role="timer"
        aria-label={`남은 시간 ${seconds}초`}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className={`h-full rounded-full ${warning ? "bg-rose-500" : "bg-amber-500"}`}
          style={{ width: `${(clamped / totalMs) * 100}%` }}
        />
      </div>
    </div>
  );
}
