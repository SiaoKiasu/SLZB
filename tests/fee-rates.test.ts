import { describe, it, expect, vi } from "vitest";
import { BinanceClient } from "@/lib/binance";
import { feeRateKey } from "@/lib/trade-pnl";
import type { TradeLedger } from "@/lib/types";
const config = { BINANCE_ENV: "testnet" as const, BINANCE_API_KEY: "k", BINANCE_API_SECRET: "s" };
function ledger(count = 1): TradeLedger {
  return {
    version: 1,
    markets: {
      ETHUSDT: {
        baseAsset: "ETH",
        quoteAsset: "USDT",
        nextId: "99",
        complete: true,
        checkedAt: 1,
        trades: Array.from({ length: count }, (_, i) => ({
          id: String(i),
          time: 60000 * (i + 1) + 123,
          symbol: "ETHUSDT",
          side: "BUY",
          price: "100",
          quantity: "1",
          quoteQuantity: "100",
          fee: "0.01",
          feeAsset: "BNB",
          isMaker: false,
        })),
      },
    },
  };
}
describe("historical commission conversion", () => {
  it("uses and persists the exact closed minute, shares rates across fills and avoids refetching", async () => {
    const l = ledger();
    l.markets.ETHUSDT.trades.push({ ...l.markets.ETHUSDT.trades[0], id: "2" });
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v3/klines");
      expect(url.searchParams.get("symbol")).toBe("BNBUSDT");
      expect(url.searchParams.get("interval")).toBe("1m");
      expect(url.searchParams.get("startTime")).toBe("60000");
      expect(url.searchParams.get("endTime")).toBe("119999");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({});
      return Response.json([[60000, "499", "502", "498", "500", "1", 119999]]);
    });
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(l.feeRates?.[feeRateKey("BNB", 60123)].price).toBe("500");
    await new BinanceClient(config, transport).syncFeeRates(structuredClone(l));
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("caps work and progresses across requests", async () => {
    const l = ledger(15);
    const transport = vi.fn(async (input: string | URL | Request) => {
      const time = Number(new URL(String(input)).searchParams.get("startTime"));
      return Response.json([[time, "500", "500", "500", "500", "1", time + 59999]]);
    });
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(transport).toHaveBeenCalledTimes(12);
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(transport).toHaveBeenCalledTimes(15);
  });
  it("rejects another minute, backs off failed quotes and never substitutes today's price", async () => {
    const l = ledger();
    const transport = vi.fn(async () =>
      Response.json([[120000, "500", "500", "500", "500", "1", 179999]]),
    );
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(l.feeRates?.[feeRateKey("BNB", 60123)].price).toBeNull();
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("stops on throttling and skips USDT/base fees and the still-open minute", async () => {
    const l = ledger(3);
    const transport = vi.fn(async () => new Response("", { status: 429 }));
    await new BinanceClient(config, transport).syncFeeRates(l);
    expect(transport).toHaveBeenCalledTimes(1);
    const skipped = ledger(3);
    skipped.markets.ETHUSDT.trades[0].feeAsset = "USDT";
    skipped.markets.ETHUSDT.trades[1].feeAsset = "ETH";
    skipped.markets.ETHUSDT.trades[2].time = Date.now();
    transport.mockClear();
    await new BinanceClient(config, transport).syncFeeRates(skipped);
    expect(transport).not.toHaveBeenCalled();
  });
});
