import type { LeaderboardEntry } from "@/lib/quiz/scores";

const MEDALS = ["🥇", "🥈", "🥉"];

// 컨테이너는 UTC일 수 있으므로 표시 시간대를 고정한다.
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /** 방금 등록한 기록의 순위 (강조 표시) */
  highlightRank?: number;
}

export function LeaderboardTable({ entries, highlightRank }: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-border bg-surface p-8 text-center text-muted">
        아직 등록된 기록이 없어요. 첫 번째 주인공이 되어 보세요!
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-background text-xs text-muted">
          <tr>
            <th scope="col" className="w-14 py-3 pl-4 text-left font-semibold">순위</th>
            <th scope="col" className="py-3 text-left font-semibold">닉네임</th>
            <th scope="col" className="w-20 py-3 pr-4 text-right font-semibold sm:w-24">점수</th>
            <th scope="col" className="hidden w-32 py-3 pr-4 text-right font-semibold sm:table-cell">기록 일시</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.rank}
              className={`border-t border-border ${
                e.rank === highlightRank ? "bg-indigo-50 font-semibold dark:bg-indigo-950/50" : ""
              }`}
              aria-current={e.rank === highlightRank ? "true" : undefined}
            >
              <td className="py-3 pl-4 tabular-nums">
                {MEDALS[e.rank - 1] ?? <span className="pl-1 text-muted">{e.rank}</span>}
              </td>
              <td className="truncate py-3 pr-2">{e.username}</td>
              <td className="py-3 pr-4 text-right font-bold tabular-nums">
                {e.score}
                <span className="text-xs font-normal text-muted">/{e.maxScore}</span>
              </td>
              <td className="hidden py-3 pr-4 text-right text-xs tabular-nums text-muted sm:table-cell">
                {dateFormat.format(new Date(e.created_at))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
