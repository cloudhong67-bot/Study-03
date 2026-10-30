// 페이지 전반에서 쓰는 버튼/링크 스타일. 터치 영역은 최소 48px 높이를 유지한다.
const base =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

export const primaryButton = `${base} bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700`;

export const secondaryButton = `${base} border border-border bg-surface text-foreground hover:border-indigo-300 hover:bg-indigo-50 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40`;
