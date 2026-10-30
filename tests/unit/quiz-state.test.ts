import { describe, expect, it } from "vitest";
import {
  answerToRetry,
  canSelect,
  canUseHint,
  currentQuestion,
  initialQuizState,
  isLastQuestion,
  quizReducer,
  shouldWatchDeadline,
  type QuizAction,
  type QuizState,
} from "@/app/quiz/quiz-state";
import type { AnswerFeedback, CreatedSession } from "@/lib/quiz/sessions";

const question = (id: number) => ({
  id,
  category: "과학",
  difficulty: "EASY" as const,
  question: `Q${id}`,
  options: ["a", "b", "c", "d"],
});

const session: CreatedSession = { sessionId: "s1", mode: "CATEGORY", timeLimitMs: null, questions: [question(11), question(12)] };

const NO_POINTS = { base: 0, time: 0, hint: 0, combo: 0, total: 0 };
const correct: AnswerFeedback = {
  isCorrect: true,
  timedOut: false,
  answerIndex: 1,
  explanation: "e",
  points: { base: 10, time: 3, hint: 2, combo: 0, total: 15 },
  streak: 1,
  score: 15,
};
const wrong: AnswerFeedback = { ...correct, isCorrect: false, points: NO_POINTS, streak: 0, score: 0 };

const run = (...actions: QuizAction[]) => actions.reduce(quizReducer, initialQuizState);
const opened = (questionId = 11, extra: Partial<Extract<QuizAction, { type: "opened" }>> = {}): QuizAction => ({
  type: "opened",
  questionId,
  removed: [],
  deadline: null,
  ...extra,
});
/** 세션을 불러오고 첫 문제를 연 상태 */
const ready = () => run({ type: "start" }, { type: "loaded", session }, opened());

describe("quizReducer", () => {
  it("세션을 불러오면 첫 문제부터 시작하고, 문제를 열기 전에는 고를 수 없다", () => {
    const state = run({ type: "loaded", session });
    expect(currentQuestion(state)?.id).toBe(11);
    expect(isLastQuestion(state)).toBe(false);
    expect(state.opened).toBe(false);
    expect(canSelect(state, 0)).toBe(false);
    expect(canSelect(quizReducer(state, opened()), 0)).toBe(true);
  });

  it("다른 문제의 늦은 열기 응답은 무시한다", () => {
    const state = run({ type: "loaded", session }, opened(12));
    expect(state.opened).toBe(false);
  });

  it("문제를 열면 힌트 상태와 마감 시각을 받는다 (재시도로 다시 연 경우)", () => {
    const state = run({ type: "loaded", session }, opened(11, { removed: [0, 2], deadline: 5000 }));
    expect(state).toMatchObject({ opened: true, removed: [0, 2], deadline: 5000 });
  });

  it("열기 실패는 메시지만 남긴다", () => {
    const state = run({ type: "loaded", session }, { type: "openFailed", message: "끊김" });
    expect(state).toMatchObject({ opened: false, openError: "끊김" });
    expect(quizReducer(state, opened())).toMatchObject({ opened: true, openError: null });
  });

  it("정답이면 맞힌 수가 늘고 서버의 총점·연속 정답을 따른다, 오답이면 맞힌 수는 그대로다", () => {
    const afterCorrect = run(
      { type: "loaded", session },
      opened(),
      { type: "answerSent", optionIndex: 1 },
      { type: "answered", feedback: correct },
    );
    expect(afterCorrect).toMatchObject({ correctCount: 1, pending: false, selected: 1, feedback: correct, score: 15, streak: 1 });

    const afterWrong = quizReducer(quizReducer(ready(), { type: "answerSent", optionIndex: 0 }), {
      type: "answered",
      feedback: wrong,
    });
    expect(afterWrong).toMatchObject({ correctCount: 0, streak: 0 });
  });

  it("다음 문제로 넘어가면 문제별 상태를 모두 비우고 맞힌 수·점수는 유지한다", () => {
    const state = run(
      { type: "loaded", session },
      opened(11, { removed: [0, 2], deadline: 1 }),
      { type: "answerSent", optionIndex: 1 },
      { type: "answered", feedback: correct },
      { type: "next" },
    );
    expect(state).toMatchObject({
      index: 1,
      opened: false,
      removed: [],
      deadline: null,
      selected: null,
      timeUp: false,
      feedback: null,
      answerError: null,
      correctCount: 1,
      score: 15,
    });
    expect(isLastQuestion(state)).toBe(true);
  });

  it("전송 실패는 고른 보기를 유지한다 (응답만 잃었을 수 있으므로)", () => {
    const state = run({ type: "loaded", session }, opened(), { type: "answerSent", optionIndex: 2 }, { type: "answerFailed", message: "끊김" });
    expect(state).toMatchObject({ selected: 2, pending: false, answerError: "끊김" });
    expect(answerToRetry(state)).toBe(2);
  });

  it("시간 초과 전송은 timeUp을 켜고, 실패하면 다시 null로 보낸다", () => {
    const sent = quizReducer(ready(), { type: "answerSent", optionIndex: null });
    expect(sent).toMatchObject({ timeUp: true, pending: true, selected: null });
    const failed = quizReducer(sent, { type: "answerFailed", message: "끊김" });
    expect(answerToRetry(failed)).toBeNull();
    expect(canSelect(failed, 0)).toBe(false);
  });

  it("다시 시작하면 진행 상태를 모두 초기화한다", () => {
    const midway = run(
      { type: "loaded", session },
      opened(),
      { type: "answerSent", optionIndex: 1 },
      { type: "answered", feedback: correct },
      { type: "next" },
      { type: "loadFailed", message: "만료" },
    );
    expect(quizReducer(midway, { type: "start" })).toEqual(initialQuizState);
  });
});

describe("50:50 힌트", () => {
  it("요청 중에는 보기를 고를 수 없고, 받으면 지운 보기는 고를 수 없다", () => {
    const sent = quizReducer(ready(), { type: "hintSent" });
    expect(sent.hintPending).toBe(true);
    expect(canSelect(sent, 0)).toBe(false);
    expect(canUseHint(sent)).toBe(false);

    const received = quizReducer(sent, { type: "hintReceived", questionId: 11, removed: [0, 3] });
    expect(received).toMatchObject({ hintPending: false, removed: [0, 3] });
    expect(canSelect(received, 0)).toBe(false);
    expect(canSelect(received, 3)).toBe(false);
    expect(canSelect(received, 1)).toBe(true);
    expect(canUseHint(received)).toBe(false); // 문제당 한 번
  });

  it("다른 문제의 늦은 힌트 응답은 무시한다", () => {
    const state = quizReducer(quizReducer(ready(), { type: "hintSent" }), {
      type: "hintReceived",
      questionId: 12,
      removed: [0, 3],
    });
    expect(state.removed).toEqual([]);
  });

  it("실패하면 메시지를 남기고 다시 쓸 수 있다", () => {
    const failed = run({ type: "loaded", session }, opened(), { type: "hintSent" }, { type: "hintFailed", message: "끊김" });
    expect(failed).toMatchObject({ hintPending: false, hintError: "끊김" });
    expect(canUseHint(failed)).toBe(true);
  });

  it("문제를 열기 전·답을 보낸 뒤·채점 뒤에는 쓸 수 없다", () => {
    expect(canUseHint(run({ type: "loaded", session }))).toBe(false);
    expect(canUseHint(quizReducer(ready(), { type: "answerSent", optionIndex: 1 }))).toBe(false);
    expect(canUseHint({ ...ready(), feedback: correct })).toBe(false);
    expect(canUseHint({ ...ready(), selected: 1, answerError: "끊김" })).toBe(false);
    expect(canUseHint(ready())).toBe(true);
  });
});

describe("canSelect", () => {
  const withState = (patch: Partial<QuizState>) => ({ ...ready(), ...patch });

  it("세션이 없거나, 전송 중이거나, 이미 채점됐거나, 시간이 끝났으면 고를 수 없다", () => {
    expect(canSelect(initialQuizState, 0)).toBe(false);
    expect(canSelect(withState({ pending: true }), 0)).toBe(false);
    expect(canSelect(withState({ feedback: correct }), 0)).toBe(false);
    expect(canSelect(withState({ timeUp: true }), 0)).toBe(false);
    expect(canSelect(withState({}), 3)).toBe(true);
  });

  it("전송에 실패한 뒤에는 처음 고른 보기만 다시 보낼 수 있다", () => {
    const failed = withState({ selected: 2, answerError: "끊김" });
    expect(canSelect(failed, 2)).toBe(true);
    expect(canSelect(failed, 0)).toBe(false);
  });
});

describe("shouldWatchDeadline", () => {
  it("마감 시각이 있고 아직 답을 보내지 않았을 때만 시간 초과를 기다린다", () => {
    const timed = run({ type: "loaded", session }, opened(11, { deadline: 1000 }));
    expect(shouldWatchDeadline(timed)).toBe(true);
    expect(shouldWatchDeadline(ready())).toBe(false); // 제한 시간 없음
    expect(shouldWatchDeadline(quizReducer(timed, { type: "answerSent", optionIndex: 1 }))).toBe(false);
    expect(shouldWatchDeadline(quizReducer(timed, { type: "answerSent", optionIndex: null }))).toBe(false);
    expect(shouldWatchDeadline({ ...timed, feedback: correct })).toBe(false);
    expect(shouldWatchDeadline({ ...timed, selected: 1, answerError: "끊김" })).toBe(false);
  });
});

describe("quizReducer 경계", () => {
  it("마지막 문제 뒤 finish는 집계 중 상태만 켠다", () => {
    const state = quizReducer(ready(), { type: "finish" });
    expect(state).toMatchObject({ finishing: true, index: 0 });
  });

  it("문제 범위를 넘어선 index에서는 현재 문제가 없고 보기를 고를 수 없다", () => {
    const beyond = run({ type: "loaded", session }, { type: "next" }, { type: "next" });
    expect(currentQuestion(beyond)).toBeUndefined();
    expect(isLastQuestion(beyond)).toBe(false);
    expect(canSelect(beyond, 0)).toBe(false);
    expect(canUseHint(beyond)).toBe(false);
    expect(answerToRetry(beyond)).toBeUndefined();
  });

  it("문제가 하나뿐인 세션은 첫 문제가 곧 마지막 문제다", () => {
    const single = quizReducer(initialQuizState, {
      type: "loaded",
      session: { ...session, questions: [session.questions[0]] },
    });
    expect(isLastQuestion(single)).toBe(true);
  });

  it("전송 중 세션 오류(404)가 나면 전송·힌트 요청 중 표시를 끈다", () => {
    const state = run({ type: "loaded", session }, opened(), { type: "answerSent", optionIndex: 1 }, { type: "loadFailed", message: "만료" });
    expect(state).toMatchObject({ pending: false, loadError: "만료" });
    const hint = run({ type: "loaded", session }, opened(), { type: "hintSent" }, { type: "loadFailed", message: "만료" });
    expect(hint.hintPending).toBe(false);
  });
});
