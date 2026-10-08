import { describe, expect, it } from "vitest";
import { BinanceClient } from "@/lib/binance";
const config = { BINANCE_ENV: "testnet" as const, BINANCE_API_KEY: "k", BINANCE_API_SECRET: "s" };
describe("automatic trade discovery", () => {
  it("discovers held and fully closed pairs without a user watchlist and resumes pagination", async () => {
    const queries: string[] = [];
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("time")) return Response.json({ serverTime: Date.now() });
      if (url.pathname.endsWith("account"))
        return Response.json({ balances: [{ asset: "ETH", free: "1", locked: "0" }] });
      if (url.pathname.endsWith("24hr") || url.pathname.endsWith("openOrders"))
        return Response.json([]);
      if (url.pathname.endsWith("exchangeInfo"))
        return Response.json({
          symbols: [
            { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
            { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
          ],
        });
      const symbol = url.searchParams.get("symbol")!;
      const from = url.searchParams.get("fromId");
      queries.push(`${symbol}:${from}`);
      if (symbol === "ETHUSDT" && from === "0")
        return Response.json(
          Array.from({ length: 1000 }, (_, i) => ({
            id: i + 1,
            symbol,
            price: "1",
            qty: "0.001",
            quoteQty: "0.001",
            commission: "0",
            commissionAsset: "USDT",
            time: i,
            isBuyer: true,
            isMaker: false,
          })),
        );
      return Response.json([]);
    };
    const first = await new BinanceClient(config, transport).load();
    expect(queries).toEqual(["ETHUSDT:0", "BTCUSDT:0"]);
    expect(first.tradesComplete).toBe(false);
    expect(first.historySync).toMatchObject({ scanned: 1, total: 2 });
    const second = await new BinanceClient(config, transport).load([], first.ledger);
    expect(queries).toContain("ETHUSDT:1001");
    expect(second.tradesComplete).toBe(true);
    expect(second.trades).toHaveLength(1000);
    expect(second.historySync).toMatchObject({ scanned: 2, total: 2 });
  });
  it("stops the scan immediately when Binance rate limits it", async () => {
    let tradeCalls = 0;
    const client = new BinanceClient(config, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("time")) return Response.json({ serverTime: Date.now() });
      if (path.endsWith("account")) return Response.json({ balances: [] });
      if (path.endsWith("exchangeInfo"))
        return Response.json({
          symbols: ["BTC", "ETH", "SOL"].map((a) => ({
            symbol: `${a}USDT`,
            baseAsset: a,
            quoteAsset: "USDT",
          })),
        });
      if (path.endsWith("myTrades")) {
        tradeCalls++;
        return Response.json({}, { status: 429 });
      }
      return Response.json([]);
    });
    const data = await client.load();
    expect(tradeCalls).toBe(1);
    expect(data.tradesComplete).toBe(false);
  });
});
