import { PrismaClient } from "@prisma/client";

/**
 * DB가 느리거나 응답이 없을 때 요청이 무한정 걸려 있지 않도록 연결 문자열에 시간 제한을 기본으로 넣는다.
 * (값을 이미 지정했으면 그대로 둔다.)
 * - connect_timeout: 새 연결을 맺는 최대 시간(초)
 * - pool_timeout: 커넥션 풀에서 연결을 얻기까지 기다리는 최대 시간(초)
 * - socket_timeout: 쿼리 하나의 응답을 기다리는 최대 시간(초). Prisma 기본값은 무제한이라,
 *   DB가 멈추면(네트워크 단절 등) 쿼리가 끝나지 않는다.
 */
export const DB_TIMEOUT_DEFAULTS = { connect_timeout: "5", pool_timeout: "10", socket_timeout: "10" };

export function withDbTimeouts(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return databaseUrl; // 형식을 해석할 수 없으면 Prisma가 원래 오류를 내도록 그대로 넘긴다.
  }
  for (const [key, value] of Object.entries(DB_TIMEOUT_DEFAULTS)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

function createClient() {
  const databaseUrl = process.env.DATABASE_URL;
  // 빌드 단계처럼 DATABASE_URL이 없을 때는 Prisma 기본 동작(스키마의 env 참조)에 맡긴다.
  return new PrismaClient(databaseUrl ? { datasourceUrl: withDbTimeouts(databaseUrl) } : undefined);
}

// 개발 모드 HMR에서 커넥션이 계속 늘어나지 않도록 전역에 하나만 유지한다.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** DB에 연결되어 쿼리를 처리할 수 있는지 확인한다 (헬스 체크용). */
export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
