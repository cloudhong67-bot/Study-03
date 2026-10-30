import { handle, parseJson, readSessionId, type SessionRouteContext, WithStatus } from "@/lib/api";
import { submitScore } from "@/lib/quiz/scores";
import { enforceRateLimit } from "@/lib/rate-limit";
import { submitScoreSchema } from "@/lib/validation";

export async function POST(request: Request, context: SessionRouteContext) {
  return handle(async () => {
    await enforceRateLimit(request, "submitScore");
    const { result, replayed } = await submitScore(
      await readSessionId(context),
      await parseJson(request, submitScoreSchema),
    );
    // 처음 등록은 201, 같은 요청의 재전송(응답 유실 후 재시도)은 처음 결과를 200으로 돌려준다.
    return new WithStatus(result, replayed ? 200 : 201);
  });
}
