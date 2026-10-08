import { authorizeAdmin, authenticatedJson, checkOrigin } from "@/lib/auth";
import { readCosts, writeCosts } from "@/lib/cost-store";
import { costWriteSchema } from "@/lib/cost-schema";
import { failure } from "@/lib/http";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = authorizeAdmin(request);
    return authenticatedJson(
      {
        ...(await readCosts(auth.config)),
        writable: !process.env.VERCEL || Boolean(auth.config.DATABASE_URL),
      },
      auth,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    const auth = authorizeAdmin(request);
    checkOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 50000)
      throw new AppError("INVALID_BODY", "成本配置过大。", 400);
    const raw = await request.text();
    if (raw.length > 50000) throw new AppError("INVALID_BODY", "成本配置过大。", 400);
    let body;
    try {
      body = costWriteSchema.parse(JSON.parse(raw));
    } catch {
      throw new AppError(
        "INVALID_BODY",
        "请填写有效的币种与非负单位成本，最多 20 位整数、16 位小数。USDT 固定为 1。",
        400,
      );
    }
    return authenticatedJson(
      await writeCosts(auth.config, body.costs, body.revision, auth.user.username),
      auth,
    );
  } catch (e) {
    return failure(e);
  }
}
