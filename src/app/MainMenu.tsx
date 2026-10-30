"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { categoryIcon } from "@/components/category-icon";
import { SPEED_QUESTION_COUNT, SPEED_TIME_LIMIT_MS } from "@/lib/limits";
import { leaderboardHref, quizHref, RECORDS_HREF } from "@/lib/routes";

interface MainMenuProps {
  categories: { slug: string; name: string; questionCount: number }[];
  totalQuestions: number;
}

export function MainMenu({ categories, totalQuestions }: MainMenuProps) {
  const [showCategories, setShowCategories] = useState(false);
  const panelId = useId();

  return (
    <div className="space-y-3">
      <Link href={quizHref()} className={`${primaryButton} min-h-14 flex-col gap-0 py-2`}>
        <span>게임 시작</span>
        <span className="text-xs font-normal opacity-80">전체 도전 · {totalQuestions}문제 연속 풀이</span>
      </Link>

      <Link href={quizHref({ mode: "SPEED" })} className={`${secondaryButton} min-h-14 flex-col gap-0 py-2`}>
        <span>⚡ 스피드 퀴즈</span>
        <span className="text-xs font-normal text-muted">
          무작위 {Math.min(SPEED_QUESTION_COUNT, totalQuestions)}문제 · 문제당 {SPEED_TIME_LIMIT_MS / 1000}초
        </span>
      </Link>

      <button
        type="button"
        className={secondaryButton}
        aria-expanded={showCategories}
        aria-controls={panelId}
        onClick={() => setShowCategories((v) => !v)}
      >
        카테고리 선택 <span aria-hidden>{showCategories ? "▲" : "▼"}</span>
      </button>

      {showCategories && (
        <ul id={panelId} className="grid grid-cols-2 gap-3 motion-safe:animate-rise">
          {categories.map((c) => (
            <li key={c.slug}>
              <Link
                href={quizHref({ categorySlug: c.slug })}
                className="flex h-full flex-col items-center gap-1 rounded-2xl border border-border bg-surface p-4 text-center transition hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-indigo-950/40"
              >
                <span aria-hidden className="text-3xl">
                  {categoryIcon(c.slug)}
                </span>
                <span className="font-bold">{c.name}</span>
                <span className="text-xs text-muted">{c.questionCount}문제</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href={leaderboardHref()} className={secondaryButton}>
          🏆 순위 보기
        </Link>
        <Link href={RECORDS_HREF} className={secondaryButton}>
          📊 내 기록
        </Link>
      </div>
    </div>
  );
}
