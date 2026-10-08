import Decimal from "decimal.js";
import type { TradeLedger } from "./types";
Decimal.set({ precision: 36 });
// The administrator's current fixed unit cost is authoritative, including for past sales.
export function manualRealizedPnl(
  ledger: TradeLedger | undefined,
  costs: Record<string, string>,
  complete: boolean,
) {
  const missing = new Set<string>();
  let pnl = new Decimal(0);
  let unsupported = false;
  const values = { ...costs, USDT: "1" } as Record<string, string>;
  for (const market of Object.values(ledger?.markets ?? {})) {
    for (const trade of market.trades) {
      if (trade.side !== "SELL") continue;
      if (market.quoteAsset !== "USDT") {
        unsupported = true;
        continue;
      }
      const cost = values[market.baseAsset];
      if (cost === undefined) {
        missing.add(market.baseAsset);
        continue;
      }
      const fee = new Decimal(trade.fee);
      const feeCost = values[trade.feeAsset];
      if (fee.gt(0) && feeCost === undefined) {
        missing.add(trade.feeAsset);
        continue;
      }
      pnl = pnl.plus(trade.quoteQuantity).minus(new Decimal(trade.quantity).mul(cost));
      // Third-asset selling fees use the same administrator valuation convention.
      if (fee.gt(0)) pnl = pnl.minus(fee.mul(feeCost));
    }
  }
  return {
    realizedPnl: complete && ledger && !unsupported && !missing.size ? pnl.toString() : null,
    missing: [...missing],
    unsupported,
  };
}
