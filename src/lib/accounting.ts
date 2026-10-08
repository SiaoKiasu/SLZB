import Decimal from "decimal.js";
import type { Balance, TradeLedger } from "./types";
Decimal.set({ precision: 36 });

// Moving average, in USDT. Never substitute today's price for historical cost.
export function reconstructCosts(
  balances: Balance[],
  ledger: TradeLedger | undefined,
  complete: boolean,
) {
  const positions = new Map<
    string,
    { quantity: Decimal; cost: Decimal; realized: Decimal; valid: boolean }
  >();
  function position(asset: string) {
    if (!positions.has(asset))
      positions.set(asset, {
        quantity: new Decimal(0),
        cost: new Decimal(0),
        realized: new Decimal(0),
        valid: true,
      });
    return positions.get(asset)!;
  }
  const rows = Object.values(ledger?.markets ?? {}).flatMap((m) => m.trades.map((t) => ({ t, m })));
  rows.sort(
    (a, b) =>
      a.t.time - b.t.time ||
      a.t.symbol.localeCompare(b.t.symbol) ||
      (BigInt(a.t.id) < BigInt(b.t.id) ? -1 : 1),
  );
  for (const { t, m } of rows) {
    const p = position(m.baseAsset);
    const quantity = new Decimal(t.quantity),
      quote = new Decimal(t.quoteQuantity),
      fee = new Decimal(t.fee);
    if (m.quoteAsset !== "USDT") {
      p.valid = false;
      if (m.quoteAsset !== "USDT") position(m.quoteAsset).valid = false;
      if (fee.gt(0) && t.feeAsset !== "USDT") position(t.feeAsset).valid = false;
      continue;
    }
    if (fee.gt(0) && t.feeAsset !== m.baseAsset && t.feeAsset !== "USDT") {
      p.valid = false;
      position(t.feeAsset).valid = false;
    }
    const baseFee = t.feeAsset === m.baseAsset ? fee : new Decimal(0);
    const quoteFee = t.feeAsset === "USDT" ? fee : new Decimal(0);
    if (t.side === "BUY") {
      const received = quantity.minus(baseFee);
      if (received.lte(0)) {
        p.valid = false;
        continue;
      }
      p.quantity = p.quantity.plus(received);
      p.cost = p.cost.plus(quote).plus(quoteFee);
    } else {
      const disposed = quantity.plus(baseFee);
      if (p.quantity.lt(disposed) || p.quantity.eq(0)) {
        p.valid = false;
        continue;
      }
      const basis = p.cost.mul(disposed).div(p.quantity);
      p.realized = p.realized.plus(quote).minus(quoteFee).minus(basis);
      p.quantity = p.quantity.minus(disposed);
      p.cost = p.quantity.eq(0) ? new Decimal(0) : p.cost.minus(basis);
    }
  }
  const actual = new Map(balances.map((b) => [b.asset, new Decimal(b.free).plus(b.locked)]));
  for (const [asset, quantity] of actual) if (asset !== "USDT" && quantity.gt(0)) position(asset);
  const costs: Record<string, string> = { USDT: "1" };
  const unknown: string[] = [];
  let realized = new Decimal(0);
  for (const [asset, p] of positions) {
    if (asset === "USDT") continue;
    const quantity = actual.get(asset) ?? new Decimal(0);
    // Tiny Decimal division residue is tolerated; actual balance changes are not.
    if (quantity.minus(p.quantity).abs().gt("0.000000000001")) p.valid = false;
    if (!p.valid) unknown.push(asset);
    else {
      realized = realized.plus(p.realized);
      if (complete && quantity.gt(0)) costs[asset] = p.cost.div(quantity).toString();
    }
  }
  return {
    costs,
    unknown,
    realizedPnl: complete && unknown.length === 0 ? realized.toString() : null,
  };
}
