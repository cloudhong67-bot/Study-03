import { handle, readSessionId, type SessionRouteContext } from "@/lib/api";
import { getResult } from "@/lib/quiz/sessions";

export async function GET(_request: Request, context: SessionRouteContext) {
  return handle(async () => getResult(await readSessionId(context)));
}
