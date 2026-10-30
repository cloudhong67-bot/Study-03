import { handle, parseJson, readSessionId, type SessionRouteContext } from "@/lib/api";
import { openQuestion } from "@/lib/quiz/sessions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { questionRefSchema } from "@/lib/validation";

export async function POST(request: Request, context: SessionRouteContext) {
  return handle(async () => {
    await enforceRateLimit(request, "openQuestion");
    return openQuestion(await readSessionId(context), await parseJson(request, questionRefSchema));
  });
}
