// 화면 간 이동 URL을 한 곳에서 만든다 (퀴즈 ↔ 결과 ↔ 순위).

/** Prisma의 QuizMode와 같은 값 (클라이언트 번들에 Prisma를 끌어오지 않도록 따로 둔다) */
export type QuizMode = "ALL" | "CATEGORY" | "SPEED";

/** 순위표 기간: 전체, 이번 주(월요일 0시부터), 오늘(0시부터). 기준 시간대는 한국 시간이다. */
export const LEADERBOARD_PERIODS = ["all", "weekly", "daily"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** 이 브라우저에 저장된 내 게임 기록·통계 화면 */
export const RECORDS_HREF = "/records";

/** 어느 퀴즈(순위표)인지. categorySlug가 있으면 카테고리 모드다. */
export interface QuizTarget {
  mode?: QuizMode;
  categorySlug?: string | null;
}

/** categorySlug가 있으면 카테고리 10문제, mode가 SPEED면 스피드 퀴즈, 나머지는 전체 40문제 */
export function quizHref({ mode, categorySlug }: QuizTarget = {}): string {
  if (categorySlug) return `/quiz?category=${encodeURIComponent(categorySlug)}`;
  return mode === "SPEED" ? "/quiz?mode=speed" : "/quiz?mode=all";
}

export function leaderboardHref(
  options: QuizTarget & {
    period?: LeaderboardPeriod;
    limit?: number;
    /** 방금 등록한 기록의 순위. 등록 순위는 전체 기간 기준이므로 period와 함께 쓰지 않는다. */
    highlight?: number;
  } = {},
): string {
  const params = new URLSearchParams();
  if (options.categorySlug) {
    params.set("mode", "CATEGORY");
    params.set("category", options.categorySlug);
  } else if (options.mode === "SPEED") {
    params.set("mode", "SPEED");
  }
  if (options.period && options.period !== "all") params.set("period", options.period);
  if (options.limit && options.limit !== 10) params.set("limit", String(options.limit));
  if (options.highlight) params.set("highlight", String(options.highlight));
  const query = params.toString();
  return query ? `/leaderboard?${query}` : "/leaderboard";
}
