import { listCategories } from "@/lib/quiz/categories";
import { MainMenu } from "./MainMenu";

export const dynamic = "force-dynamic";

export default async function Home() {
  const categories = await listCategories();
  const totalQuestions = categories.reduce((sum, c) => sum + c.questionCount, 0);

  return (
    <div className="space-y-8 pt-6">
      <section className="space-y-3 text-center">
        <p aria-hidden className="text-6xl">🧠</p>
        <h1 className="text-3xl font-extrabold tracking-tight">지식와 도전</h1>
        <p className="break-keep text-muted">
          {categories.map((c) => c.name).join(" · ")}
          <br />
          4지선다 상식 퀴즈에 도전하고 순위표에 이름을 올려 보세요!
        </p>
      </section>

      <MainMenu categories={categories} totalQuestions={totalQuestions} />

      <ul className="grid grid-cols-3 gap-2 text-center text-xs text-muted">
        <li className="rounded-2xl bg-surface p-3">
          <strong className="block text-base text-foreground">10점</strong>문제당 점수
        </li>
        <li className="rounded-2xl bg-surface p-3">
          <strong className="block text-base text-foreground">즉시</strong>정답·해설 확인
        </li>
        <li className="rounded-2xl bg-surface p-3">
          <strong className="block text-base text-foreground">Top 50</strong>순위표
        </li>
      </ul>
    </div>
  );
}
