import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { ResultSummary } from "@/components/ResultSummary";
import { orNotFound } from "@/lib/page-helpers";
import { getResult } from "@/lib/quiz/sessions";
import { leaderboardHref, quizHref, RECORDS_HREF } from "@/lib/routes";
import { sessionIdSchema } from "@/lib/validation";
import { SaveLocalResult } from "./SaveLocalResult";
import { ScoreSubmitForm } from "./ScoreSubmitForm";

export const metadata: Metadata = { title: "결과 | 지식와 도전" };

function loadResult(sessionId: string) {
  if (!sessionIdSchema.safeParse(sessionId).success) notFound();
  return orNotFound(getResult(sessionId));
}

export default async function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const result = await loadResult(sessionId);
  const target = { mode: result.mode, categorySlug: result.categorySlug };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">퀴즈 결과</h1>

      {!result.completed && (
        <p role="status" className="break-keep rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          아직 {result.totalCount - result.answeredCount}문제를 풀지 않은 퀴즈입니다. 모든 문제를 풀어야 순위표에
          등록할 수 있어요.
        </p>
      )}

      <ResultSummary result={result} />

      {result.completed && (
        <SaveLocalResult
          sessionId={sessionId}
          result={{
            mode: result.mode,
            category: result.category,
            categorySlug: result.categorySlug,
            completed: result.completed,
            score: result.score,
            maxScore: result.maxScore,
            correctCount: result.correctCount,
            totalCount: result.totalCount,
            maxStreak: result.maxStreak,
            timedOutCount: result.timedOutCount,
            byCategory: result.byCategory,
          }}
        />
      )}

      {result.completed && (
        <ScoreSubmitForm
          sessionId={sessionId}
          submitted={result.submitted}
          mode={result.mode}
          categorySlug={result.categorySlug}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={quizHref(target)} className={result.completed ? secondaryButton : primaryButton}>
          🔄 다시 도전
        </Link>
        <Link href={leaderboardHref(target)} className={secondaryButton}>
          🏆 순위 보기
        </Link>
      </div>

      {result.completed && (
        <p className="text-center text-sm text-muted">
          이 결과는 이 기기의{" "}
          <Link href={RECORDS_HREF} className="font-semibold text-indigo-600 underline dark:text-indigo-400">
            📊 내 기록
          </Link>
          에 자동으로 저장돼요.
        </p>
      )}
    </div>
  );
}
