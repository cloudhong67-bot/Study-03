import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../../next.config";

const headerMap = (isDev: boolean) =>
  Object.fromEntries(securityHeaders(isDev).map(({ key, value }) => [key, value]));

const cspDirectives = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

describe("next.config 보안 설정", () => {
  it("X-Powered-By 헤더를 끄고, 모든 경로에 보안 헤더를 붙인다", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: expect.any(Array) }]);
  });

  it("운영 CSP: 프레임 삽입·플러그인·외부 출처를 막고 eval/웹소켓은 허용하지 않는다", () => {
    const csp = cspDirectives(headerMap(false)["Content-Security-Policy"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    // 어떤 지시문에도 와일드카드나 외부 스킴 전체 허용이 없어야 한다.
    const sources = Object.values(csp).flat();
    for (const broad of ["*", "https:", "http:"]) expect(sources).not.toContain(broad);
  });

  it("개발 서버에서만 eval(React 디버깅)과 HMR 웹소켓을 허용한다", () => {
    const csp = cspDirectives(headerMap(true)["Content-Security-Policy"]);
    expect(csp["script-src"]).toContain("'unsafe-eval'");
    expect(csp["connect-src"]).toContain("ws:");
  });

  it("클릭재킹·MIME 스니핑·Referer 유출 방지 헤더를 붙인다", () => {
    const headers = headerMap(false);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
