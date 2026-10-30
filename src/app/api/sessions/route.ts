import { handle, parseJson } from "@/lib/api";
import { maybeRunMaintenance } from "@/lib/maintenance";
import { createSession } from "@/lib/quiz/sessions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSessionSchema } from "@/lib/validation";

export async function POST(request: Request) {
  return handle(async () => {
    await enforceRateLimit(request, "createSession");
    await maybeRunMaintenance();
    return createSession(await parseJson(request, createSessionSchema));
  }, 201);
}
