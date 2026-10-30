import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    select: { slug: true, name: true, _count: { select: { questions: true } } },
  });
  return categories.map((c) => ({ slug: c.slug, name: c.name, questionCount: c._count.questions }));
}

/** slug로 카테고리를 찾는다. 없으면 404. */
export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) throw new AppError("NOT_FOUND", `카테고리 "${slug}"를 찾을 수 없습니다.`);
  return category;
}

export type CategorySummary = Awaited<ReturnType<typeof listCategories>>[number];
