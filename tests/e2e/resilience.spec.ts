import { expect, test, type Page, type Route } from "@playwright/test";
import { answerAndVerify, optionButtons, uniqueNickname } from "./fixtures";

const ANSWERS = "**/api/sessions/*/answers";

async function startScienceQuiz(page: Page) {
  await page.goto("/quiz?category=science");
  await expect(page.getByText("과학 1 / 10")).toBeVisible();
}

/** 요청은 서버까지 보내 처리시키되(답안 기록됨), 브라우저에는 네트워크 오류로 보이게 한다 = 응답 유실. */
async function deliverThenDropResponse(route: Route) {
  await route.fetch();
  await route.abort("failed");
}

test("답안 응답이 유실돼도 자동 재시도로 같은 결과를 받는다 (서버가 재전송을 인식)", async ({ page }) => {
  let calls = 0;
  await page.route(ANSWERS, async (route) => {
    calls++;
    if (calls === 1) return deliverThenDropResponse(route);
    return route.continue();
  });
  await startScienceQuiz(page);

  await answerAndVerify(page, 0);
  expect(calls).toBe(2); // 유실 1번 + 자동 재시도 1번
  await expect(page.getByRole("alert").filter({ hasText: "네트워크" })).toHaveCount(0);

  // 이후 문제도 정상 진행된다.
  await page.getByRole("button", { name: /다음 문제/ }).click();
  await expect(page.getByText("과학 2 / 10")).toBeVisible();
});

test("서버가 일시적으로 503을 보내면 Retry-After만큼 기다렸다가 다시 보내 성공한다", async ({ page }) => {
  let calls = 0;
  await page.route(ANSWERS, async (route) => {
    calls++;
    if (calls === 1) {
      return route.fulfill({
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "1" },
        body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "잠시 후 다시 시도" } }),
      });
    }
    return route.continue();
  });
  await startScienceQuiz(page);
  await answerAndVerify(page, 1);
  expect(calls).toBe(2);
});

test("네트워크가 계속 끊기면 안내와 [다시 시도]를 보여 주고, 고른 답을 유지한 채 다시 보낸다", async ({ page }) => {
  let offline = true;
  await page.route(ANSWERS, (route) => (offline ? route.abort("internetdisconnected") : route.continue()));
  await startScienceQuiz(page);

  await optionButtons(page).nth(2).click();
  const alert = page.getByRole("alert").filter({ hasText: "네트워크에 연결할 수 없어요" });
  await expect(alert).toBeVisible({ timeout: 15_000 }); // 자동 재시도 2번을 모두 실패한 뒤
  await expect(alert).toContainText("고른 답(3번)은 그대로 유지돼요");
  // 다른 보기로 바꿀 수 없다 (서버에 이미 기록됐을 수 있으므로)
  for (const option of await optionButtons(page).all()) await expect(option).toBeDisabled();

  offline = false;
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(optionButtons(page).nth(2)).toHaveAccessibleName(/\((정답|선택한 오답)\)$/);
  await expect(alert).toHaveCount(0);
});

test("퀴즈 시작 요청이 실패하면 오류 화면의 [다시 시도]로 복구한다", async ({ page }) => {
  let fail = true;
  await page.route("**/api/sessions", (route) =>
    fail && route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  await page.goto("/quiz?category=geography");
  await expect(page.getByText("네트워크에 연결할 수 없어요")).toBeVisible();

  fail = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("지리 1 / 10")).toBeVisible();
});

test("점수 등록 응답이 유실돼도 자동 재시도로 등록 결과(순위)를 받아 순위표로 이동한다", async ({ page }) => {
  const nickname = uniqueNickname();
  let submitCalls = 0;
  await page.route("**/api/sessions/*/submit", async (route) => {
    submitCalls++;
    if (submitCalls === 1) return deliverThenDropResponse(route);
    return route.continue();
  });

  await startScienceQuiz(page);
  for (let i = 1; i <= 10; i++) {
    await answerAndVerify(page, 0);
    await page.getByRole("button", { name: i === 10 ? /결과 보기/ : /다음 문제/ }).click();
  }
  await expect(page).toHaveURL(/\/result\//);

  await page.getByRole("textbox", { name: /닉네임/ }).fill(nickname);
  await page.getByRole("button", { name: "점수 등록" }).click();
  await expect(page).toHaveURL(/\/leaderboard\?.*highlight=\d+/);
  await expect(page.locator("tr[aria-current='true']")).toContainText(nickname);
  expect(submitCalls).toBe(2);
});
