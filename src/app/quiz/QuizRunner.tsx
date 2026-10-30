"use client";

import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { Countdown } from "@/components/Countdown";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { ProgressBar } from "@/components/ProgressBar";
import { QuestionCard } from "@/components/QuestionCard";
import { StatusMessage } from "@/components/StatusMessage";
import type { QuizTarget } from "@/lib/routes";
import { NO_HINT_BONUS } from "@/lib/scoring";
import { playFeedbackSound } from "@/lib/sound";
import { useOptionHotkeys } from "./use-option-hotkeys";
import { useQuizSession } from "./use-quiz-session";
import { useSoundPreference } from "./use-sound-preference";

export function QuizRunner({ mode, categorySlug }: QuizTarget) {
  const { soundOn, toggleSound } = useSoundPreference();
  const { state, question, isLast, hintAvailable, start, retryOpen, select, retryAnswer, hint, next } = useQuizSession(
    { mode, categorySlug },
    (feedback) => {
      if (soundOn) playFeedbackSound(feedback.isCorrect);
    },
  );
  const {
    session,
    loadError,
    index,
    opened,
    openError,
    deadline,
    removed,
    hintPending,
    hintError,
    selected,
    timeUp,
    feedback,
    pending,
    answerError,
    correctCount,
    score,
    streak,
    finishing,
  } = state;

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

  const label = categorySlug ? question.category : session.mode === "SPEED" ? "스피드" : "전체";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <ProgressBar label={label} current={index + 1} total={session.questions.length} correctCount={correctCount} />
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

      <p className="flex items-center justify-between text-sm" aria-live="polite">
        <span>
          점수 <strong className="tabular-nums text-indigo-600 dark:text-indigo-400">{score}</strong>점
        </span>
        {streak >= 2 && <span className="font-semibold text-amber-600 dark:text-amber-400">🔥 {streak}연속 정답</span>}
      </p>

      {/* key: 문제가 바뀌면 타이머를 새로 시작한다 */}
      {session.timeLimitMs !== null && deadline !== null && (
        <Countdown
          key={`countdown-${question.id}`}
          deadline={deadline}
          totalMs={session.timeLimitMs}
          stopped={feedback !== null || pending || timeUp}
        />
      )}

      {/* key: 문제가 바뀌면 보기 상태·애니메이션을 새로 시작한다. (같은 부모의 형제와 key가 겹치면 안 됨) */}
      <QuestionCard
        key={`question-${question.id}`}
        category={question.category}
        difficulty={question.difficulty}
        question={question.question}
        options={question.options}
        selectedIndex={selected}
        answerIndex={feedback?.answerIndex ?? null}
        removed={removed}
        disabled={!opened || pending || hintPending || timeUp || feedback !== null || answerError !== null}
        onSelect={(i) => void select(i)}
      />

      {openError && (
        <InlineError message={openError}>
          <button type="button" className={primaryButton} onClick={retryOpen}>
            문제 다시 불러오기
          </button>
        </InlineError>
      )}

      {!feedback && !openError && (
        <div className="space-y-2">
          <button
            type="button"
            className={secondaryButton}
            disabled={!hintAvailable}
            onClick={() => void hint()}
            aria-describedby="hint-cost"
          >
            {hintPending ? "힌트 불러오는 중…" : removed.length > 0 ? "💡 50:50 힌트 사용함" : "💡 50:50 힌트"}
          </button>
          <p id="hint-cost" className="text-center text-xs text-muted">
            오답 2개를 지워 줘요. 힌트를 쓴 문제는 힌트 미사용 보너스(+{NO_HINT_BONUS}점)를 받지 못해요.
          </p>
          {hintError && (
            <p role="alert" className="text-center text-sm text-rose-600 dark:text-rose-400">
              {hintError}
            </p>
          )}
        </div>
      )}

      {answerError && (
        <InlineError message={answerError}>
          <p className="text-xs opacity-80">
            {timeUp || selected === null
              ? "시간 초과로 처리된 답을 다시 전송합니다."
              : `고른 답(${selected + 1}번)은 그대로 유지돼요. 다시 시도하면 같은 답으로 전송합니다.`}
          </p>
          <button type="button" className={primaryButton} disabled={pending} onClick={() => void retryAnswer()}>
            {pending ? "전송 중…" : "다시 시도"}
          </button>
        </InlineError>
      )}

      {feedback && (
        <FeedbackPanel
          isCorrect={feedback.isCorrect}
          timedOut={feedback.timedOut}
          points={feedback.points}
          streak={feedback.streak}
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

/** 문제 열기·답안 전송 실패 안내 (답안은 보낸 답을 유지한 채 같은 답으로만 다시 보낸다, useQuizSession 참고) */
function InlineError({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-2xl bg-rose-50 p-4 text-center text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <p className="break-keep">{message}</p>
      {children}
    </div>
  );
}
