import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { firstParam, flattenSearchParams, orNotFound } from "@/lib/page-helpers";

describe("searchParams 도우미", () => {
  it("같은 키가 여러 번 오면 첫 값만 쓴다", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("a")).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
    expect(flattenSearchParams({ mode: ["ALL", "CATEGORY"], limit: "50", x: undefined })).toEqual({
      mode: "ALL",
      limit: "50",
      x: undefined,
    });
  });
});

describe("orNotFound", () => {
  it("성공하면 결과를 그대로 돌려준다", async () => {
    await expect(orNotFound(Promise.resolve(42))).resolves.toBe(42);
  });

  it("도메인 NOT_FOUND는 Next.js 404로 바꾼다", async () => {
    // notFound()는 Next.js가 404 페이지로 처리하는 특수 오류를 던진다.
    const error = await orNotFound(Promise.reject(new AppError("NOT_FOUND", "없음"))).catch((e: Error) => e);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as { digest?: string }).digest).toMatch(/404|NOT_FOUND/);
  });

  it("그 밖의 오류는 그대로 다시 던져 error.tsx가 처리하게 한다", async () => {
    const original = new AppError("CONFLICT", "충돌");
    await expect(orNotFound(Promise.reject(original))).rejects.toBe(original);
  });
});
