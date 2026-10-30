import { describe, expect, it } from "vitest";
import { clientKey, normalizeIp } from "@/lib/client-ip";

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["[2001:db8::1]:443", "2001:db8:0:0::/64"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected);
  });

  it("IPv6는 /64 대역으로 묶는다 (한 사용자가 대역 안의 주소를 바꿔 가며 우회하지 못하게)", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:0db8:0001:0002::9")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8:1:3::9")).not.toBe(normalizeIp("2001:db8:1:2::9"));
  });

  it.each(["", "not-an-ip", "999.1.1.1", "1.2.3"])("잘못된 값 %j는 null", (raw) => {
    expect(normalizeIp(raw)).toBeNull();
  });
});

describe("clientKey (X-Forwarded-For 해석)", () => {
  it("헤더가 없으면 unknown", () => {
    expect(clientKey(new Headers(), 1)).toBe("unknown");
  });

  it("프록시 1단(ACA 인그레스): 인그레스가 덧붙인 오른쪽 끝 값을 쓰고, 클라이언트가 보낸 왼쪽 값은 무시한다", () => {
    // 공격자가 X-Forwarded-For: 6.6.6.6 을 보내면 인그레스가 실제 IP를 뒤에 붙인다.
    expect(clientKey(xff("6.6.6.6, 203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientKey(xff("6.6.6.6, 7.7.7.7, 203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  it("프록시 2단(예: Front Door → ACA): 오른쪽에서 두 번째 값을 쓴다", () => {
    expect(clientKey(xff("6.6.6.6, 203.0.113.7, 10.0.0.4"), 2)).toBe("203.0.113.7");
  });

  it("프록시 0단(로컬): Next.js가 채운 소켓 주소(마지막 값)를 쓴다", () => {
    expect(clientKey(xff("172.18.0.1"), 0)).toBe("172.18.0.1");
  });

  it("설정한 프록시 수보다 항목이 적으면 가장 왼쪽 값을 쓴다", () => {
    expect(clientKey(xff("203.0.113.7"), 2)).toBe("203.0.113.7");
  });

  it("해석할 수 없는 값이면 unknown", () => {
    expect(clientKey(xff("garbage"), 1)).toBe("unknown");
  });
});
