import "server-only";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { getConfig } from "./config";
import { BinanceClient } from "./binance";
import { demoCosts, demoData, demoHistory } from "./demo";
import { STABLECOINS, totalPnl, valueHoldings } from "./portfolio";
import { readHistory, saveSnapshot } from "./storage";
import type { Dashboard, ProviderData } from "./types";
let cache: { key: string; at: number; data: ProviderData } | undefined;
let pending: { key: string; promise: Promise<ProviderData> } | undefined;
async function provider() {
  const c = getConfig();
  if (c.DATA_SOURCE === "demo") return { data: demoData(), time: Date.now() };
  const key = createHash("sha256")
    .update(JSON.stringify([c.BINANCE_API_KEY, c.BINANCE_API_SECRET, c.BINANCE_ENV, c.symbols]))
    .digest("hex");
  if (cache?.key === key && Date.now() - cache.at < 30000)
    return { data: cache.data, time: cache.at };
  if (!pending || pending.key !== key) {
    const promise = new BinanceClient(c)
      .load(c.symbols)
      .then((data) => {
        cache = { key, at: Date.now(), data };
        return data;
      })
      .finally(() => {
        if (pending?.key === key) pending = undefined;
      });
    pending = { key, promise };
  }
  const data = await pending.promise;
  return { data, time: cache?.at ?? Date.now() };
}
export async function dashboard(persist = false): Promise<Dashboard> {
  const c = getConfig();
  const { data, time } = await provider();
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
      warnings.push("数据库连接失败，本次净值历史不可用；实时账户数据仍可查看。");
    }
  }
  if (!demo && !c.DATABASE_URL)
    warnings.push("尚未连接数据库：实时数据可用，历史净值不会持久保存。");
  if (unpriced)
    warnings.push(`${unpriced} 种资产缺少可用行情，当前总额仅为已估值资产小计，累计盈亏暂停计算。`);
  if (!demo && baseline === undefined)
    warnings.push("累计盈亏待配置：请设置起始净值、起始时间和期间净入金。");
  if (!demo && costed.length)
    warnings.push("持仓浮盈亏使用手工维护的成本；交易或转账后请同步更新成本配置。");
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
