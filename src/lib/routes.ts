// 화면 간 이동 URL을 한 곳에서 만든다 (퀴즈 ↔ 결과 ↔ 순위).

/** categorySlug가 없으면 전체 40문제 모드 */
export function quizHref(categorySlug?: string | null): string {
  return categorySlug ? `/quiz?category=${encodeURIComponent(categorySlug)}` : "/quiz?mode=all";
}

export function leaderboardHref(options: {
  categorySlug?: string | null;
  limit?: number;
  highlight?: number;
} = {}): string {
  const params = new URLSearchParams();
  if (options.categorySlug) {
    params.set("mode", "CATEGORY");
    params.set("category", options.categorySlug);
  }
  if (options.limit && options.limit !== 10) params.set("limit", String(options.limit));
  if (options.highlight) params.set("highlight", String(options.highlight));
  const query = params.toString();
  return query ? `/leaderboard?${query}` : "/leaderboard";
}
