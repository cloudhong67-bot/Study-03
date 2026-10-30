// 퀴즈 진행 화면의 상태 전이 (순수 함수: React·네트워크와 무관하게 테스트할 수 있다)
import type { AnswerFeedback, CreatedSession } from "@/lib/quiz/sessions";

export interface QuizState {
  session: CreatedSession | null;
  /** 세션을 시작할 수 없을 때(생성 실패·만료) 보여 줄 메시지 */
  loadError: string | null;
  index: number;
  /** 사용자가 고른 보기 (채점 전에도 표시) */
  selected: number | null;
  feedback: AnswerFeedback | null;
  /** 답안 전송 중 */
  pending: boolean;
  /** 답안 전송 실패 메시지. 이때 고른 보기는 고정되고 같은 보기로만 다시 보낼 수 있다 */
  answerError: string | null;
  correctCount: number;
  /** 마지막 문제 후 결과 화면으로 이동 중 */
  finishing: boolean;
}

export type QuizAction =
  | { type: "start" }
  | { type: "loaded"; session: CreatedSession }
  | { type: "loadFailed"; message: string }
  | { type: "answerSent"; optionIndex: number }
  | { type: "answered"; feedback: AnswerFeedback }
  | { type: "answerFailed"; message: string }
  | { type: "next" }
  | { type: "finish" };

export const initialQuizState: QuizState = {
  session: null,
  loadError: null,
  index: 0,
  selected: null,
  feedback: null,
  pending: false,
  answerError: null,
  correctCount: 0,
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
      return { ...state, loadError: action.message, pending: false };
    case "answerSent":
      return { ...state, selected: action.optionIndex, pending: true, answerError: null };
    case "answered":
      return {
        ...state,
        feedback: action.feedback,
        pending: false,
        correctCount: state.correctCount + (action.feedback.isCorrect ? 1 : 0),
      };
    case "answerFailed":
      // 고른 보기(selected)는 그대로 둔다: 요청이 서버에 기록됐는데 응답만 잃었을 수 있으므로,
      // 다른 보기로 바꿔 보내면 409(이미 답함)에 막혀 진행할 수 없게 된다.
      return { ...state, pending: false, answerError: action.message };
    case "next":
      return { ...state, index: state.index + 1, selected: null, feedback: null, answerError: null };
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

/** 지금 이 보기를 고를 수 있는지. 전송에 실패한 뒤에는 처음 고른 보기만 다시 보낼 수 있다. */
export function canSelect(state: QuizState, optionIndex: number): boolean {
  if (!currentQuestion(state) || state.feedback || state.pending) return false;
  return state.answerError === null || optionIndex === state.selected;
}
