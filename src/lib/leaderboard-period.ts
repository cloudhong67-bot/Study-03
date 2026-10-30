// 주간·일일 순위표의 시작 시각. 서버(컨테이너)가 UTC여도 한국 시간 달력 기준으로 자른다.
import type { LeaderboardPeriod } from "@/lib/routes";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 한국 표준시(UTC+9). 서머타임이 없어 고정 오프셋으로 계산할 수 있다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 기간의 시작 시각(포함). 전체 기간이면 null.
 * - daily: 오늘 0시(한국 시간)
 * - weekly: 이번 주 월요일 0시(한국 시간)
 */
export function periodStart(period: LeaderboardPeriod, now: Date): Date | null {
  if (period === "all") return null;
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new RangeError("유효하지 않은 시각입니다.");

  // 한국 시간의 "벽시계"를 UTC 필드로 다룬 뒤 다시 오프셋을 뺀다.
  const localMidnight = Math.floor((time + KST_OFFSET_MS) / DAY_MS) * DAY_MS;
  const daysSinceMonday = period === "weekly" ? (new Date(localMidnight).getUTCDay() + 6) % 7 : 0;
  const start = new Date(localMidnight - daysSinceMonday * DAY_MS - KST_OFFSET_MS);
  // Date가 표현할 수 있는 가장 이른 시각 근처에서는 시작 시각이 범위를 벗어난다.
  if (Number.isNaN(start.getTime())) throw new RangeError("기간의 시작 시각을 표현할 수 없습니다.");
  return start;
}

export const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  all: "전체 기간",
  weekly: "주간",
  daily: "일일",
};

export const PERIOD_DESCRIPTIONS: Record<LeaderboardPeriod, string> = {
  all: "모든 기록",
  weekly: "이번 주 월요일 0시부터 (한국 시간)",
  daily: "오늘 0시부터 (한국 시간)",
};
