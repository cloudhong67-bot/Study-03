import { describe, expect, it } from "vitest";
import { categoryIcon } from "@/components/category-icon";
import { leaderboardHref, quizHref } from "@/lib/routes";

describe("quizHref", () => {
  it.each([null, undefined, ""])("slug가 %j이면 전체 모드", (slug) => {
    expect(quizHref({ categorySlug: slug })).toBe("/quiz?mode=all");
    expect(quizHref()).toBe("/quiz?mode=all");
  });

  it("SPEED 모드는 스피드 퀴즈, slug가 있으면 mode와 상관없이 카테고리", () => {
    expect(quizHref({ mode: "SPEED" })).toBe("/quiz?mode=speed");
    expect(quizHref({ mode: "SPEED", categorySlug: "science" })).toBe("/quiz?category=science");
  });

  it("slug의 특수문자는 URL 인코딩한다 (쿼리 주입 방지)", () => {
    expect(quizHref({ categorySlug: "a b&mode=all" })).toBe("/quiz?category=a%20b%26mode%3Dall");
    expect(quizHref({ categorySlug: "한국사" })).toBe(`/quiz?category=${encodeURIComponent("한국사")}`);
  });
});

describe("leaderboardHref", () => {
  it("옵션이 없으면 기본 순위표", () => {
    expect(leaderboardHref()).toBe("/leaderboard");
    expect(leaderboardHref({ categorySlug: null, limit: 10 })).toBe("/leaderboard");
  });

  it("카테고리·Top 50·강조 순위를 쿼리로 붙인다 (기본값 limit=10은 생략)", () => {
    expect(leaderboardHref({ categorySlug: "science", limit: 50, highlight: 3 })).toBe(
      "/leaderboard?mode=CATEGORY&category=science&limit=50&highlight=3",
    );
  });

  it("스피드 순위표는 mode=SPEED (ALL은 기본이라 생략)", () => {
    expect(leaderboardHref({ mode: "SPEED", highlight: 2 })).toBe("/leaderboard?mode=SPEED&highlight=2");
    expect(leaderboardHref({ mode: "ALL" })).toBe("/leaderboard");
  });

  it("강조 순위 0은 의미가 없으므로 붙이지 않는다", () => {
    expect(leaderboardHref({ highlight: 0 })).toBe("/leaderboard");
  });

  it("특수문자 slug는 인코딩된다", () => {
    expect(leaderboardHref({ categorySlug: "a&b" })).toBe("/leaderboard?mode=CATEGORY&category=a%26b");
  });
});

describe("categoryIcon", () => {
  it("알려진 slug는 고유 아이콘, 모르는 slug와 빈 문자열은 기본 아이콘", () => {
    expect(categoryIcon("science")).toBe("🔬");
    expect(categoryIcon("music")).toBe("📘");
    expect(categoryIcon("")).toBe("📘");
  });

  // 회귀 테스트: 일반 객체 조회일 때는 Object.prototype의 값(객체·함수)이 반환되어 화면이 깨졌다.
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "객체 내장 속성 이름 %j도 문자열 기본 아이콘을 돌려준다",
    (slug) => {
      expect(categoryIcon(slug)).toBe("📘");
    },
  );
});
