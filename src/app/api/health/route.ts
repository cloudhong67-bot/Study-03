import { NextResponse } from "next/server";
import { TimeoutError, withTimeout } from "@/lib/async";
import { checkDatabase } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** probe의 제한 시간보다 짧게 둬서, DB가 멈춰도 probe가 503을 확실히 받게 한다. */
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

// ACA liveness/readiness probe용 (PRD 11.2). DB에 연결할 수 없거나 제시간에 답하지 않으면 503.
export async function GET() {
  try {
    await withTimeout(checkDatabase(), HEALTH_CHECK_TIMEOUT_MS);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const timedOut = error instanceof TimeoutError;
    console.error(`health check failed (${timedOut ? "timeout" : "error"})`, timedOut ? "" : error);
    return NextResponse.json(
      { status: "error", database: timedOut ? "timeout" : "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
