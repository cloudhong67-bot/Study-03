// 퀴즈 진행 화면의 상태 전이 (순수 함수: React·네트워크와 무관하게 테스트할 수 있다)
import type { AnswerFeedback, CreatedSession } from "@/lib/quiz/sessions";

export interface QuizState {
  session: CreatedSession | null;
  /** 세션을 시작할 수 없을 때(생성 실패·만료) 보여 줄 메시지 */
  loadError: string | null;
  index: number;
  /** 서버가 지금 문제를 열었다고 확인함 (이때부터 답안 시간을 잰다). 그 전에는 보기를 고를 수 없다 */
  opened: boolean;
  /** 문제 열기 실패 메시지 */
  openError: string | null;
  /** 제한 시간이 있는 모드에서 이 문제의 마감 시각 (Date.now() 기준 ms). 없으면 null */
  deadline: number | null;
  /** 50:50 힌트로 지운 보기 */
  removed: number[];
  hintPending: boolean;
  hintError: string | null;
  /** 사용자가 고른 보기 (채점 전에도 표시) */
  selected: number | null;
  /** 제한 시간이 끝나 보기 없이(null) 답안을 보냄 */
  timeUp: boolean;
  feedback: AnswerFeedback | null;
  /** 답안 전송 중 */
  pending: boolean;
  /** 답안 전송 실패 메시지. 이때 보낸 답(고른 보기 또는 시간 초과)은 고정되고 같은 답으로만 다시 보낼 수 있다 */
  answerError: string | null;
  correctCount: number;
  /** 서버가 계산한 지금까지의 총점과 연속 정답 수 */
  score: number;
  streak: number;
  /** 마지막 문제 후 결과 화면으로 이동 중 */
  finishing: boolean;
}

export type QuizAction =
  | { type: "start" }
  | { type: "loaded"; session: CreatedSession }
  | { type: "loadFailed"; message: string }
  | { type: "opened"; questionId: number; removed: number[]; deadline: number | null }
  | { type: "openFailed"; message: string }
  | { type: "hintSent" }
  | { type: "hintReceived"; questionId: number; removed: number[] }
  | { type: "hintFailed"; message: string }
  /** optionIndex가 null이면 제한 시간 종료 */
  | { type: "answerSent"; optionIndex: number | null }
  | { type: "answered"; feedback: AnswerFeedback }
  | { type: "answerFailed"; message: string }
  | { type: "next" }
  | { type: "finish" };

/** 문제가 바뀔 때마다 초기화되는 값 */
const QUESTION_RESET = {
  opened: false,
  openError: null,
  deadline: null,
  removed: [],
  hintPending: false,
  hintError: null,
  selected: null,
  timeUp: false,
  feedback: null,
  pending: false,
  answerError: null,
} satisfies Partial<QuizState>;

export const initialQuizState: QuizState = {
  session: null,
  loadError: null,
  index: 0,
  ...QUESTION_RESET,
  correctCount: 0,
  score: 0,
  streak: 0,
  finishing: false,
};

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "start":
      // 처음 시작과 [다시 시도](세션 생성 실패·세션 만료 후) 모두 진행 상태를 전부 초기화한다.
      return initialQuizState;
    case "loaded":
      return { ...initialQuizState, session: action.session };
    case "loadFailed":
      return { ...state, loadError: action.message, pending: false, hintPending: false };
    case "opened":
      // 늦게 도착한 이전 문제(또는 이전 세션)의 응답은 무시한다.
      if (currentQuestion(state)?.id !== action.questionId) return state;
      return { ...state, opened: true, openError: null, removed: action.removed, deadline: action.deadline };
    case "openFailed":
      return { ...state, openError: action.message };
    case "hintSent":
      return { ...state, hintPending: true, hintError: null };
    case "hintReceived":
      if (currentQuestion(state)?.id !== action.questionId) return state;
      return { ...state, hintPending: false, removed: action.removed };
    case "hintFailed":
      return { ...state, hintPending: false, hintError: action.message };
    case "answerSent":
      return action.optionIndex === null
        ? { ...state, timeUp: true, pending: true, answerError: null }
        : { ...state, selected: action.optionIndex, pending: true, answerError: null };
    case "answered":
      return {
        ...state,
        feedback: action.feedback,
        pending: false,
        correctCount: state.correctCount + (action.feedback.isCorrect ? 1 : 0),
        score: action.feedback.score,
        streak: action.feedback.streak,
      };
    case "answerFailed":
      // 보낸 답(selected 또는 timeUp)은 그대로 둔다: 요청이 서버에 기록됐는데 응답만 잃었을 수 있으므로,
      // 다른 보기로 바꿔 보내면 409(이미 답함)에 막혀 진행할 수 없게 된다.
      return { ...state, pending: false, answerError: action.message };
    case "next":
      return { ...state, index: state.index + 1, ...QUESTION_RESET };
    case "finish":
      return { ...state, finishing: true };
  }
}

export function currentQuestion(state: QuizState) {
  return state.session?.questions[state.index];
}

export function isLastQuestion(state: QuizState): boolean {
  return state.session !== null && state.index === state.session.questions.length - 1;
}

/** 아직 답을 보내지 않았고 보낼 수 있는 상태인지 (문제가 열렸고, 전송·힌트 요청 중이 아님) */
function isAwaitingAnswer(state: QuizState): boolean {
  return Boolean(currentQuestion(state)) && state.opened && !state.feedback && !state.pending && !state.hintPending;
}

/** 지금 이 보기를 고를 수 있는지. 전송에 실패한 뒤에는 처음 고른 보기만 다시 보낼 수 있다. */
export function canSelect(state: QuizState, optionIndex: number): boolean {
  if (!isAwaitingAnswer(state) || state.timeUp || state.removed.includes(optionIndex)) return false;
  return state.answerError === null || optionIndex === state.selected;
}

/** 50:50 힌트를 쓸 수 있는지 (문제당 한 번, 답을 보내기 전에만) */
export function canUseHint(state: QuizState): boolean {
  return (
    isAwaitingAnswer(state) &&
    !state.timeUp &&
    state.selected === null &&
    state.answerError === null &&
    state.removed.length === 0
  );
}

/** 전송에 실패한 답안을 다시 보낼 때의 값 (시간 초과였으면 null). 다시 보낼 답이 없으면 undefined */
export function answerToRetry(state: QuizState): number | null | undefined {
  if (state.answerError === null) return undefined;
  return state.timeUp ? null : (state.selected ?? undefined);
}

/** 제한 시간이 끝나면 시간 초과 답안을 보내야 하는 상태인지 */
export function shouldWatchDeadline(state: QuizState): boolean {
  return state.deadline !== null && isAwaitingAnswer(state) && !state.timeUp && state.answerError === null;
}
