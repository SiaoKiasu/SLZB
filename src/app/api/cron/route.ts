import { constantEqual } from "@/lib/auth";
import { getAppConfig, getAccountConfig } from "@/lib/config";
import { BinanceClient } from "@/lib/binance";
import { valueHoldings, resolveEquity } from "@/lib/portfolio";
import { saveSnapshot } from "@/lib/storage";
import { json, failure } from "@/lib/http";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const app = getAppConfig();
    if (
      !app.cronSecret ||
      !constantEqual(request.headers.get("authorization") ?? "", `Bearer ${app.cronSecret}`)
    )
      throw new AppError("UNAUTHORIZED", "定时任务未授权。", 401);
    if (!app.databaseUrl)
      throw new AppError("STORAGE_REQUIRED", "后台快照需要 DATABASE_URL。", 503);
    const requested = new URL(request.url).searchParams.get("accountId");
    const accounts = app.accounts.filter(
      (a) => a.enabled && a.source === "binance" && (!requested || a.id === requested),
    );
    if (!accounts.length) throw new AppError("NOT_FOUND", "没有匹配的可采集账户。", 404);
    const results: { accountId: string; saved: boolean }[] = [];
    // One shared deadline keeps multi-account cron work bounded on Vercel.
    const deadline = Date.now() + 45000;
    for (let i = 0; i < accounts.length; i += 2) {
      await Promise.all(
        accounts.slice(i, i + 2).map(async (account) => {
          try {
            if (Date.now() >= deadline) throw new Error("budget exceeded");
            const c = getAccountConfig(app, account.id);
            const raw = await new BinanceClient(c, fetch, deadline).loadBalances();
            const holdings = valueHoldings(raw.balances, raw.tickers, c.costs);
            const { equity, equityComplete } = resolveEquity(holdings, raw.spotEquity);
            if (!equityComplete) throw new Error("incomplete valuation");
            await saveSnapshot(c, { time: Date.now(), equity });
            results.push({ accountId: account.id, saved: true });
          } catch {
            results.push({ accountId: account.id, saved: false });
          }
        }),
      );
    }
    return json(
      { ok: results.every((r) => r.saved), results },
      results.every((r) => r.saved) ? 200 : 503,
    );
  } catch (e) {
    return failure(e);
  }
}
