import Decimal from "decimal.js";
import type { TradeLedger } from "./types";
Decimal.set({ precision: 36 });

export const feeRateKey = (asset: string, time: number) =>
  `${asset}:${Math.floor(time / 60000) * 60000}`;

// Internal moving-average inventory is used only for realized PnL. Never publish it as
// the administrator's current holding cost or use manual costs to fill historical gaps.
export function tradeRealizedPnl(ledger: TradeLedger | undefined, complete: boolean) {
  type Position = { quantity: Decimal; cost: Decimal; unknownFees: Set<string>; valid: boolean };
  const positions = new Map<string, Position>();
  const position = (asset: string) => {
    if (!positions.has(asset))
      positions.set(asset, {
        quantity: new Decimal(0),
        cost: new Decimal(0),
        unknownFees: new Set(),
        valid: true,
      });
    return positions.get(asset)!;
  };
  const missingBuys = new Set<string>();
  const missingRates = new Set<string>();
  let pnl = new Decimal(0),
    unsupported = false,
    estimatedFees = false;
  const rows = Object.values(ledger?.markets ?? {})
    .flatMap((m) => [...new Map(m.trades.map((t) => [t.id, t])).values()].map((t) => ({ m, t })))
    .sort(
      (a, b) =>
        a.t.time - b.t.time ||
        a.t.symbol.localeCompare(b.t.symbol) ||
        (BigInt(a.t.id) < BigInt(b.t.id) ? -1 : BigInt(a.t.id) > BigInt(b.t.id) ? 1 : 0),
    );
  for (const { m, t } of rows) {
    if (m.quoteAsset !== "USDT") {
      unsupported = true;
      continue;
    }
    const p = position(m.baseAsset);
    const quantity = new Decimal(t.quantity),
      quote = new Decimal(t.quoteQuantity),
      fee = new Decimal(t.fee);
    const baseFee = t.feeAsset === m.baseAsset ? fee : new Decimal(0);
    let externalFee = new Decimal(0);
    let missingFee: string | undefined;
    if (fee.gt(0) && t.feeAsset !== m.baseAsset) {
      if (t.feeAsset === "USDT") externalFee = fee;
      else {
        const rate = ledger?.feeRates?.[feeRateKey(t.feeAsset, t.time)]?.price;
        if (rate && new Decimal(rate).gt(0)) {
          externalFee = fee.mul(rate);
          estimatedFees = true;
        } else missingFee = t.feeAsset;
        // Fees consume this token too. Do not leave that quantity available for a later sale.
        // Token spending is not a separate trade; only actual BUY/SELL fills realize PnL here.
        const paid = position(t.feeAsset);
        if (paid.quantity.gte(fee)) {
          const consumedCost = paid.cost.mul(fee).div(paid.quantity);
          paid.quantity = paid.quantity.minus(fee);
          paid.cost = paid.quantity.isZero() ? new Decimal(0) : paid.cost.minus(consumedCost);
        } else {
          paid.valid = false;
          paid.quantity = new Decimal(0);
          paid.cost = new Decimal(0);
        }
      }
    }
    if (t.side === "BUY") {
      const received = quantity.minus(baseFee);
      if (received.lte(0)) {
        p.valid = false;
        continue;
      }
      // A fee withheld from the bought asset reduces received quantity; adding its
      // market value to cost as well would count the same fee twice.
      p.quantity = p.quantity.plus(received);
      p.cost = p.cost.plus(quote).plus(externalFee);
      if (missingFee) p.unknownFees.add(missingFee);
      continue;
    }
    const disposed = quantity.plus(baseFee);
    if (!p.valid || p.quantity.lt(disposed) || p.quantity.isZero()) {
      missingBuys.add(m.baseAsset);
      p.valid = false;
      continue;
    }
    for (const asset of p.unknownFees) missingRates.add(asset);
    if (missingFee) missingRates.add(missingFee);
    const basis = p.cost.mul(disposed).div(p.quantity);
    pnl = pnl.plus(quote).minus(basis).minus(externalFee);
    p.quantity = p.quantity.minus(disposed);
    p.cost = p.quantity.isZero() ? new Decimal(0) : p.cost.minus(basis);
    if (p.quantity.isZero()) p.unknownFees.clear();
  }
  return {
    realizedPnl:
      ledger && complete && !unsupported && !missingBuys.size && !missingRates.size
        ? pnl.toString()
        : null,
    missingBuys: [...missingBuys],
    missingRates: [...missingRates],
    unsupported,
    estimatedFees,
  };
}
