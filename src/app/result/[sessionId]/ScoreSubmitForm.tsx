"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { primaryButton } from "@/components/button-styles";
import { ApiError, errorMessage, postJson } from "@/lib/http-client";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/lib/limits";
import type { SubmittedScore } from "@/lib/quiz/scores";
import { leaderboardHref, type QuizMode } from "@/lib/routes";

interface ScoreSubmitFormProps {
  sessionId: string;
  submitted: boolean;
  mode: QuizMode;
  categorySlug: string | null;
}

export function ScoreSubmitForm({ sessionId, submitted, mode, categorySlug }: ScoreSubmitFormProps) {
  const router = useRouter();
  const inputId = useId();
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (submitted) {
    return (
      <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted">
        ✅ 이미 순위표에 등록한 기록입니다.
      </p>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      // 점수 등록은 멱등이다(같은 닉네임으로 다시 보내면 서버가 처음 결과를 돌려준다) → 자동 재시도해도 안전하다.
      const data = await postJson<SubmittedScore>(`/api/sessions/${sessionId}/submit`, { username }, { retries: 2 });
      router.push(leaderboardHref({ mode, categorySlug, highlight: data.rank, limit: data.rank > 10 ? 50 : 10 }));
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
      // 다른 탭 등에서 이미 등록했다면 서버 기준 상태(“이미 등록”)로 화면을 다시 그린다.
      if (e instanceof ApiError && e.code === "CONFLICT") router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-3xl border border-border bg-surface p-5 shadow-sm">
      <label htmlFor={inputId} className="block text-sm font-bold">
        닉네임을 입력하고 순위표에 등록하세요
      </label>
      <input
        id={inputId}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        minLength={USERNAME_MIN_LENGTH}
        maxLength={USERNAME_MAX_LENGTH}
        autoComplete="nickname"
        enterKeyHint="send"
        placeholder={`${USERNAME_MIN_LENGTH}~${USERNAME_MAX_LENGTH}자`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="min-h-12 w-full rounded-2xl border border-border bg-background px-4 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "등록 중…" : "점수 등록"}
      </button>
    </form>
  );
}
