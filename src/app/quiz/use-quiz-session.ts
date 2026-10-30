"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { sleep } from "@/lib/async";
import { ApiError, errorMessage, postJson } from "@/lib/http-client";
import { MIN_ANSWER_INTERVAL_MS } from "@/lib/limits";
import type { AnswerFeedback, CreatedSession } from "@/lib/quiz/sessions";
import { useLatest } from "@/lib/use-latest";
import { canSelect, currentQuestion, initialQuizState, isLastQuestion, quizReducer } from "./quiz-state";

/**
 * 퀴즈 세션의 서버 통신과 진행을 맡는다 (화면 표시는 QuizRunner).
 * - 세션 생성은 멱등이 아니라 자동 재시도하지 않는다 (재시도마다 새 세션이 생기고 요청 한도를 쓴다)
 * - 답안 제출은 멱등이라 자동 재시도하고, 서버의 1초 답안 간격을 미리 채워서 보낸다
 */
export function useQuizSession(categorySlug: string | null, onFeedback?: (feedback: AnswerFeedback) => void) {
  const router = useRouter();
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  // 응답을 기다리는 동안 효과음 설정 등이 바뀌어도 도착 시점의 최신 콜백을 부른다.
  const onFeedbackRef = useLatest(onFeedback);

  // 같은 틱에 두 번 눌러도(렌더 전) 답안이 한 번만 전송되도록 동기적으로 막는다.
  // (select는 렌더 시점의 state로 만들어지므로, 렌더 전 두 번째 호출은 이 가드가 막는다.)
  const inFlight = useRef(false);
  // 서버는 직전 답안(첫 답안은 세션 시작)으로부터 MIN_ANSWER_INTERVAL_MS 안에 온 답안을 거절한다.
  // 응답을 받은 시각부터 재므로, 여기서 간격을 채우면 서버 쪽 간격은 항상 그보다 길다.
  const lastAnswerAt = useRef(0);

  const start = useCallback(async () => {
    dispatch({ type: "start" });
    try {
      const body = categorySlug ? { mode: "CATEGORY", categorySlug } : { mode: "ALL" };
      const session = await postJson<CreatedSession>("/api/sessions", body);
      lastAnswerAt.current = Date.now();
      dispatch({ type: "loaded", session });
    } catch (error) {
      dispatch({ type: "loadFailed", message: errorMessage(error) });
    }
  }, [categorySlug]);

  // 개발 모드(StrictMode)에서 effect가 두 번 실행돼도 세션은 하나만 만든다.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const select = useCallback(async (optionIndex: number) => {
    const question = currentQuestion(state);
    if (inFlight.current || !state.session || !question || !canSelect(state, optionIndex)) return;
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
      if (error instanceof ApiError && error.status === 404) {
        dispatch({ type: "loadFailed", message: error.message }); // 만료되었거나 없는 세션 → 새 퀴즈 시작 화면
      } else {
        dispatch({ type: "answerFailed", message: errorMessage(error) });
      }
    } finally {
      inFlight.current = false;
    }
  }, [state, onFeedbackRef]);

  const next = useCallback(() => {
    if (!state.session) return;
    if (isLastQuestion(state)) {
      dispatch({ type: "finish" });
      router.push(`/result/${state.session.sessionId}`);
      return;
    }
    dispatch({ type: "next" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [state, router]);

  return {
    state,
    question: currentQuestion(state),
    isLast: isLastQuestion(state),
    start,
    select,
    next,
  };
}
