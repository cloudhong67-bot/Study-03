import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const PRISMA_CLI = "node_modules/prisma/build/index.js";

// 테스트 DB를 만들고(없으면) 마이그레이션 적용 → 기존 데이터 비우기 → 시드 순으로 준비한다.
export default async function setup() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL이 없습니다 (vitest.config.mts에서 설정).");
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`테스트 DB 이름은 _test로 끝나야 합니다: "${dbName}"`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } catch (error) {
    throw new Error(
      `테스트 DB에 연결할 수 없습니다 (${adminUrl.host}). 먼저 \`docker compose up -d db\`를 실행하세요.\n${String(error)}`,
    );
  } finally {
    await admin.$disconnect();
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  execFileSync(process.execPath, [PRISMA_CLI, "migrate", "deploy"], { env, stdio: "pipe" });

  const db = new PrismaClient({ datasourceUrl: testUrl });
  try {
    await db.$executeRawUnsafe(
      'TRUNCATE "scores", "session_answers", "quiz_sessions", "questions", "categories" RESTART IDENTITY CASCADE',
    );
  } finally {
    await db.$disconnect();
  }
  execFileSync(process.execPath, ["prisma/seed.mjs"], { env, stdio: "pipe" });
}
