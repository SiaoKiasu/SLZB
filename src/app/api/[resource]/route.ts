import { authorize } from "@/lib/auth";
import { dashboard } from "@/lib/service";
import { json, failure } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { BinanceClient } from "@/lib/binance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const c = authorize(request);
    const { resource } = await context.params;
    if (
      !["dashboard", "holdings", "pnl", "trades", "orders", "history", "connection"].includes(
        resource,
      )
    )
      throw new AppError("NOT_FOUND", "接口不存在。", 404);
    const url = new URL(request.url);
    if (
      resource === "trades" &&
      !url.searchParams.has("symbol") &&
      (url.searchParams.has("fromId") || url.searchParams.has("limit"))
    )
      throw new AppError("INVALID_QUERY", "分页成交需要同时指定 symbol。", 400);
    if (resource === "trades" && url.searchParams.has("symbol")) {
      const symbol = url.searchParams.get("symbol")!;
      const fromId = url.searchParams.get("fromId") ?? undefined;
      const limit = Number(url.searchParams.get("limit") ?? 100);
      if (
        !c.symbols.includes(symbol) ||
        (fromId && !/^\d{1,16}$/.test(fromId)) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1000
      )
        throw new AppError(
          "INVALID_QUERY",
          "交易对必须在配置列表中，limit 为 1–1000，fromId 为交易 ID。",
          400,
        );
      if (c.DATA_SOURCE === "binance") {
        const client = new BinanceClient(c);
        await client.syncTime();
        const trades = await client.trades(symbol, fromId, limit);
        return json({
          data: trades,
          nextFromId:
            trades.length === limit ? (BigInt(trades[trades.length - 1].id) + 1n).toString() : null,
          coverage: "未传 fromId 时返回最近成交；fromId=0 可从最早可用成交向后分页。",
        });
      }
      const trades = (await dashboard()).trades
        .filter((t) => t.symbol === symbol && (!fromId || BigInt(t.id) >= BigInt(fromId)))
        .sort((a, b) => a.time - b.time)
        .slice(0, limit);
      return json({ data: trades, nextFromId: null, coverage: "模拟成交" });
    }
    const result = await dashboard();
    if (resource === "dashboard") return json(result);
    if (resource === "pnl")
      return json({ data: result.summary, warnings: result.warnings, updatedAt: result.updatedAt });
    if (resource === "connection")
      return json({
        data: { source: result.source, environment: result.environment, ...result.connection },
        warnings: result.warnings,
        updatedAt: result.updatedAt,
      });
    return json({
      data: result[resource as "holdings" | "trades" | "orders" | "history"],
      updatedAt: result.updatedAt,
      warnings: result.warnings,
    });
  } catch (e) {
    return failure(e);
  }
}
