// 순수 함수들의 입력 경계: null·원시값·빈 배열·숫자 극값(NaN·Infinity·안전 정수 범위)·문자열 극단.
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "@/lib/async";
import { clientKey, normalizeIp } from "@/lib/client-ip";
import { isTransientDatabaseError, isUniqueViolation } from "@/lib/db-errors";
import { AppError, isNotFoundError } from "@/lib/errors";
import { firstParam, flattenSearchParams } from "@/lib/page-helpers";
import { buildResultSummary, sessionQuestionInfos } from "@/lib/quiz/summary";
import { calculateAccuracy, calculateMaxScore, calculateScore } from "@/lib/scoring";
import { shuffle } from "@/lib/shuffle";
import {
  createSessionSchema,
  leaderboardQuerySchema,
  sessionIdSchema,
  submitAnswerSchema,
  submitScoreSchema,
} from "@/lib/validation";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("요청 스키마: 객체가 아닌 본문", () => {
  it.each([null, undefined, [], "ALL", 42, true])("%j는 모든 요청 스키마에서 거부된다", (body) => {
    expect(ok(createSessionSchema, body)).toBe(false);
    expect(ok(submitAnswerSchema, body)).toBe(false);
    expect(ok(submitScoreSchema, body)).toBe(false);
  });

  it("mode는 대소문자를 구분한다", () => {
    expect(ok(createSessionSchema, { mode: "all" })).toBe(false);
    expect(ok(createSessionSchema, { mode: "category", categorySlug: "science" })).toBe(false);
  });

  it("공백뿐인 categorySlug는 빈 값으로 보고 거부한다", () => {
    expect(ok(createSessionSchema, { mode: "CATEGORY", categorySlug: "   " })).toBe(false);
  });
});

describe("submitAnswerSchema: 숫자 극값", () => {
  it.each([
    ["0", 0],
    ["음수", -1],
    ["소수", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["안전 정수 범위 밖", Number.MAX_SAFE_INTEGER + 1],
    ["문자열 숫자", "1"],
    ["null", null],
  ])("questionId가 %s이면 거부", (_label, questionId) => {
    expect(ok(submitAnswerSchema, { questionId, selectedIndex: 0 })).toBe(false);
  });

  it("안전 정수 최댓값은 형식상 통과한다 (세션에 없는 문제라 서비스에서 400으로 거부)", () => {
    expect(ok(submitAnswerSchema, { questionId: Number.MAX_SAFE_INTEGER, selectedIndex: 0 })).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5, "0", null, undefined])("selectedIndex %j는 거부", (selectedIndex) => {
    expect(ok(submitAnswerSchema, { questionId: 1, selectedIndex })).toBe(false);
  });
});

describe("닉네임: 타입·길이 극단", () => {
  it.each([null, undefined, 123, [], {}])("문자열이 아닌 %j는 거부", (username) => {
    expect(ok(submitScoreSchema, { username })).toBe(false);
  });

  it.each(["", "   ", "\t\n"])("비었거나 공백뿐인 %j는 거부", (username) => {
    expect(ok(submitScoreSchema, { username })).toBe(false);
  });

  it("정확히 2자(최소 경계)는 통과한다", () => {
    expect(submitScoreSchema.parse({ username: "ab" })).toEqual({ username: "ab" });
  });

  it("아주 긴 문자열(10만 자)도 예외 없이 거부한다", () => {
    expect(ok(submitScoreSchema, { username: "가".repeat(100_000) })).toBe(false);
  });
});

describe("leaderboardQuerySchema: 쿼리 문자열 극단", () => {
  it.each(["10.0", " 10", "1e1", "0", "-10", ""])("limit=%j는 거부 (정확히 10 또는 50만)", (limit) => {
    expect(ok(leaderboardQuerySchema, { limit })).toBe(false);
  });

  it("모르는 쿼리 파라미터는 무시한다", () => {
    expect(leaderboardQuerySchema.parse({ foo: "bar", highlight: "3" })).toEqual({
      mode: "ALL",
      category: undefined,
      limit: 10,
    });
  });
});

describe("sessionIdSchema", () => {
  it("대문자 UUID도 받는다 (Postgres uuid 비교는 대소문자를 구분하지 않음)", () => {
    expect(ok(sessionIdSchema, "BA8E1016-FB65-4E39-B601-A48BCAB35AA3")).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "{ba8e1016-fb65-4e39-b601-a48bcab35aa3}",
    "ba8e1016fb654e39b601a48bcab35aa3",
    "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz",
    "ba8e1016-fb65-4e39-b601-a48bcab35aa3 ",
  ])("형식이 다른 %j는 거부", (id) => {
    expect(ok(sessionIdSchema, id)).toBe(false);
  });
});

describe("scoring: 반올림·0 경계", () => {
  it("정답률은 소수점 첫째 자리로 반올림한다", () => {
    expect(calculateAccuracy(2, 3)).toBe(66.7);
    expect(calculateAccuracy(1, 7)).toBe(14.3);
    expect(calculateAccuracy(40, 40)).toBe(100);
  });

  it("0문제·0정답은 0점·0%", () => {
    expect(calculateScore(0)).toBe(0);
    expect(calculateMaxScore(0)).toBe(0);
    expect(calculateAccuracy(0, 0)).toBe(0);
    expect(calculateAccuracy(0, 10)).toBe(0);
  });
});

describe("shuffle: 경계와 균등성", () => {
  it("빈 배열과 원소 하나짜리 배열", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["only"])).toEqual(["only"]);
  });

  it("중복 원소도 개수 그대로 유지한다", () => {
    expect([...shuffle([1, 1, 2, 2, 2])].sort()).toEqual([1, 1, 2, 2, 2]);
  });

  it("random()이 1에 매우 가까워도 배열 밖을 가리키지 않는다", () => {
    const result = shuffle([1, 2, 3, 4, 5], () => 1 - Number.EPSILON);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(result).not.toContain(undefined);
  });

  it("치우치지 않는다: [0,1,2]의 6가지 순열이 고르게 나온다", () => {
    const runs = 30_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const key = shuffle([0, 1, 2]).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // 기대값 5,000회에서 ±10% (표준편차 약 65회 → 약 7.7σ, 우연히 실패할 확률은 사실상 0)
    for (const n of counts.values()) expect(Math.abs(n - runs / 6)).toBeLessThan(runs / 6 / 10);
  });
});

describe("결과 집계: 빈 입력·중복", () => {
  it("문제도 답안도 없으면 모두 0이고 카테고리 목록은 비어 있다", () => {
    expect(buildResultSummary([], [])).toEqual({
      score: 0,
      maxScore: 0,
      correctCount: 0,
      answeredCount: 0,
      totalCount: 0,
      accuracy: 0,
      byCategory: [],
    });
  });

  it("같은 문제의 정답 기록이 중복돼도 한 번만 센다", () => {
    const summary = buildResultSummary(
      [{ id: 1, categoryName: "과학", categorySortOrder: 1 }],
      [
        { questionId: 1, isCorrect: true },
        { questionId: 1, isCorrect: true },
      ],
    );
    expect(summary).toMatchObject({ correctCount: 1, score: 10, totalCount: 1, accuracy: 100 });
  });

  it("출제 목록이 비면 문제 정보도 비고, 목록에 없는 행은 무시한다", () => {
    expect(sessionQuestionInfos([], [{ id: 1, category: { name: "과학", sortOrder: 1 } }])).toEqual([]);
  });
});

describe("오류 판별 함수에 null·이상한 값", () => {
  it.each([null, undefined, "NOT_FOUND", { code: "NOT_FOUND" }, new Error("NOT_FOUND")])(
    "isNotFoundError(%j)는 false",
    (value) => {
      expect(isNotFoundError(value)).toBe(false);
    },
  );

  it("다른 코드의 AppError는 NOT_FOUND가 아니다", () => {
    expect(isNotFoundError(new AppError("CONFLICT", "x"))).toBe(false);
    expect(isNotFoundError(new AppError("NOT_FOUND", "x"))).toBe(true);
  });

  it.each([null, undefined, { code: "P2002" }, { code: "P1001" }, new Error("P2002")])(
    "Prisma 오류 인스턴스가 아닌 %j는 고유 제약 위반·일시 장애로 보지 않는다",
    (value) => {
      expect(isUniqueViolation(value)).toBe(false);
      expect(isTransientDatabaseError(value)).toBe(false);
    },
  );

  it("Prisma의 알 수 없는 요청 오류는 일시 장애로 보지 않는다 (500으로 기록)", () => {
    const unknown = new Prisma.PrismaClientUnknownRequestError("weird", { clientVersion: "6.19.3" });
    expect(isTransientDatabaseError(unknown)).toBe(false);
  });
});

describe("withTimeout 경계", () => {
  it("이미 끝난 promise는 제한 시간 0이어도 결과를 돌려준다", async () => {
    await expect(withTimeout(Promise.resolve("done"), 0)).resolves.toBe("done");
  });

  it("기본 메시지에 제한 시간을 담는다", async () => {
    const pending = withTimeout(new Promise(() => {}), 5);
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await expect(pending).rejects.toThrow("5ms");
  });
});

describe("page-helpers 경계", () => {
  it("빈 배열·빈 객체", () => {
    expect(firstParam([])).toBeUndefined();
    expect(flattenSearchParams({})).toEqual({});
  });
});

describe("client-ip: 헤더·환경 변수 극단", () => {
  const xff = (value: string) => new Headers({ "x-forwarded-for": value });

  it.each(["abc", "-1", "1.5", ""])("TRUSTED_PROXY_HOPS=%j처럼 잘못된 값은 0으로 본다 (마지막 값 사용)", (hops) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", hops);
    expect(clientKey(xff("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("TRUSTED_PROXY_HOPS=2면 오른쪽에서 두 번째 값을 쓴다", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientKey(xff("6.6.6.6, 203.0.113.7, 10.0.0.4"))).toBe("203.0.113.7");
  });

  it("빈 항목과 공백은 무시한다", () => {
    expect(clientKey(xff(" , ,203.0.113.7 , "), 1)).toBe("203.0.113.7");
    expect(clientKey(xff(" , , "), 1)).toBe("unknown");
  });

  it('프록시가 넣는 "unknown" 문자열은 식별 불가로 처리한다', () => {
    expect(clientKey(xff("unknown"), 1)).toBe("unknown");
  });

  it("IPv6 대문자·zone id·IPv4 경계 주소", () => {
    expect(normalizeIp("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeIp("0.0.0.0")).toBe("0.0.0.0");
    expect(normalizeIp("255.255.255.255")).toBe("255.255.255.255");
    expect(normalizeIp("256.0.0.1")).toBeNull();
    expect(normalizeIp("[::ffff:203.0.113.7]:443")).toBe("203.0.113.7");
  });
});
