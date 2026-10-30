// categories와 prisma/data/questions.json의 문제를 upsert한다 (PRD 8장).
// 런타임 Docker 이미지에서 tsx 없이 실행되도록 순수 JavaScript로 작성한다.
// 여러 번 실행해도 안전하다: 카테고리는 slug, 문제는 JSON의 id 기준으로 갱신한다.
// 기존 문제는 삭제하지 않는다 (session_answers가 참조하고 있을 수 있음).
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const CATEGORIES = [
  { slug: "korean-history", name: "한국사", sortOrder: 1 },
  { slug: "science", name: "과학", sortOrder: 2 },
  { slug: "geography", name: "지리", sortOrder: 3 },
  { slug: "general", name: "일반상식", sortOrder: 4 },
];

async function loadQuestions() {
  const url = new URL("./data/questions.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

/** DB에 쓰기 전에 전체 데이터를 검사해, 잘못된 데이터가 일부만 들어가는 일을 막는다. */
function validateQuestions(questions) {
  const categoryNames = new Set(CATEGORIES.map((c) => c.name));
  const seenIds = new Set();
  const errors = [];

  if (!Array.isArray(questions)) {
    throw new Error("questions.json은 배열이어야 합니다.");
  }

  for (const [i, q] of questions.entries()) {
    const at = `questions[${i}] (id=${q?.id})`;
    if (!Number.isInteger(q.id) || q.id < 1) errors.push(`${at}: id는 1 이상의 정수여야 합니다.`);
    else if (seenIds.has(q.id)) errors.push(`${at}: id가 중복되었습니다.`);
    seenIds.add(q.id);

    if (!categoryNames.has(q.category)) errors.push(`${at}: 알 수 없는 카테고리 "${q.category}"`);
    if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${at}: question이 비어 있습니다.`);
    if (typeof q.explanation !== "string" || !q.explanation.trim()) errors.push(`${at}: explanation이 비어 있습니다.`);
    if (
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      q.options.some((o) => typeof o !== "string" || !o.trim())
    ) {
      errors.push(`${at}: options는 비어 있지 않은 문자열 4개여야 합니다.`);
    } else if (new Set(q.options).size !== 4) {
      errors.push(`${at}: options에 중복된 보기가 있습니다.`);
    }
    if (!Number.isInteger(q.answer_index) || q.answer_index < 0 || q.answer_index > 3) {
      errors.push(`${at}: answer_index는 0~3 정수여야 합니다.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`questions.json 검증 실패:\n- ${errors.join("\n- ")}`);
  }
}

async function main() {
  const questions = await loadQuestions();
  validateQuestions(questions);

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(
      async (tx) => {
        const categoryIdByName = new Map();
        for (const c of CATEGORIES) {
          const row = await tx.category.upsert({
            where: { slug: c.slug },
            update: { name: c.name, sortOrder: c.sortOrder },
            create: c,
          });
          categoryIdByName.set(c.name, row.id);
        }

        for (const q of questions) {
          const data = {
            categoryId: categoryIdByName.get(q.category),
            question: q.question,
            options: q.options,
            answerIndex: q.answer_index,
            explanation: q.explanation,
          };
          await tx.question.upsert({
            where: { id: q.id },
            update: data,
            create: { id: q.id, ...data },
          });
        }

        // id를 직접 넣었으므로, 이후 autoincrement가 겹치지 않게 시퀀스를 맞춘다.
        await tx.$executeRaw`SELECT setval(pg_get_serial_sequence('questions', 'id'), (SELECT COALESCE(MAX(id), 1) FROM questions))`;
      },
      { timeout: 30_000 },
    );

    const counts = await prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      select: { name: true, _count: { select: { questions: true } } },
    });
    for (const c of counts) {
      console.log(`  ${c.name}: ${c._count.questions}문제`);
    }
    console.log(`시드 완료: 카테고리 ${CATEGORIES.length}개, 문제 ${questions.length}개 upsert`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
