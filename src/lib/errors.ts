// 앱 전체에서 쓰는 "예상된 오류" 타입. 도메인(퀴즈)·HTTP 계층 어디서 던져도 되며,
// 라우트의 handle()이 code에 맞는 HTTP 응답으로 바꾼다 (상태 코드 대응표는 api.ts).

export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "REQUEST_TIMEOUT"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_REQUESTS";

export class AppError extends Error {
  override name = "AppError";
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** 429일 때 Retry-After 헤더로 보낼 초 */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function isNotFoundError(error: unknown): error is AppError {
  return error instanceof AppError && error.code === "NOT_FOUND";
}
