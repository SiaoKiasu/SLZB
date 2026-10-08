import Decimal from "decimal.js";
import type { TradeLedger } from "./types";
Decimal.set({ precision: 36 });

export const feeRateKey = (asset: string, time: number) =>
  `${asset}:${Math.floor(time / 60000) * 60000}`;

// Internal moving-average inventory is used only for realized PnL. Never publish it as
// the administrator's current holding cost or use manual costs to fill historical gaps.
export function tradeRealizedPnl(ledger: TradeLedger | undefined, complete: boolean) {
  type Position = { quantity: Decimal; cost: Decimal; valid: boolean };
  const positions = new Map<string, Position>();
  const position = (asset: string) => {
    if (!positions.has(asset))
      positions.set(asset, {
        quantity: new Decimal(0),
        cost: new Decimal(0),
        valid: true,
      });
    return positions.get(asset)!;
  };
  const missingBuys = new Set<string>();
  const missingRates = new Set<string>();
  let pnl = new Decimal(0),
    fees = new Decimal(0),
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
    // Base-asset commissions have an exact fill conversion, using quoteQty / qty.
    const baseFeeValue =
      baseFee.gt(0) && quantity.gt(0) ? baseFee.mul(quote).div(quantity) : new Decimal(0);
    let feeValue = baseFeeValue;
    if (fee.gt(0) && t.feeAsset !== m.baseAsset) {
      if (t.feeAsset === "USDT") feeValue = fee;
      else {
        const rate = ledger?.feeRates?.[feeRateKey(t.feeAsset, t.time)]?.price;
        if (rate && new Decimal(rate).gt(0)) {
          feeValue = fee.mul(rate);
          estimatedFees = true;
        } else missingRates.add(t.feeAsset);
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
    fees = fees.plus(feeValue);
    // Base-token sale fees are included by removing their inventory basis below.
    // Cancel their gross fill value algebraically, avoiding rounding residue.
    pnl = pnl.minus(t.side === "SELL" ? feeValue.minus(baseFeeValue) : feeValue);
    if (t.side === "BUY") {
      const received = quantity.minus(baseFee);
      if (received.lte(0)) {
        p.valid = false;
        continue;
      }
      // Fees are expensed now. Keep only the fee-exclusive cost of received units
      // in inventory, so a future sale cannot deduct the same fee again.
      p.quantity = p.quantity.plus(received);
      p.cost = p.cost.plus(quote).minus(baseFeeValue);
      continue;
    }
    const disposed = quantity.plus(baseFee);
    if (!p.valid || p.quantity.lt(disposed) || p.quantity.isZero()) {
      missingBuys.add(m.baseAsset);
      p.valid = false;
      continue;
    }
    const basis = p.cost.mul(disposed).div(p.quantity);
    pnl = pnl.plus(quote).minus(basis);
    p.quantity = p.quantity.minus(disposed);
    p.cost = p.quantity.isZero() ? new Decimal(0) : p.cost.minus(basis);
  }
  return {
    realizedPnl:
      ledger &&
      (complete || rows.length > 0) &&
      !unsupported &&
      !missingBuys.size &&
      !missingRates.size
        ? pnl.toString()
        : null,
    complete: Boolean(
      ledger && complete && !unsupported && !missingBuys.size && !missingRates.size,
    ),
    feePnl:
      ledger && (complete || rows.length > 0) && !unsupported && !missingRates.size
        ? fees.negated().toString()
        : null,
    missingBuys: [...missingBuys],
    missingRates: [...missingRates],
    unsupported,
    estimatedFees,
  };
}
