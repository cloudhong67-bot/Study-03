import { OptionButton, type OptionState } from "@/components/OptionButton";

interface QuestionCardProps {
  category: string;
  question: string;
  options: string[];
  /** 사용자가 고른 보기 (채점 전에는 null) */
  selectedIndex: number | null;
  /** 서버가 알려준 정답 (채점 전에는 null) */
  answerIndex: number | null;
  disabled: boolean;
  onSelect: (index: number) => void;
}

function optionState(index: number, selected: number | null, answer: number | null): OptionState {
  if (answer === null) return index === selected ? "pending" : "idle";
  if (index === answer) return "correct";
  if (index === selected) return "wrong";
  return "dimmed";
}

export function QuestionCard({
  category,
  question,
  options,
  selectedIndex,
  answerIndex,
  disabled,
  onSelect,
}: QuestionCardProps) {
  return (
    <section aria-label="문제" className="space-y-4">
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
        <span className="inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200">
          {category}
        </span>
        <h1 className="mt-3 break-keep text-lg font-bold leading-relaxed sm:text-xl">{question}</h1>
      </div>
      <div className="grid gap-3">
        {options.map((option, i) => (
          <OptionButton
            key={i}
            index={i}
            label={option}
            state={optionState(i, selectedIndex, answerIndex)}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
