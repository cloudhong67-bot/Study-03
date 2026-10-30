import { expect, test } from "@playwright/test";
import { optionButtons } from "./fixtures";

test("모든 응답에 보안 헤더가 붙고 X-Powered-By는 없다", async ({ request }) => {
  for (const path of ["/", "/leaderboard", "/api/health"]) {
    const res = await request.get(path);
    expect(res.ok(), path).toBe(true);
    const headers = res.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).not.toContain("unsafe-eval");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("same-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("CSP를 적용해도 화면이 정상 동작하고 위반이 하나도 없다", async ({ page }) => {
  // 브라우저가 CSP로 막은 리소스·스크립트를 모두 기록한다.
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

  await page.goto("/");
  await page.getByRole("button", { name: /카테고리 선택/ }).click();
  await page.getByRole("link", { name: /한국사/ }).click();
  await expect(page.getByText("한국사 1 / 10")).toBeVisible();
  expect(await violations()).toEqual([]);

  // 하이드레이션이 막히면 클릭·키보드가 동작하지 않으므로, 실제로 답하고 피드백을 받는다.
  await expect(optionButtons(page)).toHaveCount(4);
  await page.keyboard.press("1");
  await expect(page.getByRole("status")).toBeVisible();
  expect(await violations()).toEqual([]);

  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: /Top 10/ })).toBeVisible();
  expect(await violations()).toEqual([]);

  // 내 기록 화면의 정답률 막대는 style 속성으로 폭을 정한다. 세션을 새로 만들지 않도록 저장된 기록을 넣고 연다.
  await page.evaluate(() => {
    const game = {
      sessionId: "csp-check",
      mode: "CATEGORY",
      category: "과학",
      categorySlug: "science",
      score: 100,
      maxScore: 217,
      correctCount: 5,
      totalCount: 10,
      maxStreak: 3,
      timedOutCount: 0,
      byCategory: [{ category: "과학", correct: 5, total: 10 }],
      playedAt: "2026-10-30T03:00:00.000Z",
    };
    localStorage.setItem("trivia:history", JSON.stringify({ version: 1, games: [game] }));
  });
  await page.goto("/records");
  await expect(page.getByRole("meter", { name: "과학 정답률" })).toHaveAttribute("aria-valuenow", "50");
  expect(await violations()).toEqual([]);
  expect(consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
});

test("다른 사이트가 iframe으로 앱을 삽입할 수 없다 (클릭재킹 방지)", async ({ page, baseURL }) => {
  // about:blank(다른 출처)에서 앱을 iframe으로 불러오면 frame-ancestors 'none'에 막혀 내용이 비어 있어야 한다.
  await page.setContent(`<iframe id="app" src="${baseURL}/" width="360" height="600"></iframe>`);
  const frame = page.frameLocator("#app");
  await page.waitForTimeout(1500);
  await expect(frame.getByRole("heading", { name: "지식와 도전" })).toHaveCount(0);
});

test("4KB를 넘는 요청 본문은 413으로 거절한다", async ({ request }) => {
  const res = await request.post("/api/sessions", {
    data: { mode: "ALL", padding: "a".repeat(10_000) },
  });
  expect(res.status()).toBe(413);
  expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");

  const ok = await request.post("/api/sessions", { data: { mode: "CATEGORY", categorySlug: "science" } });
  expect(ok.status()).toBe(201);
});
