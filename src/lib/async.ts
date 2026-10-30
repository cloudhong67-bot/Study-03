// 서버·브라우저 공용 비동기 유틸 (외부 의존성 없음).

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

/**
 * promise가 ms 안에 끝나지 않으면 TimeoutError로 거절한다.
 * 원래 작업을 취소하지는 않는다(계속 진행될 수 있음). Promise.race가 원래 promise에도 핸들러를 붙이므로
 * 시간 초과 뒤에 원래 작업이 실패해도 처리되지 않은 거절(unhandled rejection)로 남지 않는다.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message ?? `${ms}ms 안에 끝나지 않았습니다.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
