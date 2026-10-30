import { expect, type Page } from "@playwright/test";

/** E2E가 등록하는 닉네임 접두사. global-teardown이 이 접두사로 테스트 기록을 찾아 지운다. */
export const E2E_USERNAME_PREFIX = "E2E-";

/** 2~12자 제한 안에서 실행마다 겹치지 않는 닉네임 (예: "E2E-a1b2c3") */
export function uniqueNickname(): string {
  return `${E2E_USERNAME_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
}

/** 퀴즈 화면 상단의 지금까지의 총점 ("점수 N점") */
export async function currentScore(page: Page): Promise<number> {
  const text = await page.getByText(/^점수 \d+점/).innerText();
  return Number(/점수 (\d+)점/.exec(text)?.[1]);
}

/** 보기 버튼(aria-label "N번. 보기 (상태)") */
export const optionButtons = (page: Page) => page.getByRole("button", { name: /^[1-4]번\./ });

/**
 * 현재 문제에 pick번째(0~3) 보기로 답하고 피드백을 검증한 뒤 정답 여부를 돌려준다.
 * 정답은 화면에 미리 나오지 않으므로, 채점 결과에 맞는 연출이 나왔는지를 확인한다.
 */
export async function answerAndVerify(page: Page, pick: number): Promise<boolean> {
  const options = optionButtons(page);
  await expect(options).toHaveCount(4);
  await options.nth(pick).click();

  const status = page.getByRole("status");
  await expect(status).toBeVisible();

  // 채점 후: 보기가 모두 잠기고, 정답 표시는 정확히 하나
  for (const option of await options.all()) await expect(option).toBeDisabled();
  await expect(page.getByRole("button", { name: /\(정답\)$/ })).toHaveCount(1);

  // 퀴즈 화면이 1초 답안 간격을 스스로 채우므로, 빠르게 눌러도 서버의 "너무 빨리" 거절이 보이면 안 된다.
  await expect(page.getByText("너무 빨리")).toHaveCount(0);

  const isCorrect = (await status.innerText()).includes("정답입니다");
  if (isCorrect) {
    await expect(options.nth(pick)).toHaveAccessibleName(/\(정답\)$/);
    await expect(page.getByRole("button", { name: /\(선택한 오답\)$/ })).toHaveCount(0);
  } else {
    await expect(options.nth(pick)).toHaveAccessibleName(/\(선택한 오답\)$/);
    await expect(status).toContainText("정답:");
  }
  return isCorrect;
}
