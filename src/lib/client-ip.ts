// 요청한 클라이언트의 IP 판별 (순수 함수, 요청 횟수 제한의 키로 쓴다)
import { isIP } from "node:net";

/**
 * 앞단 프록시 수. 각 프록시는 X-Forwarded-For 오른쪽 끝에 접속한 상대의 IP를 덧붙인다.
 * - Azure Container Apps 인그레스 뒤: 1 (이 값을 반드시 설정)
 * - 프록시 없음(로컬 compose): 0
 * 왼쪽 항목은 클라이언트가 마음대로 보낼 수 있으므로, 오른쪽에서부터 신뢰할 수 있는 위치만 읽는다.
 */
function trustedProxyHops(): number {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(hops) && hops >= 0 ? hops : 0;
}

/** IP를 카운터 키로 정규화한다. IPv6는 한 사용자가 보통 /64 대역 전체를 받으므로 /64 단위로 묶는다. */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim();
  // "[::1]:1234" / "1.2.3.4:1234" 형태의 포트 제거
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  ip = ip.replace(/%.+$/, ""); // IPv6 zone id

  const mapped = ip.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6) return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
  return null;
}

function expandIpv6(ip: string): string[] {
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(8 - left.length - right.length).fill("0") : [];
  return [...left, ...fill, ...right].map((part) => part.replace(/^0+(?=.)/, ""));
}

/** 요청한 클라이언트를 식별하는 키. 알 수 없으면 "unknown"(모두 한 버킷을 공유하므로 운영에서는 생기면 안 된다). */
export function clientKey(headers: Headers, hops: number = trustedProxyHops()): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return "unknown";
  // hops=0: Next.js가 채운 소켓 주소(마지막 항목). hops=n: 오른쪽에서 n번째(신뢰하는 첫 프록시가 기록한 값).
  const index = entries.length - Math.max(hops, 1);
  return normalizeIp(entries[Math.max(index, 0)]) ?? "unknown";
}
