export type OptionState = "idle" | "pending" | "correct" | "wrong" | "dimmed" | "removed";

interface OptionButtonProps {
  index: number;
  label: string;
  state: OptionState;
  disabled: boolean;
  onSelect: (index: number) => void;
}

const STATE_CLASS: Record<OptionState, string> = {
  idle: "border-border bg-surface hover:border-indigo-400 hover:bg-indigo-50 active:scale-[0.99] dark:hover:bg-indigo-950/40",
  // 선택 후 채점 결과를 기다리는 중
  pending: "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/30 motion-safe:animate-pulse dark:bg-indigo-950/50",
  correct:
    "border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/30 motion-safe:animate-pop dark:bg-emerald-950/50 dark:text-emerald-100",
  wrong:
    "border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-500/30 motion-safe:animate-shake dark:bg-rose-950/50 dark:text-rose-100",
  dimmed: "border-border bg-surface opacity-55",
  // 50:50 힌트로 지운 오답
  removed: "border-dashed border-border bg-surface text-muted line-through opacity-40",
};

const BADGE_CLASS: Record<OptionState, string> = {
  idle: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200",
  pending: "bg-indigo-600 text-white",
  correct: "bg-emerald-500 text-white",
  wrong: "bg-rose-500 text-white",
  dimmed: "bg-border text-muted",
  removed: "bg-border text-muted",
};

const STATE_LABEL: Partial<Record<OptionState, string>> = {
  pending: "채점 중",
  correct: "정답",
  wrong: "선택한 오답",
  removed: "힌트로 제외",
};

export function OptionButton({ index, label, state, disabled, onSelect }: OptionButtonProps) {
  const stateLabel = STATE_LABEL[state];
  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      disabled={disabled || state === "removed"}
      aria-label={`${index + 1}번. ${label}${stateLabel ? ` (${stateLabel})` : ""}`}
      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-default ${STATE_CLASS[state]}`}
    >
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${BADGE_CLASS[state]}`}
      >
        {state === "correct" ? "✓" : state === "wrong" ? "✕" : index + 1}
      </span>
      <span className="min-w-0 flex-1 break-keep">{label}</span>
    </button>
  );
}
