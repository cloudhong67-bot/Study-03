// 서버 컴포넌트 페이지 공통 도우미
import { notFound } from "next/navigation";
import { isNotFoundError } from "@/lib/errors";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 같은 키가 여러 번 오면(?a=1&a=2) 첫 값만 쓴다. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function flattenSearchParams(params: Awaited<SearchParams>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, firstParam(value)]));
}

/** 도메인의 NOT_FOUND 오류를 Next.js 404 페이지로 바꾼다. 그 밖의 오류는 error.tsx가 처리한다. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }
}
