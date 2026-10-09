import { describe, expect, it } from "vitest";
import { BinanceClient } from "@/lib/binance";
import { tradeRealizedPnl } from "@/lib/trade-pnl";
import type { TradeLedger } from "@/lib/types";
const config = { BINANCE_ENV: "testnet" as const, BINANCE_API_KEY: "k", BINANCE_API_SECRET: "s" };
describe("automatic trade discovery", () => {
  it.each(["1", "0"])(
    "refreshes an existing BTC market before undiscovered quote pairs, even with %s BTC left",
    async (remaining) => {
      const previous: TradeLedger = { version: 1, markets: {} };
      for (let i = 0; i < 80; i++)
        previous.markets[`BTCQUOTE${i}`] = {
          baseAsset: "BTC",
          quoteAsset: `QUOTE${i}`,
          nextId: "0",
          complete: false,
          checkedAt: 0,
          trades: [],
        };
      previous.markets.BTCUSDT = {
        baseAsset: "BTC",
        quoteAsset: "USDT",
        nextId: "2",
        complete: true,
        checkedAt: 1,
        trades: [
          {
            id: "1",
            symbol: "BTCUSDT",
            side: "BUY",
            price: "100",
            quantity: "2",
            quoteQuantity: "200",
            fee: "2",
            feeAsset: "USDT",
            time: 1,
            isMaker: false,
          },
        ],
      };
      const queries: string[] = [];
      const transport: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("time")) return Response.json({ serverTime: Date.now() });
        if (url.pathname.endsWith("account"))
          return Response.json({ balances: [{ asset: "BTC", free: remaining, locked: "0" }] });
        if (url.pathname.endsWith("exchangeInfo"))
          return Response.json({
            symbols: Object.entries(previous.markets).map(([symbol, m]) => ({
              symbol,
              baseAsset: m.baseAsset,
              quoteAsset: m.quoteAsset,
            })),
          });
        if (!url.pathname.endsWith("myTrades")) return Response.json([]);
        const symbol = url.searchParams.get("symbol")!;
        queries.push(symbol);
        if (symbol !== "BTCUSDT") return Response.json([]);
        expect(url.searchParams.get("fromId")).toBe("2");
        return Response.json([
          {
            id: 2,
            symbol,
            price: "150",
            qty: "1",
            quoteQty: "150",
            commission: "1",
            commissionAsset: "USDT",
            time: 2,
            isBuyer: false,
            isMaker: false,
          },
        ]);
      };
      const result = await new BinanceClient(config, transport).load([], previous);
      expect(queries[0]).toBe("BTCUSDT");
      expect(queries).toHaveLength(24);
      expect(result.trades[0]).toMatchObject({ id: "2", side: "SELL" });
      expect(result.ledger!.markets.BTCUSDT.nextId).toBe("3");
      expect(previous.markets.BTCUSDT.trades).toHaveLength(1);
      expect(result.historySync).toMatchObject({ scanned: 24, total: 81 });
      expect(tradeRealizedPnl(result.ledger, result.tradesComplete)).toMatchObject({
        realizedPnl: "47",
        feePnl: "-3",
        complete: false,
      });
    },
  );
  it("discovers held USDT markets first on a cold start without starving other markets", async () => {
    const markets = [
      ...Array.from({ length: 40 }, (_, i) => ({
        symbol: `BTCQUOTE${i}`,
        baseAsset: "BTC",
        quoteAsset: `QUOTE${i}`,
      })),
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
    ];
    const queries: string[] = [];
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("time")) return Response.json({ serverTime: Date.now() });
      if (url.pathname.endsWith("account"))
        return Response.json({ balances: [{ asset: "BTC", free: "1", locked: "0" }] });
      if (url.pathname.endsWith("exchangeInfo")) return Response.json({ symbols: markets });
      if (url.pathname.endsWith("myTrades")) queries.push(url.searchParams.get("symbol")!);
      return Response.json([]);
    };
    const result = await new BinanceClient(config, transport).load();
    expect(queries[0]).toBe("BTCUSDT");
    expect(queries).toHaveLength(24);
    expect(result.historySync).toMatchObject({ scanned: 24, total: 41 });
  });
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
