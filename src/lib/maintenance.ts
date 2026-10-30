import { TimeoutError, withTimeout } from "@/lib/async";
import { cleanupExpiredSessions } from "@/lib/quiz/sessions";
import { pruneRateLimits } from "@/lib/rate-limit";

/** 인스턴스(replica)마다 이 간격에 한 번만 정리를 실행한다. 여러 replica가 겹쳐 실행해도 안전하다(멱등). */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** 정리 작업 때문에 세션 생성 응답이 늦어지는 최대 시간. 넘으면 응답은 먼저 보내고 정리는 뒤에서 계속한다. */
export const MAINTENANCE_BUDGET_MS = 2_000;

/**
 * 만료된 미등록 세션과 끝난 요청 횟수 카운터를 지우는 함수를 만든다.
 * 마지막 실행 시각은 만든 함수마다 따로 가진다(테스트에서 독립된 인스턴스를 만들 수 있게).
 * 어떤 경우에도 예외를 던지지 않는다: 정리는 부가 작업이라, 실패해도 호출한 사용자 요청은 계속 처리한다.
 */
export function createMaintenanceRunner(
  intervalMs: number = MAINTENANCE_INTERVAL_MS,
  budgetMs: number = MAINTENANCE_BUDGET_MS,
) {
  let lastRunAt = -Infinity;
  return async function runIfDue(now: Date = new Date()): Promise<boolean> {
    if (now.getTime() - lastRunAt < intervalMs) return false;
    lastRunAt = now.getTime();

    // 작업 자체의 실패는 여기서 기록하고 삼킨다. 시간 초과로 먼저 반환한 뒤에 실패해도
    // 처리되지 않은 거절(unhandled rejection)이 생기지 않는다.
    const work = (async () => {
      const sessions = await cleanupExpiredSessions(now);
      const rateLimits = await pruneRateLimits(now);
      if (sessions || rateLimits) console.info("[maintenance] removed", { sessions, rateLimits });
    })().catch((error) => console.error("[maintenance] failed", error));

    try {
      await withTimeout(work, budgetMs);
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error; // work는 거절되지 않으므로 여기 오지 않는다
      console.warn(`[maintenance] still running after ${budgetMs}ms; continuing in background`);
    }
    return true;
  };
}

/** 앱 전체가 공유하는 인스턴스. 별도 스케줄러 없이 세션 생성 요청에서 호출한다. */
export const maybeRunMaintenance = createMaintenanceRunner();
