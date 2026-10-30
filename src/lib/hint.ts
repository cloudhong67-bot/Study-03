// 50:50 힌트 (순수 함수)
import { shuffle } from "@/lib/shuffle";

export const OPTION_COUNT = 4;

/** 정답이 아닌 보기 가운데 무작위로 2개를 골라 오름차순으로 돌려준다. */
export function pickFiftyFiftyRemovals(answerIndex: number, random: () => number = Math.random): number[] {
  const wrong = Array.from({ length: OPTION_COUNT }, (_, i) => i).filter((i) => i !== answerIndex);
  return shuffle(wrong, random)
    .slice(0, 2)
    .sort((a, b) => a - b);
}
