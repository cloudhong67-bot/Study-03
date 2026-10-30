"use client";

import { useEffect, useRef } from "react";
import { primaryButton } from "@/components/button-styles";

interface FeedbackPanelProps {
  isCorrect: boolean;
  correctOption: string;
  explanation: string;
  isLast: boolean;
  onNext: () => void;
}

export function FeedbackPanel({ isCorrect, correctOption, explanation, isLast, onNext }: FeedbackPanelProps) {
  const nextRef = useRef<HTMLButtonElement>(null);

  // 채점 직후 [다음 문제]로 포커스를 옮겨 키보드(Enter)로 바로 넘어갈 수 있게 한다.
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
    nextRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <div className="space-y-4 motion-safe:animate-rise">
      <div
        role="status"
        aria-live="polite"
        className={`rounded-3xl border-2 p-5 ${
          isCorrect
            ? "border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/40"
            : "border-rose-500/60 bg-rose-50 dark:bg-rose-950/40"
        }`}
      >
        <p
          className={`text-lg font-extrabold ${
            isCorrect ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {isCorrect ? "🎉 정답입니다!" : "😢 아쉬워요, 오답입니다"}
        </p>
        {!isCorrect && (
          <p className="mt-2 break-keep font-semibold">
            정답: <span className="text-emerald-700 dark:text-emerald-300">{correctOption}</span>
          </p>
        )}
        <p className="mt-2 break-keep text-sm leading-relaxed text-muted">{explanation}</p>
      </div>
      <button ref={nextRef} type="button" onClick={onNext} className={primaryButton}>
        {isLast ? "결과 보기" : "다음 문제"} →
      </button>
    </div>
  );
}
