// 클라이언트와 서버가 함께 쓰는 입력 제한값. zod를 끌어오지 않도록 별도 모듈로 둔다.

// PRD 6.3: 닉네임 2~12자 (DB 컬럼 VARCHAR(12)와 같게 문자 수로 센다)
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 12;

/**
 * 한 세션에서 답안 사이의 최소 간격 (첫 답안은 세션 시작 기준).
 * 서버는 더 빨리 들어온 답안을 429로 거절하고, 퀴즈 화면은 이 시간을 채운 뒤에 전송해 정상 사용자는 막히지 않는다.
 * 스크립트로 정답을 수집·제출하는 속도를 늦추기 위한 값이다.
 */
export const MIN_ANSWER_INTERVAL_MS = 1000;
