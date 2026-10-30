import { expect, test } from "@playwright/test";
import { answerAndVerify, optionButtons, uniqueNickname } from "./fixtures";

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

  // 3. 결과 화면: 화면에서 센 정답 수와 서버가 계산한 점수가 같아야 한다.
  await expect(page).toHaveURL(/\/result\/[0-9a-f-]{36}$/);
  const resultUrl = page.url();
  const summary = page.getByRole("region", { name: "결과 요약" });
  await expect(summary).toContainText("과학 퀴즈 최종 점수");
  await expect(summary).toContainText(`${correctCount * 10} / 100점`);
  await expect(summary).toContainText(`${correctCount * 10}%`);
  await expect(summary).toContainText(`${correctCount} / 10`);

  // 4. 닉네임 등록 → 순위표로 이동하고 방금 기록이 강조된다.
  await page.getByRole("textbox", { name: /닉네임/ }).fill(nickname);
  await page.getByRole("button", { name: "점수 등록" }).click();
  await expect(page).toHaveURL(/\/leaderboard\?mode=CATEGORY&category=science.*highlight=\d+/);
  await expect(page.getByRole("heading", { name: /과학 Top/ })).toBeVisible();
  const myRow = page.locator("tr[aria-current='true']");
  await expect(myRow).toContainText(nickname);
  await expect(myRow).toContainText(`${correctCount * 10}/100`);

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
  await page.keyboard.press("2");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(optionButtons(page).nth(1)).toHaveAccessibleName(/\((정답|선택한 오답)\)$/);

  // [다음 문제]에 포커스가 가 있어 Enter로 넘어간다.
  await page.keyboard.press("Enter");
  await expect(page.getByText("전체 2 / 40")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
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
});

test("잘못된 주소는 404 화면을 보여 준다", async ({ page }) => {
  const res = await page.goto("/result/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
});
