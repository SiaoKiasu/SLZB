import Decimal from "decimal.js";
import type { ProviderData, Snapshot, Trade, TradeLedger } from "./types";
export const demoCosts = { BTC: "58900", ETH: "2380", SOL: "136", BNB: "545" };
export function demoData(): ProviderData {
  const now = Date.now();
  const ledger: TradeLedger = { version: 1, markets: {} };
  // A coherent simulated ledger: closed round trips plus the remaining positions.
  const quantities = { BTC: "0.85", ETH: "8.4", SOL: "86", BNB: "5.2" };
  let id = 100000;
  for (const asset of Object.keys(demoCosts) as (keyof typeof demoCosts)[]) {
    const symbol = `${asset}USDT`;
    const trades: Trade[] = [];
    const add = (side: "BUY" | "SELL", quantity: string, price: string, time: number) => {
      trades.push({
        id: String(id++),
        symbol,
        side,
        quantity,
        price,
        quoteQuantity: new Decimal(quantity).mul(price).toString(),
        fee: "0",
        feeAsset: "USDT",
        time,
        isMaker: true,
      });
    };
    for (let i = 0; i < 4; i++) {
      add("BUY", "1", "100", now - (72 - i * 6) * 3600000);
      add("SELL", "1", "110", now - (70 - i * 6) * 3600000);
    }
    add("BUY", quantities[asset], demoCosts[asset], now - 2 * 3600000);
    ledger.markets[symbol] = {
      baseAsset: asset,
      quoteAsset: "USDT",
      nextId: String(id),
      complete: true,
      checkedAt: now,
      trades,
    };
  }
  return {
    balances: [
      { asset: "BTC", free: "0.82", locked: "0.03" },
      { asset: "ETH", free: "8.4", locked: "0" },
      { asset: "USDT", free: "13173.00", locked: "2400" },
      { asset: "SOL", free: "86", locked: "0" },
      { asset: "BNB", free: "5.2", locked: "0" },
    ],
    tickers: [
      { symbol: "BTCUSDT", lastPrice: "67432.8", priceChangePercent: "2.34" },
      { symbol: "ETHUSDT", lastPrice: "2618.45", priceChangePercent: "1.82" },
      { symbol: "SOLUSDT", lastPrice: "154.72", priceChangePercent: "-0.76" },
      { symbol: "BNBUSDT", lastPrice: "596.4", priceChangePercent: "0.92" },
    ],
    ledger,
    historySync: { scanned: 4, total: 4, oldestCheck: now },
    trades: Object.values(ledger.markets)
      .flatMap((m) => m.trades)
      .sort((a, b) => b.time - a.time),
    orders: [
      {
        id: "20001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "72000",
        quantity: "0.03",
        executedQuantity: "0",
        status: "NEW",
        time: now - 3600000,
      },
      {
        id: "20002",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "2400",
        quantity: "1",
        executedQuantity: "0",
        status: "NEW",
        time: now - 7200000,
      },
    ],
    warnings: ["演示模式：资产、成交、成本和净值曲线均为模拟数据，不连接真实账户。"],
    tradesComplete: true,
    ordersComplete: true,
  };
}
export function demoHistory(equity: string): Snapshot[] {
  const now = Date.now();
  return Array.from({ length: 169 }, (_, i) => ({
    time: now - (168 - i) * 3600000,
    equity: (
      Number(equity) -
      (168 - i) * 51 +
      Math.sin(i * 0.18) * 620 -
      Math.sin(168 * 0.18) * 620
    ).toFixed(2),
  }));
}
