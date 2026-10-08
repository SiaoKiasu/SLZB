import { constantEqual } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { dashboard } from "@/lib/service";
import { json, failure } from "@/lib/http";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const c = getConfig();
    if (
      !c.CRON_SECRET ||
      !constantEqual(request.headers.get("authorization") ?? "", `Bearer ${c.CRON_SECRET}`)
    )
      throw new AppError("UNAUTHORIZED", "定时任务未授权。", 401);
    if (c.DATA_SOURCE === "demo" || !c.DATABASE_URL)
      throw new AppError("STORAGE_REQUIRED", "定时快照需要真实账户和 DATABASE_URL。", 503);
    const result = await dashboard(true);
    if (!result.connection.snapshotsSaved)
      throw new AppError("SNAPSHOT_FAILED", "净值快照未保存，请检查数据库及行情覆盖。", 503);
    return json({ ok: true, savedAt: result.updatedAt });
  } catch (e) {
    return failure(e);
  }
}
