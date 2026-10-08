import { describe, it, expect } from "vitest";
import { tradeRealizedPnl, feeRateKey } from "@/lib/trade-pnl";
import type { Trade, TradeLedger } from "@/lib/types";
function trade(
  id: number,
  side: "BUY" | "SELL",
  quantity: string,
  quoteQuantity: string,
  fee = "0",
  feeAsset = "USDT",
): Trade {
  return {
    id: String(id),
    time: id * 60000,
    symbol: "ETHUSDT",
    side,
    quantity,
    quoteQuantity,
    price: "1",
    fee,
    feeAsset,
    isMaker: false,
  };
}
function ledger(trades: Trade[]): TradeLedger {
  return {
    version: 1,
    markets: {
      ETHUSDT: {
        baseAsset: "ETH",
        quoteAsset: "USDT",
        trades,
        nextId: "100",
        checkedAt: 1,
        complete: true,
      },
    },
  };
}
describe("realized PnL from historical fills", () => {
  it("defers all buy fees until sale, including when fee FX is not available yet", () => {
    expect(tradeRealizedPnl(ledger([trade(1, "BUY", "2", "200", "2")]), true).realizedPnl).toBe(
      "0",
    );
    expect(
      tradeRealizedPnl(ledger([trade(1, "BUY", "2", "200", "0.01", "BNB")]), true).realizedPnl,
    ).toBe("0");
  });
  it("allocates only sold share of buy cost and buy fees, then subtracts sale fees", () => {
    const l = ledger([trade(1, "BUY", "2", "200", "2"), trade(2, "SELL", "1", "150", "1")]);
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("48");
    l.markets.ETHUSDT.trades.push(trade(3, "SELL", "1", "120", "1"));
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("66");
  });
  it("uses moving weighted average for multiple entries and resets basis after full exit", () => {
    const l = ledger([
      trade(1, "BUY", "1", "100", "1"),
      trade(2, "BUY", "1", "200", "1"),
      trade(3, "SELL", "1", "200", "1"),
      trade(4, "SELL", "1", "180", "1"),
      trade(5, "BUY", "1", "300", "1"),
      trade(6, "SELL", "1", "310", "1"),
    ]);
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("84");
  });
  it("uses net received quantity for base-asset buy fees without counting fees twice", () => {
    const l = ledger([
      trade(1, "BUY", "1", "100", "0.01", "ETH"),
      trade(2, "SELL", "0.495", "60", "0.1"),
    ]);
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("9.9");
  });
  it("includes extra base-asset sale fee quantity in the disposed basis", () => {
    const l = ledger([trade(1, "BUY", "1", "100"), trade(2, "SELL", "0.99", "120", "0.01", "ETH")]);
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("20");
  });
  it("converts third-token fees at their own historical rates, allocating buy fees only on sale", () => {
    const l = ledger([
      trade(1, "BUY", "2", "200", "0.02", "BNB"),
      trade(2, "SELL", "1", "150", "0.01", "BNB"),
    ]);
    l.feeRates = {
      [feeRateKey("BNB", 60000)]: { price: "500", checkedAt: 1 },
      [feeRateKey("BNB", 120000)]: { price: "600", checkedAt: 1 },
    };
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("39");
    expect(tradeRealizedPnl(l, true).estimatedFees).toBe(true);
    delete l.feeRates[feeRateKey("BNB", 60000)];
    expect(tradeRealizedPnl(l, true)).toMatchObject({ realizedPnl: null, missingRates: ["BNB"] });
  });
  it("does not reuse fee tokens as remaining inventory for later sales", () => {
    const l = ledger([trade(2, "BUY", "1", "100", "0.1", "BNB")]);
    l.markets.BNBUSDT = {
      baseAsset: "BNB",
      quoteAsset: "USDT",
      complete: true,
      checkedAt: 1,
      nextId: "9",
      trades: [
        { ...trade(1, "BUY", "1", "500"), symbol: "BNBUSDT" },
        { ...trade(3, "SELL", "0.9", "540"), symbol: "BNBUSDT" },
      ],
    };
    l.feeRates = { [feeRateKey("BNB", 120000)]: { price: "500", checkedAt: 1 } };
    expect(tradeRealizedPnl(l, true).realizedPnl).toBe("90");
    l.markets.BNBUSDT.trades[1].quantity = "1";
    expect(tradeRealizedPnl(l, true).missingBuys).toEqual(["BNB"]);
  });
  it("sorts and deduplicates fills, never pairing a sale with future purchases", () => {
    const buy = trade(1, "BUY", "1", "100", "1"),
      sell = trade(2, "SELL", "1", "120", "1");
    expect(tradeRealizedPnl(ledger([sell, buy, sell, buy]), true).realizedPnl).toBe("18");
    expect(
      tradeRealizedPnl(ledger([trade(1, "SELL", "1", "120"), trade(2, "BUY", "1", "100")]), true),
    ).toMatchObject({ realizedPnl: null, missingBuys: ["ETH"] });
  });
  it("keeps missing purchases, unmatched quantities, incomplete history and cross pairs unknown", () => {
    expect(tradeRealizedPnl(undefined, true).realizedPnl).toBeNull();
    const l = ledger([trade(1, "BUY", "1", "100"), trade(2, "SELL", "2", "240")]);
    expect(tradeRealizedPnl(l, true).realizedPnl).toBeNull();
    expect(tradeRealizedPnl(ledger([]), false).realizedPnl).toBeNull();
    l.markets.ETHUSDT.quoteAsset = "BTC";
    expect(tradeRealizedPnl(l, true)).toMatchObject({ realizedPnl: null, unsupported: true });
  });
});
