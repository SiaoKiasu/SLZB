import { describe, expect, it } from "vitest";
import { totalPnl, valueHoldings } from "@/lib/portfolio";
describe("portfolio accounting", () => {
  it("suppresses stablecoin unrealized PnL even with cost, while valuing actual market prices", () => {
    const rows = valueHoldings(
      [
        { asset: "USDT", free: "100", locked: "20" },
        { asset: "USDC", free: "100", locked: "0" },
      ],
      [{ symbol: "USDCUSDT", lastPrice: "0.98", priceChangePercent: "-2" }],
      { USDT: "1", USDC: "1" },
    );
    expect(rows.map((h) => h.unrealizedPnl)).toEqual([null, null]);
    expect(rows.find((h) => h.asset === "USDC")?.value).toBe("98");
    expect(rows.find((h) => h.asset === "USDC")?.averageCost).toBe("1");
  });
  it("values free plus locked balances with decimal arithmetic", () => {
    const [h] = valueHoldings(
      [{ asset: "BTC", free: "0.1", locked: "0.2" }],
      [{ symbol: "BTCUSDT", lastPrice: "60000.01", priceChangePercent: "1" }],
      { BTC: "50000" },
    );
    expect(h.quantity).toBe("0.3");
    expect(h.value).toBe("18000.003");
    expect(h.unrealizedPnl).toBe("3000.003");
  });
  it("does not invent zero values, cost bases or stablecoin pegs", () => {
    const rows = valueHoldings(
      [
        { asset: "USDC", free: "100", locked: "0" },
        { asset: "UNKNOWN", free: "1", locked: "0" },
      ],
      [{ symbol: "USDCUSDT", lastPrice: "0.98", priceChangePercent: "-2" }],
      {},
    );
    expect(rows[0].value).toBe("98");
    expect(rows[0].unrealizedPnl).toBeNull();
    expect(rows[1].value).toBeNull();
  });
  it("uses actual cross prices and compounded daily changes", () => {
    const [h] = valueHoldings(
      [{ asset: "ABC", free: "2", locked: "0" }],
      [
        { symbol: "ABCBTC", lastPrice: "0.001", priceChangePercent: "10" },
        { symbol: "BTCUSDT", lastPrice: "50000", priceChangePercent: "10" },
      ],
      {},
    );
    expect(h.value).toBe("100");
    expect(h.change24h).toBeCloseTo(21);
  });
  it("requires complete capital inputs and complete asset valuation", () => {
    expect(totalPnl("130", "100", "20", 0)).toBe("10");
    expect(totalPnl("80", "100", "-30", 0)).toBe("10");
    expect(totalPnl("130", "100", undefined, 0)).toBeNull();
    expect(totalPnl("130", "100", "0", 1)).toBeNull();
    expect(totalPnl("130", "0", "0", 0)).toBe("130");
  });
  it("excludes empty balances but preserves dust", () => {
    const rows = valueHoldings(
      [
        { asset: "BTC", free: "0", locked: "0" },
        { asset: "USDT", free: "0.00000001", locked: "0" },
      ],
      [],
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("1e-8");
  });
});
