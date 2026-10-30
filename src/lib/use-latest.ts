import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * 렌더마다 바뀌는 값(주로 콜백)을 이벤트 핸들러·비동기 작업에서 최신으로 읽기 위한 ref.
 * React 규칙상 렌더 중에는 ref를 쓰면 안 되므로, 커밋 직후(useLayoutEffect)에 갱신한다.
 * 사용자 이벤트는 커밋이 끝난 뒤에 처리되므로 핸들러는 항상 최신 값을 본다.
 * (React 19.2+에서는 useEffectEvent로 대체할 수 있다.)
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
