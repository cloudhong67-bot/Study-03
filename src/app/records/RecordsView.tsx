"use client";

import Link from "next/link";
import { useState } from "react";
import { dangerButton, primaryButton, secondaryButton } from "@/components/button-styles";
import type { GameRecord, LocalStats } from "@/lib/data-manager";
import { leaderboardHref, quizHref, type QuizMode } from "@/lib/routes";
import { calculateAccuracy } from "@/lib/scoring";
import { clearLocalHistory, useLocalHistory } from "@/lib/use-local-history";

const MODE_LABELS: Record<QuizMode, string> = {
  ALL: "전체 도전",
  CATEGORY: "카테고리별",
  SPEED: "⚡ 스피드",
};

// 순위표와 같은 시간대로 보여 준다.
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatDate = (iso: string) => dateFormat.format(new Date(iso));

function gameLabel(game: GameRecord) {
  return game.category ? `${game.category}` : MODE_LABELS[game.mode];
}

export function RecordsView() {
  const history = useLocalHistory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">📊 내 기록</h1>
        <p className="mt-1 break-keep text-sm text-muted">
          이 기기(브라우저)에만 저장되는 기록이에요. 순위표와는 따로 관리돼요.
        </p>
      </div>

      {history === null ? (
        <p role="status" className="rounded-3xl border border-border bg-surface p-8 text-center text-muted">
          기록을 불러오는 중…
        </p>
      ) : history.stats.gamesPlayed === 0 ? (
        <p className="break-keep rounded-3xl border border-dashed border-border bg-surface p-8 text-center text-muted">
          아직 저장된 기록이 없어요. 퀴즈를 끝까지 풀면 결과가 자동으로 저장돼요.
        </p>
      ) : (
        <>
          <StatsSummary stats={history.stats} />
          <ModeStatsSection stats={history.stats} />
          <CategoryStatsSection stats={history.stats} />
          <RecentGames games={history.games} total={history.stats.gamesPlayed} />
          <ClearHistory />
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={quizHref()} className={primaryButton}>
          게임 시작
        </Link>
        <Link href={leaderboardHref()} className={secondaryButton}>
          🏆 순위 보기
        </Link>
      </div>
    </div>
  );
}

function StatsSummary({ stats }: { stats: LocalStats }) {
  const items = [
    { label: "플레이", value: `${stats.gamesPlayed}판` },
    { label: "평균 정답률", value: `${calculateAccuracy(stats.totalCorrect, stats.totalQuestions)}%` },
    { label: "최고 연속 정답", value: `${stats.bestStreak}개` },
    { label: "맞힌 문제", value: `${stats.totalCorrect} / ${stats.totalQuestions}` },
  ];
  return (
    <section aria-label="전체 통계" className="space-y-2">
      <dl className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-xs text-muted">{item.label}</dt>
            <dd className="text-xl font-bold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {stats.lastPlayedAt && (
        <p className="text-right text-xs text-muted">마지막 플레이 {formatDate(stats.lastPlayedAt)}</p>
      )}
    </section>
  );
}

function ModeStatsSection({ stats }: { stats: LocalStats }) {
  return (
    <section aria-labelledby="mode-stats" className="space-y-2">
      <h2 id="mode-stats" className="font-bold">
        모드별
      </h2>
      <div className="overflow-hidden rounded-3xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs text-muted">
            <tr>
              <th scope="col" className="py-2 pl-4 text-left font-semibold">모드</th>
              <th scope="col" className="py-2 text-right font-semibold">플레이</th>
              <th scope="col" className="py-2 text-right font-semibold">최고</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">평균</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(MODE_LABELS) as QuizMode[]).map((mode) => {
              const m = stats.byMode[mode];
              return (
                <tr key={mode} className="border-t border-border">
                  <th scope="row" className="py-2 pl-4 text-left font-semibold">{MODE_LABELS[mode]}</th>
                  <td className="py-2 text-right tabular-nums">{m.games}</td>
                  <td className="py-2 text-right tabular-nums">{m.games ? m.bestScore : "–"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {m.games ? Math.round(m.totalScore / m.games) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryStatsSection({ stats }: { stats: LocalStats }) {
  if (stats.byCategory.length === 0) return null;
  return (
    <section aria-labelledby="category-stats" className="space-y-2">
      <h2 id="category-stats" className="font-bold">
        카테고리별
      </h2>
      <p className="break-keep text-xs text-muted">정답률은 모든 모드의 결과, 최고 점수는 카테고리별 모드의 결과예요.</p>
      <ul className="space-y-3 rounded-3xl border border-border bg-surface p-4">
        {stats.byCategory.map((c) => {
          const accuracy = calculateAccuracy(c.correct, c.total);
          return (
            <li key={c.category} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{c.category}</span>
                <span className="tabular-nums text-muted">
                  {c.correct}/{c.total} · {accuracy}%
                  {c.bestScore !== null && ` · 최고 ${c.bestScore}점 (${c.games}판)`}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${c.category} 정답률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={accuracy}
                className="h-2 overflow-hidden rounded-full bg-background"
              >
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${accuracy}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecentGames({ games, total }: { games: readonly GameRecord[]; total: number }) {
  return (
    <section aria-labelledby="recent-games" className="space-y-2">
      <h2 id="recent-games" className="font-bold">
        최근 게임 <span className="text-sm font-normal text-muted">({games.length}판{total > games.length && ` · 최근 ${games.length}판만 보관`})</span>
      </h2>
      <ol className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
        {games.map((g) => (
          <li key={g.sessionId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold">{gameLabel(g)}</p>
              <p className="text-xs text-muted tabular-nums">
                {formatDate(g.playedAt)} · {g.correctCount}/{g.totalCount} 정답
                {g.timedOutCount > 0 && ` · 시간 초과 ${g.timedOutCount}`}
              </p>
            </div>
            <p className="shrink-0 font-bold tabular-nums">
              {g.score}
              <span className="text-xs font-normal text-muted">/{g.maxScore}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClearHistory() {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className={secondaryButton} onClick={() => setConfirming(true)}>
        🗑️ 기록 지우기
      </button>
    );
  }
  return (
    <div role="group" aria-label="기록 지우기 확인" className="space-y-3 rounded-3xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/40">
      <p className="break-keep text-sm text-rose-800 dark:text-rose-200">
        이 기기에 저장된 게임 기록과 통계를 모두 지울까요? 순위표에 등록한 점수는 지워지지 않아요.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className={dangerButton}
          onClick={() => {
            clearLocalHistory();
            setConfirming(false);
          }}
        >
          모두 지우기
        </button>
        <button type="button" className={secondaryButton} onClick={() => setConfirming(false)}>
          취소
        </button>
      </div>
    </div>
  );
}
