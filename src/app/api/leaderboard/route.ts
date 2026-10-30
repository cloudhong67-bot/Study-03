import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { getLeaderboard } from "@/lib/quiz/scores";
import { leaderboardQuerySchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return handle(async () =>
    getLeaderboard(leaderboardQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))),
  );
}
