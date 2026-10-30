import type { NextConfig } from "next";

/**
 * 모든 응답에 붙이는 보안 헤더.
 * CSP: App Router는 하이드레이션에 인라인 스크립트를 쓰므로 script-src에 'unsafe-inline'이 필요하다
 * (nonce 방식은 미들웨어가 필요해 이후 과제로 남긴다). 그 외에는 같은 출처만 허용하고 프레임 삽입을 막는다.
 * 개발 서버(next dev)만 React 디버깅용 eval과 HMR 웹소켓을 추가로 허용한다.
 */
export function securityHeaders(isDev: boolean) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // frame-ancestors를 모르는 오래된 브라우저용 클릭재킹 방지
    { key: "X-Frame-Options", value: "DENY" },
    // 결과 페이지 URL(/result/<세션 id>)이 외부 사이트의 Referer로 새지 않게 한다.
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

const nextConfig: NextConfig = {
  // Docker 런타임 이미지용 최소 산출물 (PRD 10.1)
  output: "standalone",
  // X-Powered-By: Next.js 헤더로 사용 프레임워크를 드러내지 않는다.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "development") },
    ];
  },
};

export default nextConfig;
