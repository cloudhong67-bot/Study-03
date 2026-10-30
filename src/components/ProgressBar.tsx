interface ProgressBarProps {
  /** 예: "한국사", "전체" */
  label: string;
  /** 지금 풀고 있는 문제 번호 (1부터) */
  current: number;
  total: number;
  correctCount: number;
}

export function ProgressBar({ label, current, total, correctCount }: ProgressBarProps) {
  const percent = Math.round((current / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">
          {label} <span className="tabular-nums">{current} / {total}</span>
        </span>
        <span className="text-muted">
          맞힌 문제 <strong className="tabular-nums text-emerald-600 dark:text-emerald-400">{correctCount}</strong>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} 진행률`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
