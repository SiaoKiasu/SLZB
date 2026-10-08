import { describe, expect, it } from "vitest";
import { reconstructCosts } from "@/lib/accounting";
import { demoData } from "@/lib/demo";
import { valueHoldings } from "@/lib/portfolio";
import type { Trade, TradeLedger } from "@/lib/types";
const trade = (
  side: "BUY" | "SELL",
  quantity: string,
  quoteQuantity: string,
  extra: Partial<Trade> = {},
): Trade => ({
  id: "1",
  symbol: "ETHUSDT",
  side,
  quantity,
  quoteQuantity,
  price: "100",
  fee: "0",
  feeAsset: "USDT",
  time: 1,
  isMaker: false,
  ...extra,
});
function run(trades: Trade[], quantity: string, complete = true) {
  const ledger: TradeLedger = {
    version: 1,
    markets: {
      ETHUSDT: {
        baseAsset: "ETH",
        quoteAsset: "USDT",
        nextId: "3",
        complete: true,
        checkedAt: 1,
        trades,
      },
    },
  };
  return reconstructCosts([{ asset: "ETH", free: quantity, locked: "0" }], ledger, complete);
}
describe("automatic spot cost reconstruction", () => {
  it("uses moving weighted average and includes quote-currency fees", () => {
    const r = run(
      [
        trade("BUY", "2", "200", { fee: "2" }),
        trade("BUY", "2", "400", { id: "2", time: 2 }),
        trade("SELL", "1", "200", { id: "3", time: 3, fee: "1" }),
      ],
      "3",
    );
    expect(r.costs.ETH).toBe("150.5");
    expect(r.realizedPnl).toBe("48.5");
  });
  it("deducts base fees from acquired quantity and handles fully closed positions", () => {
    const buy = trade("BUY", "1", "100", { fee: "0.01", feeAsset: "ETH" });
    expect(run([buy], "0.99").costs.ETH).toMatch(/^101\.0101/);
    const result = run([buy, trade("SELL", "0.99", "120", { id: "2", time: 2 })], "0");
    expect(result.realizedPnl).toBe("20");
    expect(result.costs.ETH).toBeUndefined();
  });
  it("does not report missing, partial, transferred or third-fee costs as zero", () => {
    const buy = trade("BUY", "1", "100");
    for (const r of [
      run([buy], "1", false),
      run([buy], "2"),
      run([trade("SELL", "1", "100")], "0"),
      run([trade("BUY", "1", "100", { fee: "0.001", feeAsset: "BNB" })], "1"),
    ]) {
      expect(r.realizedPnl).toBeNull();
      expect(r.costs.ETH).toBeUndefined();
    }
  });
  it("does not use current FX prices to invent historical costs for cross pairs", () => {
    const ledger: TradeLedger = {
      version: 1,
      markets: {
        ETHBTC: {
          baseAsset: "ETH",
          quoteAsset: "BTC",
          nextId: "2",
          complete: true,
          checkedAt: 1,
          trades: [trade("BUY", "1", "0.1", { symbol: "ETHBTC" })],
        },
      },
    };
    const r = reconstructCosts([{ asset: "ETH", free: "1", locked: "0" }], ledger, true);
    expect(r.realizedPnl).toBeNull();
    expect(r.unknown).toContain("ETH");
    expect(r.unknown).toContain("BTC");
  });
  it("keeps demo equity, principal, realized and unrealized PnL reconciled", () => {
    const data = demoData();
    const r = reconstructCosts(data.balances, data.ledger, true);
    const holdings = valueHoldings(data.balances, data.tickers, r.costs);
    const equity = holdings.reduce((s, h) => s + Number(h.value), 0);
    const unrealized = holdings.reduce((s, h) => s + Number(h.unrealizedPnl), 0);
    expect(r.realizedPnl).toBe("160");
    expect(equity).toBeCloseTo(100000 + 160 + unrealized, 8);
  });
});
