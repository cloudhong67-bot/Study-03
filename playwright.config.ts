import { defineConfig, devices } from "@playwright/test";

// E2E는 docker compose로 띄운 앱(기본 http://127.0.0.1:3001)을 대상으로 실행한다.
//   docker compose up --build -d && npm run test:e2e
// 다른 주소(예: 배포된 ACA)를 검사하려면 E2E_BASE_URL을 지정한다.
// localhost 대신 127.0.0.1을 쓴다: Windows에서 localhost(::1)가 WSL의 다른 서비스로 갈 수 있다.
try {
  process.loadEnvFile(".env"); // 로컬 실행 후 테스트 데이터 정리(global-teardown)용 DATABASE_URL
} catch {}

const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.APP_PORT ?? 3001}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI(GitHub Actions)에서는 실패 위치를 PR 화면에 표시하는 github 리포터를 더한다.
  reporter: process.env.GITHUB_ACTIONS
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL,
    locale: "ko-KR",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // PRD 3장: 모바일 웹이 주 사용 환경 → 최소 지원 폭 360px
      name: "mobile-360",
      testIgnore: /rate-limit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, hasTouch: true },
    },
    {
      name: "desktop",
      testIgnore: /rate-limit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 세션 생성 한도를 일부러 소진하므로, 같은 IP를 쓰는 다른 테스트가 모두 끝난 뒤에 실행한다.
      name: "rate-limit",
      testMatch: /rate-limit\.spec\.ts/,
      dependencies: ["mobile-360", "desktop"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
