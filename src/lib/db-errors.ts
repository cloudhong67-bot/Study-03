// Prisma 오류 분류를 한 곳에 모은다.
import { Prisma } from "@prisma/client";

/** 고유 제약 위반(P2002): 같은 값이 이미 저장됨 (동시 요청 경합 등). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 잠시 뒤 다시 시도하면 성공할 수 있는 DB 오류인지.
 * P1001 서버에 닿지 않음 · P1002 연결 시간 초과 · P1008 작업 시간 초과 · P1017 서버가 연결을 끊음
 * P2024 커넥션 풀 대기 시간 초과 · P2028 트랜잭션 시간 초과 · P2034 쓰기 충돌/교착(재시도 권장)
 */
const TRANSIENT_DB_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"]);

export function isTransientDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return TRANSIENT_DB_ERROR_CODES.has(error.code);
  return false;
}
