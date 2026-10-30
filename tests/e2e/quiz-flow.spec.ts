import { expect, test } from "@playwright/test";
import { answerAndVerify, currentScore, optionButtons, uniqueNickname } from "./fixtures";

// 과학 10문제 만점: 기본 150 + (빠른 답 3 + 힌트 미사용 2) × 10 + 콤보 2 + 5 + 10 (난이도는 prisma/data/questions.json)
const SCIENCE_MAX_SCORE = 217;

test("핵심 흐름: 메인 → 카테고리 퀴즈 10문제 → 결과 → 닉네임 등록 → 순위표", async ({ page }) => {
  const nickname = uniqueNickname();

  // 1. 메인 화면
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "지식와 도전" })).toBeVisible();
  await page.getByRole("button", { name: /카테고리 선택/ }).click();
  await page.getByRole("link", { name: /과학/ }).click();
  await expect(page).toHaveURL(/\/quiz\?category=science$/);

  // 2. 퀴즈 진행: 보기 위치를 바꿔 가며 10문제를 풀고, 매번 즉시 피드백을 확인한다.
  let correctCount = 0;
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`과학 ${i} / 10`)).toBeVisible();
    if (await answerAndVerify(page, (i - 1) % 4)) correctCount++;
    await expect(page.getByText(`맞힌 문제 ${correctCount}`)).toBeVisible();
    await page.getByRole("button", { name: i === 10 ? /결과 보기/ : /다음 문제/ }).click();
  }
  const score = await currentScore(page);
  expect(score).toBeGreaterThanOrEqual(correctCount * 10);

  // 3. 결과 화면: 퀴즈 화면의 점수·정답 수와 서버가 계산한 결과가 같아야 한다.
  await expect(page).toHaveURL(/\/result\/[0-9a-f-]{36}$/);
  const resultUrl = page.url();
  const summary = page.getByRole("region", { name: "결과 요약" });
  await expect(summary).toContainText("과학 퀴즈 최종 점수");
  await expect(summary).toContainText(`${score} / ${SCIENCE_MAX_SCORE}점`);
  await expect(summary).toContainText("점수 구성");
  await expect(summary).toContainText(`${correctCount * 10}%`);
  await expect(summary).toContainText(`${correctCount} / 10`);

  // 4. 닉네임 등록 → 순위표로 이동하고 방금 기록이 강조된다.
  await page.getByRole("textbox", { name: /닉네임/ }).fill(nickname);
  await page.getByRole("button", { name: "점수 등록" }).click();
  await expect(page).toHaveURL(/\/leaderboard\?mode=CATEGORY&category=science.*highlight=\d+/);
  await expect(page.getByRole("heading", { name: /과학 Top/ })).toBeVisible();
  const myRow = page.locator("tr[aria-current='true']");
  await expect(myRow).toContainText(nickname);
  await expect(myRow).toContainText(`${score}/${SCIENCE_MAX_SCORE}`);

  // 5. 결과 화면을 다시 열면 중복 등록 대신 "이미 등록" 상태가 보인다.
  await page.goto(resultUrl);
  await expect(page.getByText("이미 순위표에 등록한 기록입니다")).toBeVisible();
  await expect(page.getByRole("button", { name: "점수 등록" })).toHaveCount(0);
});

test("전체 모드 시작과 키보드 답안 선택", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /게임 시작/ }).click();
  await expect(page).toHaveURL(/\/quiz\?mode=all$/);
  await expect(page.getByText("전체 1 / 40")).toBeVisible();

  await expect(optionButtons(page)).toHaveCount(4);
  // 서버가 문제를 열었다고 확인한 뒤에(보기가 켜진 뒤에) 고를 수 있다.
  await expect(optionButtons(page).first()).toBeEnabled();
  await page.keyboard.press("2");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(optionButtons(page).nth(1)).toHaveAccessibleName(/\((정답|선택한 오답)\)$/);

  // [다음 문제]에 포커스가 가 있어 Enter로 넘어간다.
  await page.keyboard.press("Enter");
  await expect(page.getByText("전체 2 / 40")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

// 로컬 E2E는 모든 요청이 같은 IP라 세션 생성 한도(10분에 30회)를 함께 쓴다. 세션을 아끼려고 한 테스트에서 둘 다 확인한다.
test("스피드 퀴즈와 50:50 힌트: 힌트는 오답 2개만 지우고, 15초가 지나면 시간 초과로 정답을 보여 준다", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("link", { name: /스피드 퀴즈/ }).click();
  await expect(page).toHaveURL(/\/quiz\?mode=speed$/);
  await expect(page.getByText("스피드 1 / 20")).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();

  // 1번 문제: 힌트를 쓰고 남은 보기 가운데 첫 번째를 고른다.
  const hint = page.getByRole("button", { name: /50:50 힌트/ });
  await expect(hint).toBeEnabled();
  await hint.click();
  const removed = page.getByRole("button", { name: /\(힌트로 제외\)$/ });
  await expect(removed).toHaveCount(2);
  for (const option of await removed.all()) await expect(option).toBeDisabled();
  await expect(page.getByRole("button", { name: "💡 50:50 힌트 사용함" })).toBeDisabled();

  const options = optionButtons(page);
  let pick = 0;
  while (/힌트로 제외/.test((await options.nth(pick).getAttribute("aria-label")) ?? "")) pick++;
  await options.nth(pick).click();
  const status = page.getByRole("status");
  await expect(status).toBeVisible();
  // 지운 보기는 채점 후에도 그대로이고, 정답은 지워지지 않는다.
  await expect(removed).toHaveCount(2);
  await expect(page.getByRole("button", { name: /\(정답\)$/ })).toHaveCount(1);
  await expect(status).not.toContainText("힌트 미사용");
  await expect(hint).toHaveCount(0);

  // 2번 문제: 힌트를 다시 쓸 수 있고, 그대로 두면 시간이 끝난다.
  await page.getByRole("button", { name: /다음 문제/ }).click();
  await expect(page.getByText("스피드 2 / 20")).toBeVisible();
  await expect(page.getByRole("button", { name: "💡 50:50 힌트" })).toBeEnabled();

  await expect(status).toContainText("시간 초과", { timeout: 20_000 });
  await expect(status).toContainText("정답:");
  await expect(page.getByRole("button", { name: /\(정답\)$/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /\(선택한 오답\)$/ })).toHaveCount(0);
  for (const option of await optionButtons(page).all()) await expect(option).toBeDisabled();
  await expect(page.getByText(/🔥/)).toHaveCount(0);
});

test("효과음 설정은 새로고침해도 유지되고, 저장값과 서버 기본값이 달라도 hydration 오류가 없다", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/quiz?category=science");
  await expect(page.getByText("과학 1 / 10")).toBeVisible();
  const mute = page.getByRole("button", { name: "효과음 끄기" });
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await mute.click();
  await expect(page.getByRole("button", { name: "효과음 켜기" })).toHaveAttribute("aria-pressed", "false");

  // 서버는 기본값(켜짐)으로 그리고, 브라우저는 저장된 값(꺼짐)으로 바꾼다.
  await page.reload();
  await expect(page.getByText("과학 1 / 10")).toBeVisible();
  const unmute = page.getByRole("button", { name: "효과음 켜기" });
  await expect(unmute).toHaveAttribute("aria-pressed", "false");

  // 꺼진 상태에서도 답안·피드백 흐름은 그대로 동작한다.
  await answerAndVerify(page, 0);

  await unmute.click();
  await expect(page.getByRole("button", { name: "효과음 끄기" })).toBeVisible();
  expect(consoleErrors.filter((e) => /hydrat|did not match|server rendered/i.test(e))).toEqual([]);
});

test("순위표: 카테고리 탭·Top 50 전환과 재도전", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: "전체 Top 10" })).toBeVisible();

  await page.getByRole("link", { name: "지리", exact: true }).click();
  await expect(page).toHaveURL(/mode=CATEGORY&category=geography/);
  await expect(page.getByRole("heading", { name: "지리 Top 10" })).toBeVisible();

  await page.getByRole("link", { name: "Top 50" }).click();
  await expect(page).toHaveURL(/category=geography&limit=50/);
  await expect(page.getByRole("heading", { name: "지리 Top 50" })).toBeVisible();

  await page.getByRole("link", { name: /지리 재도전/ }).click();
  await expect(page).toHaveURL(/\/quiz\?category=geography$/);
  await expect(page.getByText("지리 1 / 10")).toBeVisible();

  await page.goto("/leaderboard");
  await page.getByRole("link", { name: "⚡ 스피드" }).click();
  await expect(page).toHaveURL(/mode=SPEED/);
  await expect(page.getByRole("heading", { name: "스피드 Top 10" })).toBeVisible();
  // 누르면 세션이 생겨 로컬 E2E가 함께 쓰는 IP의 세션 생성 한도를 쓰므로, 주소만 확인한다.
  await expect(page.getByRole("link", { name: /스피드 재도전/ })).toHaveAttribute("href", "/quiz?mode=speed");
});

test("잘못된 주소는 404 화면을 보여 준다", async ({ page }) => {
  const res = await page.goto("/result/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
});
