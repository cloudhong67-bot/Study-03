"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { sleep } from "@/lib/async";
import { ApiError, errorMessage, postJson } from "@/lib/http-client";
import { MIN_ANSWER_INTERVAL_MS } from "@/lib/limits";
import type { AnswerFeedback, CreatedSession, HintResult, OpenedQuestion } from "@/lib/quiz/sessions";
import type { QuizTarget } from "@/lib/routes";
import { useLatest } from "@/lib/use-latest";
import {
  answerToRetry,
  canSelect,
  canUseHint,
  currentQuestion,
  initialQuizState,
  isLastQuestion,
  quizReducer,
  shouldWatchDeadline,
} from "./quiz-state";

/** 서버 요청이 404면(만료되었거나 없는 세션) 새 퀴즈 시작 화면으로 바꾼다. */
const isSessionGone = (error: unknown) => error instanceof ApiError && error.status === 404;

function createSessionBody({ mode, categorySlug }: QuizTarget) {
  if (categorySlug) return { mode: "CATEGORY", categorySlug };
  return { mode: mode === "SPEED" ? "SPEED" : "ALL" };
}

/**
 * 퀴즈 세션의 서버 통신과 진행을 맡는다 (화면 표시는 QuizRunner).
 * - 세션 생성은 멱등이 아니라 자동 재시도하지 않는다 (재시도마다 새 세션이 생기고 요청 한도를 쓴다)
 * - 문제 열기·힌트·답안 제출은 멱등이라 자동 재시도한다. 답안은 서버의 1초 답안 간격을 미리 채워서 보낸다
 * - 문제는 서버가 열었다고 확인한 뒤에 고를 수 있다 (서버가 그때부터 답안 시간을 잰다)
 * - 제한 시간이 있으면 마감 시각에 보기 없이(null) 답안을 보내 시간 초과로 처리한다
 */
export function useQuizSession(target: QuizTarget, onFeedback?: (feedback: AnswerFeedback) => void) {
  const router = useRouter();
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  // 응답을 기다리는 동안 효과음 설정 등이 바뀌어도 도착 시점의 최신 콜백을 부른다.
  const onFeedbackRef = useLatest(onFeedback);
  const { mode, categorySlug } = target;

  // 같은 틱에 두 번 눌러도(렌더 전) 답안·힌트 요청이 한 번만 전송되도록 동기적으로 막는다.
  // (select는 렌더 시점의 state로 만들어지므로, 렌더 전 두 번째 호출은 이 가드가 막는다.)
  const inFlight = useRef(false);
  // 서버는 직전 답안(첫 답안은 세션 시작)으로부터 MIN_ANSWER_INTERVAL_MS 안에 온 답안을 거절한다.
  // 응답을 받은 시각부터 재므로, 여기서 간격을 채우면 서버 쪽 간격은 항상 그보다 길다.
  const lastAnswerAt = useRef(0);

  const open = useCallback(async (sessionId: string, questionId: number) => {
    try {
      const opened = await postJson<OpenedQuestion>(`/api/sessions/${sessionId}/views`, { questionId }, { retries: 2 });
      const deadline = opened.remainingMs === null ? null : Date.now() + opened.remainingMs;
      dispatch({ type: "opened", questionId, removed: opened.removedOptions, deadline });
    } catch (error) {
      dispatch({ type: isSessionGone(error) ? "loadFailed" : "openFailed", message: errorMessage(error) });
    }
  }, []);

  const start = useCallback(async () => {
    dispatch({ type: "start" });
    let session: CreatedSession;
    try {
      session = await postJson<CreatedSession>("/api/sessions", createSessionBody({ mode, categorySlug }));
    } catch (error) {
      dispatch({ type: "loadFailed", message: errorMessage(error) });
      return;
    }
    lastAnswerAt.current = Date.now();
    dispatch({ type: "loaded", session });
    await open(session.sessionId, session.questions[0].id);
  }, [mode, categorySlug, open]);

  // 개발 모드(StrictMode)에서 effect가 두 번 실행돼도 세션은 하나만 만든다.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const retryOpen = useCallback(() => {
    const question = currentQuestion(state);
    if (state.session && question && !state.opened) void open(state.session.sessionId, question.id);
  }, [state, open]);

  /** 답안을 보낸다. optionIndex가 null이면 시간 초과 (canSelect 등 호출 조건은 부르는 쪽이 확인한다) */
  const send = useCallback(
    async (optionIndex: number | null) => {
      const question = currentQuestion(state);
      if (inFlight.current || !state.session || !question) return;
      const { sessionId } = state.session;

      inFlight.current = true;
      dispatch({ type: "answerSent", optionIndex });
      try {
        const wait = MIN_ANSWER_INTERVAL_MS - (Date.now() - lastAnswerAt.current);
        if (wait > 0) await sleep(wait);
        const feedback = await postJson<AnswerFeedback>(
          `/api/sessions/${sessionId}/answers`,
          { questionId: question.id, selectedIndex: optionIndex },
          { retries: 2 },
        );
        lastAnswerAt.current = Date.now();
        dispatch({ type: "answered", feedback });
        onFeedbackRef.current?.(feedback);
      } catch (error) {
        dispatch({ type: isSessionGone(error) ? "loadFailed" : "answerFailed", message: errorMessage(error) });
      } finally {
        inFlight.current = false;
      }
    },
    [state, onFeedbackRef],
  );

  const select = useCallback(
    async (optionIndex: number) => {
      if (canSelect(state, optionIndex)) await send(optionIndex);
    },
    [state, send],
  );

  /** 전송에 실패한 답(고른 보기 또는 시간 초과)을 같은 값으로 다시 보낸다. */
  const retryAnswer = useCallback(async () => {
    const answer = answerToRetry(state);
    if (answer !== undefined && !state.pending) await send(answer);
  }, [state, send]);

  // 마감 시각이 되면 보기 없이 답안을 보낸다. 서버도 시간을 재므로, 이 타이머는 결과를 일찍 보여 주는 역할이다.
  useEffect(() => {
    if (!shouldWatchDeadline(state) || state.deadline === null) return;
    const timer = setTimeout(() => void send(null), Math.max(0, state.deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [state, send]);

  const hint = useCallback(async () => {
    const question = currentQuestion(state);
    if (inFlight.current || !state.session || !question || !canUseHint(state)) return;
    const { sessionId } = state.session;

    inFlight.current = true;
    dispatch({ type: "hintSent" });
    try {
      const result = await postJson<HintResult>(
        `/api/sessions/${sessionId}/hints`,
        { questionId: question.id },
        { retries: 2 },
      );
      dispatch({ type: "hintReceived", questionId: question.id, removed: result.removedOptions });
    } catch (error) {
      dispatch({ type: isSessionGone(error) ? "loadFailed" : "hintFailed", message: errorMessage(error) });
    } finally {
      inFlight.current = false;
    }
  }, [state]);

  const next = useCallback(() => {
    if (!state.session) return;
    if (isLastQuestion(state)) {
      dispatch({ type: "finish" });
      router.push(`/result/${state.session.sessionId}`);
      return;
    }
    dispatch({ type: "next" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    void open(state.session.sessionId, state.session.questions[state.index + 1].id);
  }, [state, router, open]);

  return {
    state,
    question: currentQuestion(state),
    isLast: isLastQuestion(state),
    hintAvailable: canUseHint(state),
    start,
    retryOpen,
    select,
    retryAnswer,
    hint,
    next,
  };
}
