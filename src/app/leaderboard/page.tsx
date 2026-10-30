import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { PERIOD_DESCRIPTIONS, PERIOD_LABELS } from "@/lib/leaderboard-period";
import { flattenSearchParams, orNotFound, type SearchParams } from "@/lib/page-helpers";
import { listCategories } from "@/lib/quiz/categories";
import { getLeaderboard } from "@/lib/quiz/scores";
import { SPEED_QUESTION_COUNT, SPEED_TIME_LIMIT_MS } from "@/lib/limits";
import { LEADERBOARD_PERIODS, leaderboardHref, quizHref } from "@/lib/routes";
import { leaderboardQuerySchema, type LeaderboardQuery } from "@/lib/validation";

export const metadata: Metadata = { title: "순위표 | 지식와 도전" };

const DEFAULT_QUERY: LeaderboardQuery = { mode: "ALL", category: undefined, period: "all", limit: 10 };

/** 잘못된 쿼리는 오류 화면 대신 기본 순위표(전체, Top 10)를 보여 준다. */
function parseQuery(params: Record<string, string | undefined>): LeaderboardQuery {
  const parsed = leaderboardQuerySchema.safeParse(params);
  return parsed.success ? parsed.data : DEFAULT_QUERY;
}

const tabClass = (active: boolean) =>
  `inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold transition ${
    active
      ? "bg-indigo-600 text-white"
      : "border border-border bg-surface text-foreground hover:border-indigo-400"
  }`;

const segmentClass = (active: boolean) =>
  `inline-flex items-center justify-center rounded-full font-semibold ${
    active ? "bg-indigo-600 text-white" : "text-muted"
  }`;

export default async function LeaderboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = flattenSearchParams(await searchParams);
  const query = parseQuery(params);
  // 등록 직후의 순위는 전체 기간 기준이라, 주간·일일 순위표에서는 강조하지 않는다.
  const highlight = query.period === "all" ? Number(params.highlight) : NaN;

  const [categories, entries] = await Promise.all([listCategories(), orNotFound(getLeaderboard(query))]);

  const activeSlug = query.category ?? null;
  const isSpeed = query.mode === "SPEED";
  const activeCategory = categories.find((c) => c.slug === activeSlug);
  const activeName = activeCategory?.name ?? (isSpeed ? "스피드" : "전체");
  const totalQuestions = categories.reduce((sum, c) => sum + c.questionCount, 0);
  const description = activeCategory
    ? `${activeCategory.name} ${activeCategory.questionCount}문제`
    : isSpeed
      ? `스피드 ${Math.min(SPEED_QUESTION_COUNT, totalQuestions)}문제 · 문제당 ${SPEED_TIME_LIMIT_MS / 1000}초`
      : `전체 ${totalQuestions}문제`;
  const target = { mode: query.mode, categorySlug: activeSlug };
  const board = { period: query.period, limit: query.limit };
  const periodTitle = query.period === "all" ? "" : `${PERIOD_LABELS[query.period]} `;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">🏆 순위표</h1>
        <p className="mt-1 break-keep text-sm text-muted">
          {description} · {PERIOD_DESCRIPTIONS[query.period]} · 동점이면 먼저 기록한 순
        </p>
      </div>

      <nav aria-label="순위표 종류" className="flex flex-wrap gap-2">
        <Link
          href={leaderboardHref(board)}
          className={tabClass(query.mode === "ALL")}
          aria-current={query.mode === "ALL" ? "page" : undefined}
        >
          전체
        </Link>
        <Link
          href={leaderboardHref({ mode: "SPEED", ...board })}
          className={tabClass(isSpeed)}
          aria-current={isSpeed ? "page" : undefined}
        >
          ⚡ 스피드
        </Link>
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={leaderboardHref({ categorySlug: c.slug, ...board })}
            className={tabClass(c.slug === activeSlug)}
            aria-current={c.slug === activeSlug ? "page" : undefined}
          >
            {c.name}
          </Link>
        ))}
      </nav>

      <div role="group" aria-label="순위표 기간" className="grid grid-cols-3 rounded-full border border-border bg-surface p-1 text-sm">
        {LEADERBOARD_PERIODS.map((period) => (
          <Link
            key={period}
            href={leaderboardHref({ ...target, period, limit: query.limit })}
            aria-current={query.period === period ? "page" : undefined}
            className={`${segmentClass(query.period === period)} min-h-10`}
          >
            {PERIOD_LABELS[period]}
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">
          {activeName} {periodTitle}Top {query.limit}
        </h2>
        <div role="group" aria-label="표시 개수" className="flex shrink-0 rounded-full border border-border bg-surface p-1 text-xs">
          {[10, 50].map((limit) => (
            <Link
              key={limit}
              href={leaderboardHref({ ...target, period: query.period, limit })}
              aria-current={query.limit === limit ? "page" : undefined}
              className={`${segmentClass(query.limit === limit)} px-3 py-1.5`}
            >
              Top {limit}
            </Link>
          ))}
        </div>
      </div>

      <LeaderboardTable
        entries={entries}
        highlightRank={Number.isInteger(highlight) ? highlight : undefined}
        emptyMessage={
          query.period === "all"
            ? undefined
            : `${query.period === "weekly" ? "이번 주" : "오늘"} 등록된 기록이 아직 없어요. 첫 번째 주인공이 되어 보세요!`
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={quizHref(target)} className={primaryButton}>
          🔄 {query.mode === "ALL" ? "재도전" : `${activeName} 재도전`}
        </Link>
        <Link href="/" className={secondaryButton}>
          메인으로
        </Link>
      </div>
    </div>
  );
}
