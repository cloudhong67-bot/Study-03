import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { flattenSearchParams, orNotFound, type SearchParams } from "@/lib/page-helpers";
import { listCategories } from "@/lib/quiz/categories";
import { getLeaderboard } from "@/lib/quiz/scores";
import { leaderboardHref, quizHref } from "@/lib/routes";
import { leaderboardQuerySchema, type LeaderboardQuery } from "@/lib/validation";

export const metadata: Metadata = { title: "순위표 | 지식와 도전" };

const DEFAULT_QUERY: LeaderboardQuery = { mode: "ALL", category: undefined, limit: 10 };

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

export default async function LeaderboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = flattenSearchParams(await searchParams);
  const query = parseQuery(params);
  const highlight = Number(params.highlight);

  const [categories, entries] = await Promise.all([listCategories(), orNotFound(getLeaderboard(query))]);

  const activeSlug = query.category ?? null;
  const activeName = categories.find((c) => c.slug === activeSlug)?.name ?? "전체";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">🏆 순위표</h1>
        <p className="mt-1 text-sm text-muted">
          {activeSlug ? `${activeName} 10문제 · 100점 만점` : "전체 40문제 · 400점 만점"} · 동점이면 먼저 기록한 순
        </p>
      </div>

      <nav aria-label="순위표 종류" className="flex flex-wrap gap-2">
        <Link
          href={leaderboardHref({ limit: query.limit })}
          className={tabClass(!activeSlug)}
          aria-current={!activeSlug ? "page" : undefined}
        >
          전체
        </Link>
        {categories.map((c) => (
          <Link
            key={c.slug}
            href={leaderboardHref({ categorySlug: c.slug, limit: query.limit })}
            className={tabClass(c.slug === activeSlug)}
            aria-current={c.slug === activeSlug ? "page" : undefined}
          >
            {c.name}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          {activeName} Top {query.limit}
        </h2>
        <div role="group" aria-label="표시 개수" className="flex rounded-full border border-border bg-surface p-1 text-xs">
          {[10, 50].map((limit) => (
            <Link
              key={limit}
              href={leaderboardHref({ categorySlug: activeSlug, limit })}
              aria-current={query.limit === limit ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 font-semibold ${
                query.limit === limit ? "bg-indigo-600 text-white" : "text-muted"
              }`}
            >
              Top {limit}
            </Link>
          ))}
        </div>
      </div>

      <LeaderboardTable entries={entries} highlightRank={Number.isInteger(highlight) ? highlight : undefined} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={quizHref(activeSlug)} className={primaryButton}>
          🔄 {activeSlug ? `${activeName} 재도전` : "재도전"}
        </Link>
        <Link href="/" className={secondaryButton}>
          메인으로
        </Link>
      </div>
    </div>
  );
}
