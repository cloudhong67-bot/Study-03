// 카테고리별 표시 아이콘 (화면 표현용)

// 일반 객체로 찾으면 "constructor"·"toString"·"__proto__" 같은 slug가 Object.prototype의 값을 돌려줘
// 화면이 깨진다. Map은 직접 넣은 키만 찾는다.
const CATEGORY_ICONS = new Map<string, string>([
  ["korean-history", "🏯"],
  ["science", "🔬"],
  ["geography", "🌏"],
  ["general", "💡"],
]);

const DEFAULT_ICON = "📘";

/** 새 카테고리가 추가돼도 깨지지 않도록 기본 아이콘을 둔다. */
export function categoryIcon(slug: string): string {
  return CATEGORY_ICONS.get(slug) ?? DEFAULT_ICON;
}
