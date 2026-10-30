import { OptionButton, type OptionState } from "@/components/OptionButton";
import { basePoints, type Difficulty } from "@/lib/scoring";

const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: "쉬움", MEDIUM: "보통", HARD: "어려움" };

const DIFFICULTY_CLASS: Record<Difficulty, string> = {
  EASY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
  HARD: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200",
};

interface QuestionCardProps {
  category: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  /** 사용자가 고른 보기 (채점 전에는 null) */
  selectedIndex: number | null;
  /** 서버가 알려준 정답 (채점 전에는 null) */
  answerIndex: number | null;
  /** 50:50 힌트로 지운 보기 */
  removed: readonly number[];
  disabled: boolean;
  onSelect: (index: number) => void;
}

function optionState(index: number, selected: number | null, answer: number | null, removed: readonly number[]): OptionState {
  if (removed.includes(index)) return "removed";
  if (answer === null) return index === selected ? "pending" : "idle";
  if (index === answer) return "correct";
  if (index === selected) return "wrong";
  return "dimmed";
}

export function QuestionCard({
  category,
  difficulty,
  question,
  options,
  selectedIndex,
  answerIndex,
  removed,
  disabled,
  onSelect,
}: QuestionCardProps) {
  return (
    <section aria-label="문제" className="space-y-4">
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <span className="inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
            {category}
          </span>
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${DIFFICULTY_CLASS[difficulty]}`}>
            난이도 {DIFFICULTY_LABEL[difficulty]} · {basePoints(difficulty)}점
          </span>
        </div>
        <h1 className="mt-3 break-keep text-lg font-bold leading-relaxed sm:text-xl">{question}</h1>
      </div>
      <div className="grid gap-3">
        {options.map((option, i) => (
          <OptionButton
            key={i}
            index={i}
            label={option}
            state={optionState(i, selectedIndex, answerIndex, removed)}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
