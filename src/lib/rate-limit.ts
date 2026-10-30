import { clientKey } from "@/lib/client-ip";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/**
 * IP별 요청 횟수 제한 (고정 윈도). 카운터를 Postgres에 두어 여러 replica가 같은 한도를 공유하고,
 * 재시작해도 초기화되지 않는다.
 *
 * 한도는 학교·가정처럼 여러 사람이 공인 IP 하나를 함께 쓰는 경우(NAT)를 고려해 넉넉하게 잡는다.
 * 한 사람 기준으로는 도달하기 어렵고, 스크립트의 대량 요청만 막는 수준이다.
 */
export const RATE_LIMITS = {
  /** 세션(퀴즈) 시작: 10분에 30회 */
  createSession: { limit: 30, windowSeconds: 10 * 60 },
  /** 답안 제출: 1분에 300회 (세션 안에서는 별도로 1초 간격 제한이 걸린다) */
  answer: { limit: 300, windowSeconds: 60 },
  /** 문제 열기(답안 시간 측정 시작): 답안과 같은 한도 */
  openQuestion: { limit: 300, windowSeconds: 60 },
  /** 50:50 힌트: 문제당 한 번이라 답안과 같은 한도면 충분하다 */
  hint: { limit: 300, windowSeconds: 60 },
  /** 순위표 등록: 1시간에 20회 */
  submitScore: { limit: 20, windowSeconds: 60 * 60 },
} as const;

export type RateLimitRule = keyof typeof RATE_LIMITS;

/** 가장 긴 제한 윈도. 이보다 오래된 카운터는 더 이상 판단에 쓰이지 않는다. */
const MAX_WINDOW_MS = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowSeconds)) * 1000;

/**
 * 카운터를 1 올리고, 한도를 넘었으면 429(AppError TOO_MANY_REQUESTS)를 던진다.
 * INSERT … ON CONFLICT … RETURNING 한 문장이라 동시에 들어온 요청도 정확히 센다.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  client: string,
  now: Date = new Date(),
): Promise<void> {
  const { limit, windowSeconds } = RATE_LIMITS[rule];
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule}:${client}`;

  const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limits" ("key", "window_start", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = "rate_limits"."count" + 1
    RETURNING "count"`;

  if (count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
    throw new AppError("TOO_MANY_REQUESTS", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", retryAfterSeconds);
  }
}

/** 라우트 핸들러용: 요청의 클라이언트 IP로 한도를 확인한다. */
export function enforceRateLimit(request: Request, rule: RateLimitRule): Promise<void> {
  return consumeRateLimit(rule, clientKey(request.headers));
}

/** 끝난 윈도의 카운터를 지운다. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - MAX_WINDOW_MS) } },
  });
  return count;
}
