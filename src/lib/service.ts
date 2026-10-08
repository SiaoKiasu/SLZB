import "server-only";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import type { Config } from "./config";
import { BinanceClient } from "./binance";
import { demoCosts, demoData, demoHistory } from "./demo";
import { STABLECOINS, totalPnl, valueHoldings } from "./portfolio";
import { readHistory, saveSnapshot } from "./storage";
import type { Dashboard, ProviderData } from "./types";
type Cached = { data: ProviderData; time: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<Cached>>();
async function provider(c: Config): Promise<Cached> {
  if (c.DATA_SOURCE === "demo") return { data: demoData(), time: Date.now() };
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        c.ACCOUNT_ID,
        c.BINANCE_API_KEY,
        c.BINANCE_API_SECRET,
        c.BINANCE_ENV,
        c.symbols,
      ]),
    )
    .digest("hex");
  for (const [k, value] of cache) if (Date.now() - value.time >= 30000) cache.delete(k);
  const current = cache.get(key);
  if (current) return current;
  let request = pending.get(key);
  if (!request) {
    request = new BinanceClient(c)
      .load(c.symbols)
      .then((data) => {
        const result = { data, time: Date.now() };
        cache.set(key, result);
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}
export async function dashboard(c: Config, persist = false): Promise<Dashboard> {
  const { data, time } = await provider(c);
  const demo = c.DATA_SOURCE === "demo";
  const holdings = valueHoldings(data.balances, data.tickers, demo ? demoCosts : c.costs);
  const sum = (values: (string | null)[]) =>
    values.reduce<Decimal>((a, v) => a.plus(v ?? 0), new Decimal(0)).toString();
  const equity = sum(holdings.map((h) => h.value));
  const unpriced = holdings.filter((h) => h.value === null).length;
  const baseline = demo ? "100000" : c.PERFORMANCE_BASELINE_USDT;
  const netFlows = demo ? "0" : c.PERFORMANCE_NET_FLOWS_USDT;
  const costed = holdings.filter((h) => h.unrealizedPnl !== null);
  const warnings = [...data.warnings];
  let history = demo ? demoHistory(equity) : [];
  let saved = false;
  if (!demo && c.DATABASE_URL) {
    try {
      // Do not record misleading total equity when even one held asset is unpriced.
      if (persist && unpriced === 0) {
        await saveSnapshot(c, { time, equity });
        saved = true;
      }
      history = await readHistory(c);
    } catch {
      warnings.push("历史净值暂时不可用；实时账户数据仍可查看，请联系管理员。");
    }
  }
  if (!demo && !c.DATABASE_URL) warnings.push("历史净值尚未启用，实时账户数据可正常查看。");
  if (unpriced)
    warnings.push(`${unpriced} 种资产缺少可用行情，当前总额仅为已估值资产小计，累计盈亏暂停计算。`);
  if (!demo && baseline === undefined) warnings.push("累计盈亏口径尚未设定，请联系管理员。");
  if (!demo && costed.length) warnings.push("持仓浮盈亏采用管理员维护的成本口径。");
  return {
    source: c.DATA_SOURCE,
    accountLabel: c.ACCOUNT_LABEL,
    environment: demo
      ? "演示账户"
      : c.BINANCE_ENV === "testnet"
        ? "Binance Spot Testnet"
        : "Binance Spot",
    updatedAt: time,
    holdings,
    trades: data.trades,
    orders: data.orders,
    history,
    summary: {
      equity,
      pricedAssets: holdings.length - unpriced,
      unpricedAssets: unpriced,
      unrealizedPnl: costed.length ? sum(costed.map((h) => h.unrealizedPnl)) : null,
      costCoverage: costed.length,
      totalPnl: totalPnl(equity, baseline, netFlows, unpriced),
      baseline: baseline ?? null,
      baselineAt: demo
        ? new Date(Date.now() - 7 * 86400000).toISOString()
        : (c.PERFORMANCE_BASELINE_AT ?? null),
      netFlows: netFlows ?? null,
      stablecoinValue: sum(holdings.filter((h) => STABLECOINS.has(h.asset)).map((h) => h.value)),
      tradeCount: data.trades.length,
    },
    connection: {
      database: Boolean(c.DATABASE_URL),
      snapshotsSaved: saved,
      symbols: c.symbols,
      tradesComplete: data.tradesComplete,
      ordersComplete: data.ordersComplete,
    },
    warnings,
  };
}
