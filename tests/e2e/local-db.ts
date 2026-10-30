import { PrismaClient } from "@prisma/client";

/**
 * 로컬 compose 앱을 대상으로 실행 중인지. (E2E_BASE_URL로 다른 대상을 지정했으면 그 DB에는 손대지 않는다.)
 * 로컬 앱과 호스트의 DATABASE_URL(.env)은 같은 DB(127.0.0.1:5433)를 가리킨다.
 */
export function isLocalTarget(): boolean {
  return !process.env.E2E_BASE_URL && !!process.env.DATABASE_URL;
}

/**
 * 요청 횟수 제한 카운터를 비운다. 로컬 E2E의 모든 요청은 같은 IP(Docker 게이트웨이)에서 오므로,
 * 비우지 않으면 E2E를 몇 번 연달아 실행하는 것만으로 세션 생성 한도(10분에 30회)에 걸린다.
 */
export async function clearRateLimits(prisma: PrismaClient): Promise<void> {
  await prisma.rateLimit.deleteMany();
}
