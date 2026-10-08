import type { ProviderData, Snapshot } from "./types";
export const demoCosts = { BTC: "58900", ETH: "2380", SOL: "136", BNB: "545" };
export function demoData(): ProviderData {
  const now = Date.now();
  return {
    balances: [
      { asset: "BTC", free: "0.82", locked: "0.03" },
      { asset: "ETH", free: "8.4", locked: "0" },
      { asset: "USDT", free: "16320.5", locked: "2400" },
      { asset: "SOL", free: "86", locked: "0" },
      { asset: "BNB", free: "5.2", locked: "0" },
    ],
    tickers: [
      { symbol: "BTCUSDT", lastPrice: "67432.8", priceChangePercent: "2.34" },
      { symbol: "ETHUSDT", lastPrice: "2618.45", priceChangePercent: "1.82" },
      { symbol: "SOLUSDT", lastPrice: "154.72", priceChangePercent: "-0.76" },
      { symbol: "BNBUSDT", lastPrice: "596.4", priceChangePercent: "0.92" },
    ],
    trades: Array.from({ length: 36 }, (_, i) => {
      const assets = ["BTC", "ETH", "SOL", "BNB"];
      const asset = assets[i % 4];
      const price = [66820, 2592.6, 155.8, 589.2][i % 4];
      const quantity = [0.015, 0.5, 8, 0.6][i % 4];
      return {
        id: String(100000 + i),
        symbol: `${asset}USDT`,
        side: i % 3 === 2 ? "SELL" : "BUY",
        price: String(price),
        quantity: String(quantity),
        quoteQuantity: String(price * quantity),
        fee: String(price * quantity * 0.001),
        feeAsset: "USDT",
        time: now - (i * 172 + 8) * 60000,
        isMaker: i % 2 === 0,
      };
    }),
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
