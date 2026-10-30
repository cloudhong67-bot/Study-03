import { expect, test } from "@playwright/test";

// 이 파일은 playwright.config.ts의 "rate-limit" 프로젝트로, 다른 E2E가 모두 끝난 뒤에 실행된다.
// 로컬 E2E의 모든 요청은 같은 IP에서 오므로, 여기서 세션 생성 한도를 소진하면 다른 테스트가 막히기 때문이다.
// (소진한 카운터는 global-teardown이 비운다.)
test.skip(!!process.env.E2E_BASE_URL, "원격 대상에서는 실제 사용자의 한도를 소진하지 않는다");

test("세션 생성 한도를 넘으면 API는 429·Retry-After, 퀴즈 화면은 안내와 [다시 시도]를 보여 준다", async ({
  request,
  page,
}) => {
  let last;
  for (let i = 0; i < 100; i++) {
    last = await request.post("/api/sessions", { data: { mode: "ALL" } });
    if (last.status() === 429) break;
    expect(last.status()).toBe(201);
  }
  expect(last!.status()).toBe(429);
  expect(Number(last!.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await last!.json()).error.code).toBe("TOO_MANY_REQUESTS");

  await page.goto("/quiz?category=science");
  await expect(page.getByText("요청이 너무 많습니다")).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();

  // 조회(GET) 화면은 한도와 무관하게 계속 열린다.
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: /Top 10/ })).toBeVisible();
});
