import { handle } from "@/lib/api";
import { listCategories } from "@/lib/quiz/categories";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => listCategories());
}
