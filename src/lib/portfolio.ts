import Decimal from "decimal.js";
import type { Balance, Holding, Ticker } from "./types";
Decimal.set({ precision: 36 });
export const STABLECOINS = new Set(["USDT", "USDC", "FDUSD", "DAI", "TUSD", "USDP"]);
export function valueHoldings(
  balances: Balance[],
  tickers: Ticker[],
  costs: Record<string, string>,
): Holding[] {
  const map = new Map(tickers.map((t) => [t.symbol, t]));
  function priceFor(asset: string): { price: Decimal; change: number } | null {
    if (asset === "USDT") return { price: new Decimal(1), change: 0 };
    const direct = map.get(`${asset}USDT`);
    if (direct && new Decimal(direct.lastPrice).gt(0))
      return { price: new Decimal(direct.lastPrice), change: Number(direct.priceChangePercent) };
    for (const bridge of ["BTC", "ETH", "USDC"]) {
      const pair = map.get(`${asset}${bridge}`);
      const quote = map.get(`${bridge}USDT`);
      if (pair && quote && new Decimal(pair.lastPrice).gt(0) && new Decimal(quote.lastPrice).gt(0))
        return {
          price: new Decimal(pair.lastPrice).mul(quote.lastPrice),
          change:
            ((1 + Number(pair.priceChangePercent) / 100) *
              (1 + Number(quote.priceChangePercent) / 100) -
              1) *
            100,
        };
    }
    return null;
  }
  const holdings = balances
    .filter((b) => new Decimal(b.free).plus(b.locked).gt(0))
    .map((b) => {
      const quantity = new Decimal(b.free).plus(b.locked);
      const rate = priceFor(b.asset);
      const averageCost = costs[b.asset] ?? null;
      return {
        ...b,
        quantity: quantity.toString(),
        price: rate?.price.toString() ?? null,
        value: rate ? quantity.mul(rate.price).toString() : null,
        allocation: 0,
        change24h: rate?.change ?? null,
        averageCost,
        unrealizedPnl:
          rate && averageCost !== null
            ? rate.price.minus(averageCost).mul(quantity).toString()
            : null,
      } satisfies Holding;
    });
  const total = holdings.reduce((s, h) => s.plus(h.value ?? 0), new Decimal(0));
  return holdings
    .map((h) => ({
      ...h,
      allocation: total.gt(0) ? new Decimal(h.value ?? 0).div(total).mul(100).toNumber() : 0,
    }))
    .sort((a, b) => new Decimal(b.value ?? 0).cmp(a.value ?? 0));
}
export function totalPnl(
  equity: string,
  baseline: string | undefined,
  netFlows: string | undefined,
  unpriced: number,
) {
  if (baseline === undefined || netFlows === undefined || unpriced > 0) return null;
  return new Decimal(equity).minus(baseline).minus(netFlows).toString();
}
