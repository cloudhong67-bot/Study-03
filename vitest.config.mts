import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 통합 테스트는 개발 DB를 건드리지 않도록 별도 DB(이름이 _test로 끝남)를 쓴다.
// TEST_DATABASE_URL이 없으면 .env의 DATABASE_URL에서 DB 이름 뒤에 _test를 붙여 만든다.
// 여기서 정한 값은 globalSetup(tests/global-setup.ts)과 테스트 워커가 함께 쓴다.
try {
  process.loadEnvFile(".env");
} catch {}

if (!process.env.TEST_DATABASE_URL) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL이 없습니다. .env.example을 .env로 복사하세요.");
  }
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/_test$/, "")}_test`;
  process.env.TEST_DATABASE_URL = url.toString();
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL },
    // 통합 테스트가 같은 테스트 DB를 쓰므로 파일을 순서대로 실행한다.
    fileParallelism: false,
    // npm run test:coverage. UI 컴포넌트(.tsx)는 E2E가 맡으므로 제외한다.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/components/button-styles.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
