import { describe, expect, it } from "vitest";
import {
  canSelect,
  currentQuestion,
  initialQuizState,
  isLastQuestion,
  quizReducer,
  type QuizAction,
  type QuizState,
} from "@/app/quiz/quiz-state";
import type { CreatedSession } from "@/lib/quiz/sessions";

const session: CreatedSession = {
  sessionId: "s1",
  questions: [
    { id: 11, category: "과학", question: "Q1", options: ["a", "b", "c", "d"] },
    { id: 12, category: "과학", question: "Q2", options: ["a", "b", "c", "d"] },
  ],
};

const run = (...actions: QuizAction[]) => actions.reduce(quizReducer, initialQuizState);
const loaded = () => run({ type: "start" }, { type: "loaded", session });
const correct = { isCorrect: true, answerIndex: 1, explanation: "e" };
const wrong = { isCorrect: false, answerIndex: 1, explanation: "e" };

describe("quizReducer", () => {
  it("세션을 불러오면 첫 문제부터 시작한다", () => {
    const state = loaded();
    expect(currentQuestion(state)?.id).toBe(11);
    expect(isLastQuestion(state)).toBe(false);
  });

  it("정답이면 맞힌 수가 늘고, 오답이면 그대로다", () => {
    const afterCorrect = quizReducer(quizReducer(loaded(), { type: "answerSent", optionIndex: 1 }), {
      type: "answered",
      feedback: correct,
    });
    expect(afterCorrect).toMatchObject({ correctCount: 1, pending: false, selected: 1, feedback: correct });

    const afterWrong = quizReducer(quizReducer(loaded(), { type: "answerSent", optionIndex: 0 }), {
      type: "answered",
      feedback: wrong,
    });
    expect(afterWrong.correctCount).toBe(0);
  });

  it("다음 문제로 넘어가면 선택·피드백·오류를 비우고 맞힌 수는 유지한다", () => {
    const state = run(
      { type: "loaded", session },
      { type: "answerSent", optionIndex: 1 },
      { type: "answered", feedback: correct },
      { type: "next" },
    );
    expect(state).toMatchObject({ index: 1, selected: null, feedback: null, answerError: null, correctCount: 1 });
    expect(isLastQuestion(state)).toBe(true);
  });

  it("전송 실패는 고른 보기를 유지한다 (응답만 잃었을 수 있으므로)", () => {
    const state = run({ type: "loaded", session }, { type: "answerSent", optionIndex: 2 }, { type: "answerFailed", message: "끊김" });
    expect(state).toMatchObject({ selected: 2, pending: false, answerError: "끊김" });
  });

  it("다시 시작하면 진행 상태를 모두 초기화한다", () => {
    const midway = run(
      { type: "loaded", session },
      { type: "answerSent", optionIndex: 1 },
      { type: "answered", feedback: correct },
      { type: "next" },
      { type: "loadFailed", message: "만료" },
    );
    expect(quizReducer(midway, { type: "start" })).toEqual(initialQuizState);
  });
});

describe("canSelect", () => {
  const withState = (patch: Partial<QuizState>) => ({ ...loaded(), ...patch });

  it("세션이 없거나, 전송 중이거나, 이미 채점됐으면 고를 수 없다", () => {
    expect(canSelect(initialQuizState, 0)).toBe(false);
    expect(canSelect(withState({ pending: true }), 0)).toBe(false);
    expect(canSelect(withState({ feedback: correct }), 0)).toBe(false);
    expect(canSelect(withState({}), 3)).toBe(true);
  });

  it("전송에 실패한 뒤에는 처음 고른 보기만 다시 보낼 수 있다", () => {
    const failed = withState({ selected: 2, answerError: "끊김" });
    expect(canSelect(failed, 2)).toBe(true);
    expect(canSelect(failed, 0)).toBe(false);
  });
});

describe("quizReducer 경계", () => {
  it("마지막 문제 뒤 finish는 집계 중 상태만 켠다", () => {
    const state = quizReducer(loaded(), { type: "finish" });
    expect(state).toMatchObject({ finishing: true, index: 0 });
  });

  it("문제 범위를 넘어선 index에서는 현재 문제가 없고 보기를 고를 수 없다", () => {
    const beyond = run({ type: "loaded", session }, { type: "next" }, { type: "next" });
    expect(currentQuestion(beyond)).toBeUndefined();
    expect(isLastQuestion(beyond)).toBe(false);
    expect(canSelect(beyond, 0)).toBe(false);
  });

  it("문제가 하나뿐인 세션은 첫 문제가 곧 마지막 문제다", () => {
    const single = quizReducer(initialQuizState, {
      type: "loaded",
      session: { sessionId: "s", questions: [session.questions[0]] },
    });
    expect(isLastQuestion(single)).toBe(true);
  });

  it("전송 중 세션 오류(404)가 나면 전송 중 표시를 끈다", () => {
    const state = run({ type: "loaded", session }, { type: "answerSent", optionIndex: 1 }, { type: "loadFailed", message: "만료" });
    expect(state).toMatchObject({ pending: false, loadError: "만료" });
  });
});
