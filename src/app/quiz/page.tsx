import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { firstParam, type SearchParams } from "@/lib/page-helpers";
import { QuizRunner } from "./QuizRunner";

export const metadata: Metadata = { title: "퀴즈 진행 | 지식와 도전" };

// /quiz?mode=all → 전체 40문제, /quiz?category=<slug> → 카테고리 10문제, /quiz?mode=speed → 스피드 20문제
export default async function QuizPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const category = firstParam(params.category)?.trim();
  const mode = firstParam(params.mode);

  if (category) {
    // key: 같은 페이지에서 카테고리만 바뀌어도 새 퀴즈로 다시 시작한다.
    return <QuizRunner key={category} mode="CATEGORY" categorySlug={category} />;
  }
  if (mode === "all") {
    return <QuizRunner key="all" mode="ALL" />;
  }
  if (mode === "speed") {
    return <QuizRunner key="speed" mode="SPEED" />;
  }
  redirect("/");
}
