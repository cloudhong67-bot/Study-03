"use client";

import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { ProgressBar } from "@/components/ProgressBar";
import { QuestionCard } from "@/components/QuestionCard";
import { StatusMessage } from "@/components/StatusMessage";
import { playFeedbackSound } from "@/lib/sound";
import { useOptionHotkeys } from "./use-option-hotkeys";
import { useQuizSession } from "./use-quiz-session";
import { useSoundPreference } from "./use-sound-preference";

export function QuizRunner({ categorySlug }: { categorySlug: string | null }) {
  const { soundOn, toggleSound } = useSoundPreference();
  const { state, question, isLast, start, select, next } = useQuizSession(categorySlug, (feedback) => {
    if (soundOn) playFeedbackSound(feedback.isCorrect);
  });
  const { session, loadError, index, selected, feedback, pending, answerError, correctCount, finishing } = state;

  useOptionHotkeys((i) => void select(i), feedback === null);

  if (loadError) {
    return (
      <StatusMessage icon="⚠️" message={loadError} alert>
        <button type="button" className={primaryButton} onClick={() => void start()}>
          다시 시도
        </button>
        <Link href="/" className={secondaryButton}>
          메인으로
        </Link>
      </StatusMessage>
    );
  }

  if (!session || !question) return <QuizSkeleton />;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <ProgressBar
            label={categorySlug ? question.category : "전체"}
            current={index + 1}
            total={session.questions.length}
            correctCount={correctCount}
          />
        </div>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? "효과음 끄기" : "효과음 켜기"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-base"
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
      </div>

      {/* key: 문제가 바뀌면 보기 상태·애니메이션을 새로 시작한다. (같은 부모의 형제와 key가 겹치면 안 됨) */}
      <QuestionCard
        key={`question-${question.id}`}
        category={question.category}
        question={question.question}
        options={question.options}
        selectedIndex={selected}
        answerIndex={feedback?.answerIndex ?? null}
        disabled={pending || feedback !== null || answerError !== null}
        onSelect={(i) => void select(i)}
      />

      {answerError && selected !== null && (
        <AnswerRetry message={answerError} selected={selected} pending={pending} onRetry={() => void select(selected)} />
      )}

      {feedback && (
        <FeedbackPanel
          isCorrect={feedback.isCorrect}
          correctOption={question.options[feedback.answerIndex]}
          explanation={feedback.explanation}
          isLast={isLast}
          onNext={next}
        />
      )}

      {finishing && <p className="text-center text-sm text-muted">결과를 집계하는 중…</p>}
    </div>
  );
}

function QuizSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="문제를 불러오는 중">
      <div className="h-6 w-1/2 animate-pulse rounded-full bg-border" />
      <div className="h-32 animate-pulse rounded-3xl bg-border" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}

/** 답안 전송 실패 안내. 고른 보기를 유지한 채 같은 보기로만 다시 보낸다 (useQuizSession 참고). */
function AnswerRetry({
  message,
  selected,
  pending,
  onRetry,
}: {
  message: string;
  selected: number;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-2xl bg-rose-50 p-4 text-center text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <p className="break-keep">{message}</p>
      <p className="text-xs opacity-80">고른 답({selected + 1}번)은 그대로 유지돼요. 다시 시도하면 같은 답으로 전송합니다.</p>
      <button type="button" className={primaryButton} disabled={pending} onClick={onRetry}>
        {pending ? "전송 중…" : "다시 시도"}
      </button>
    </div>
  );
}
