import { handle, parseJson, readSessionId, type SessionRouteContext } from "@/lib/api";
import { submitAnswer } from "@/lib/quiz/sessions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { submitAnswerSchema } from "@/lib/validation";

export async function POST(request: Request, context: SessionRouteContext) {
  return handle(async () => {
    await enforceRateLimit(request, "answer");
    return submitAnswer(await readSessionId(context), await parseJson(request, submitAnswerSchema));
  });
}
