import { describe, it, expect } from "vitest";
import { manualRealizedPnl } from "@/lib/manual-pnl";
import type { TradeLedger } from "@/lib/types";
const ledger: TradeLedger = {
  version: 1,
  markets: {
    BTCUSDT: {
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nextId: "2",
      complete: true,
      checkedAt: 1,
      trades: [
        {
          id: "1",
          symbol: "BTCUSDT",
          side: "SELL",
          price: "60000",
          quantity: "0.1",
          quoteQuantity: "6000",
          fee: "0.01",
          feeAsset: "BNB",
          time: 1,
          isMaker: false,
        },
      ],
    },
  },
};
describe("manual authoritative cost basis", () => {
  it("uses admin unit costs for sales and third-currency fees, and retroactively recalculates edits", () => {
    expect(manualRealizedPnl(ledger, { BTC: "58000", BNB: "500" }, true).realizedPnl).toBe("195");
    expect(manualRealizedPnl(ledger, { BTC: "59000", BNB: "600" }, true).realizedPnl).toBe("94");
  });
  it("distinguishes explicit zero cost from missing cost and waits for sales history", () => {
    expect(manualRealizedPnl(ledger, { BTC: "0", BNB: "0" }, true).realizedPnl).toBe("6000");
    expect(manualRealizedPnl(ledger, { BTC: "58000" }, true).missing).toEqual(["BNB"]);
    expect(manualRealizedPnl(ledger, { BTC: "58000", BNB: "500" }, false).realizedPnl).toBeNull();
  });
});
