import { describe, expect, it } from "vitest";
import {
  createSessionSchema,
  leaderboardQuerySchema,
  questionRefSchema,
  submitAnswerSchema,
  submitScoreSchema,
} from "@/lib/validation";

describe("createSessionSchema", () => {
  it("ALL 모드는 categorySlug 없이 통과한다", () => {
    expect(createSessionSchema.parse({ mode: "ALL" })).toEqual({ mode: "ALL" });
  });

  it("CATEGORY 모드는 categorySlug가 필요하다", () => {
    expect(createSessionSchema.safeParse({ mode: "CATEGORY" }).success).toBe(false);
    expect(createSessionSchema.parse({ mode: "CATEGORY", categorySlug: "science" })).toEqual({
      mode: "CATEGORY",
      categorySlug: "science",
    });
  });

  it("SPEED 모드는 categorySlug 없이 통과한다", () => {
    expect(createSessionSchema.parse({ mode: "SPEED", categorySlug: "science" })).toEqual({ mode: "SPEED" });
  });

  it("알 수 없는 mode는 거부한다", () => {
    expect(createSessionSchema.safeParse({ mode: "RANDOM" }).success).toBe(false);
  });
});

describe("questionRefSchema (문제 열기·힌트)", () => {
  it("양의 정수 questionId만 통과한다", () => {
    expect(questionRefSchema.parse({ questionId: 3 })).toEqual({ questionId: 3 });
    for (const questionId of [0, -1, 1.5, "3", null, undefined, Number.NaN]) {
      expect(questionRefSchema.safeParse({ questionId }).success).toBe(false);
    }
  });
});

describe("submitAnswerSchema", () => {
  it.each([-1, 4, 1.5, "1"])("selectedIndex=%s는 거부한다", (selectedIndex) => {
    expect(submitAnswerSchema.safeParse({ questionId: 1, selectedIndex }).success).toBe(false);
  });

  it("0~3 범위의 정수는 통과한다", () => {
    expect(submitAnswerSchema.safeParse({ questionId: 1, selectedIndex: 3 }).success).toBe(true);
  });
});

describe("submitScoreSchema (닉네임)", () => {
  it("앞뒤 공백을 제거한다", () => {
    expect(submitScoreSchema.parse({ username: "  홍길동  " })).toEqual({ username: "홍길동" });
  });

  it.each(["가", " a ", "가나다라마바사아자차카타파"])("길이 제한(2~12자) 밖인 %j는 거부한다", (username) => {
    expect(submitScoreSchema.safeParse({ username }).success).toBe(false);
  });

  it("한글 12자와 이모지는 UTF-16 길이가 아닌 문자 수로 센다", () => {
    expect(submitScoreSchema.safeParse({ username: "가나다라마바사아자차카타" }).success).toBe(true);
    expect(submitScoreSchema.safeParse({ username: "😀".repeat(12) }).success).toBe(true);
  });

  it("제어 문자는 거부한다", () => {
    expect(submitScoreSchema.safeParse({ username: "ab\u0007cd" }).success).toBe(false);
  });

  it.each([
    ["방향 전환(RLO, U+202E)", "ad‮min"],
    ["폭 없는 공백(ZWSP, U+200B)", "관리​자"],
    ["글자 사이의 BOM(U+FEFF)", "관리﻿자"],
    ["글자 사이의 ZWJ(U+200D)", "관‍리자"],
    ["한글 채움 문자(U+3164)만으로 된 빈 닉네임", "ㅤㅤㅤ"],
    ["끝에 붙인 한글 채움 문자(U+3164)", "관리자ㅤ"],
    ["반각 한글 채움 문자(U+FFA0)", "관리ﾠ자"],
    ["초성·중성 채움 문자(U+115F, U+1160)", "ᅟᅠ"],
    ["점자 빈칸(U+2800)", "⠀⠀"],
  ])("사칭·빈 닉네임에 쓰이는 %s는 거부한다", (_label, username) => {
    const result = submitScoreSchema.safeParse({ username });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("보이지 않는 문자");
  });

  it.each([
    ["가족 이모지(ZWJ 결합)", "👨‍👩‍👧 가족"],
    ["변형 선택자 뒤의 ZWJ 결합 이모지", "❤️‍🔥불꽃"],
    ["가운데 공백", "퀴즈 왕"],
  ])("정상 닉네임 %s는 허용한다", (_label, username) => {
    expect(submitScoreSchema.safeParse({ username }).success).toBe(true);
  });

  it("앞뒤의 BOM(U+FEFF)은 공백처럼 잘라 내므로 보이지 않는 문자가 저장되지 않는다", () => {
    expect(submitScoreSchema.parse({ username: "﻿관리자﻿" })).toEqual({ username: "관리자" });
  });

  it("NFC로 정규화한다: 자모 분해형 한글은 완성형으로 저장되고 글자 수도 완성형 기준으로 센다", () => {
    const decomposed = "가나다라마바사아자차카타".normalize("NFD"); // 12글자 → 분해하면 24 code point
    expect(Array.from(decomposed)).toHaveLength(24);
    expect(submitScoreSchema.parse({ username: decomposed })).toEqual({
      username: "가나다라마바사아자차카타",
    });
  });
});

describe("leaderboardQuerySchema", () => {
  it("기본값은 ALL 모드, 전체 기간, limit 10이다", () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ mode: "ALL", category: undefined, period: "all", limit: 10 });
  });

  it("period는 all·weekly·daily만 허용한다 (대소문자 구분, 빈 값 거부)", () => {
    expect(leaderboardQuerySchema.parse({ period: "weekly" }).period).toBe("weekly");
    expect(leaderboardQuerySchema.parse({ period: "daily" }).period).toBe("daily");
    for (const period of ["monthly", "WEEKLY", "", " daily", "constructor", "__proto__"]) {
      expect(leaderboardQuerySchema.safeParse({ period }).success).toBe(false);
    }
  });

  it("limit은 10 또는 50만 허용한다", () => {
    expect(leaderboardQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(leaderboardQuerySchema.safeParse({ limit: "20" }).success).toBe(false);
  });

  it("CATEGORY 모드에는 category가 필요하다", () => {
    expect(leaderboardQuerySchema.safeParse({ mode: "CATEGORY" }).success).toBe(false);
    expect(leaderboardQuerySchema.parse({ mode: "CATEGORY", category: "science" }).category).toBe(
      "science",
    );
  });

  it("ALL·SPEED 모드에서는 category를 무시한다", () => {
    expect(leaderboardQuerySchema.parse({ mode: "ALL", category: "science" }).category).toBeUndefined();
    expect(leaderboardQuerySchema.parse({ mode: "SPEED", category: "science" })).toEqual({
      mode: "SPEED",
      category: undefined,
      period: "all",
      limit: 10,
    });
  });
});
