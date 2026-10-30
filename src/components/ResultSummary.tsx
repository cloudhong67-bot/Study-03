import type { QuizResult } from "@/lib/quiz/sessions";

function verdict(accuracy: number) {
  if (accuracy === 100) return "완벽해요! 상식 마스터 🏆";
  if (accuracy >= 80) return "훌륭해요! 👏";
  if (accuracy >= 50) return "좋아요, 조금만 더! 💪";
  return "다시 도전해 볼까요? 📚";
}

export function ResultSummary({ result }: { result: QuizResult }) {
  return (
    <section aria-label="결과 요약" className="space-y-4">
      <div className="rounded-3xl border border-border bg-surface p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-muted">
          {result.category ? `${result.category} 퀴즈` : "전체 40문제"} 최종 점수
        </p>
        <p className="mt-2 font-extrabold tabular-nums">
          <span className="text-5xl text-indigo-600 dark:text-indigo-400">{result.score}</span>
          <span className="text-xl text-muted"> / {result.maxScore}점</span>
        </p>
        <p className="mt-2 font-semibold">{verdict(result.accuracy)}</p>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl bg-background p-3">
            <dt className="text-xs text-muted">정답률</dt>
            <dd className="text-xl font-bold tabular-nums">{result.accuracy}%</dd>
          </div>
          <div className="rounded-2xl bg-background p-3">
            <dt className="text-xs text-muted">맞힌 문제</dt>
            <dd className="text-xl font-bold tabular-nums">
              {result.correctCount} <span className="text-sm text-muted">/ {result.totalCount}</span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-bold">카테고리별 맞힌 개수</h2>
        <ul className="mt-3 space-y-3">
          {result.byCategory.map((c) => {
            const percent = c.total === 0 ? 0 : Math.round((c.correct / c.total) * 100);
            return (
              <li key={c.category}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{c.category}</span>
                  <span className="tabular-nums text-muted">
                    {c.correct} / {c.total}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-border" aria-hidden>
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
