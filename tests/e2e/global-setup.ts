import type { FullConfig } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { clearRateLimits, isLocalTarget } from "./local-db";

// 앱이 떠 있는지 먼저 확인해, 연결 실패가 모든 테스트의 타임아웃으로 번지지 않게 한다.
// 로컬 대상이면 이전 실행이 남긴 요청 횟수 카운터를 비우고 시작한다.
export default async function globalSetup(config: FullConfig) {
  process.env.E2E_STARTED_AT = new Date().toISOString();

  const baseURL = config.projects[0].use.baseURL!;
  try {
    const res = await fetch(new URL("/api/health", baseURL), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    throw new Error(
      `E2E 대상 앱(${baseURL})에 연결할 수 없습니다. 먼저 \`docker compose up --build -d\`를 실행하세요. (${String(error)})`,
    );
  }

  if (isLocalTarget()) {
    const prisma = new PrismaClient();
    try {
      await clearRateLimits(prisma);
    } finally {
      await prisma.$disconnect();
    }
  }
}
