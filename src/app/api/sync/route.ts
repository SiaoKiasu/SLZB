import { authorize, checkOrigin } from "@/lib/auth";
import { dashboard } from "@/lib/service";
import { json, failure } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    authorize(request);
    checkOrigin(request);
    return json(await dashboard(true));
  } catch (e) {
    return failure(e);
  }
}
