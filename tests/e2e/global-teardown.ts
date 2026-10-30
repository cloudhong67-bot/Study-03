import { PrismaClient } from "@prisma/client";
import { E2E_USERNAME_PREFIX } from "./fixtures";
import { clearRateLimits, isLocalTarget } from "./local-db";

// 로컬 compose 대상으로 실행했을 때만, 이번 실행이 만든 기록을 지운다.
// (남겨 두면 실행할 때마다 순위표가 쌓여 새 기록이 Top 50 밖으로 밀려나 테스트가 불안정해진다.)
// - E2E 닉네임으로 등록된 점수와 그 세션
// - 이번 실행 중 만들어졌지만 점수를 등록하지 않은 세션
// - 요청 횟수 제한 카운터 (rate-limit 테스트가 한도를 소진해 두므로, 비우지 않으면 직후 수동 사용이 막힌다)
export default async function globalTeardown() {
  const startedAt = process.env.E2E_STARTED_AT;
  if (!isLocalTarget() || !startedAt) return;

  const prisma = new PrismaClient();
  try {
    const sessionIds = (
      await prisma.quizSession.findMany({
        where: {
          OR: [
            { score: { username: { startsWith: E2E_USERNAME_PREFIX } } },
            { score: null, startedAt: { gte: new Date(startedAt) } },
          ],
        },
        select: { id: true },
      })
    ).map((s) => s.id);

    await prisma.$transaction([
      prisma.score.deleteMany({ where: { sessionId: { in: sessionIds } } }),
      prisma.quizSession.deleteMany({ where: { id: { in: sessionIds } } }), // session_answers는 CASCADE
    ]);
    await clearRateLimits(prisma);
    console.log(`[e2e] 테스트 데이터 정리: 세션 ${sessionIds.length}개, 요청 횟수 카운터`);
  } catch (error) {
    console.warn(`[e2e] 테스트 데이터 정리 실패 (테스트 결과에는 영향 없음): ${String(error)}`);
  } finally {
    await prisma.$disconnect();
  }
}
