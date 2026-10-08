import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  history: vi.fn(),
  costs: vi.fn(),
}));
vi.mock("@/lib/binance", () => ({
  BinanceClient: class {
    load = mocks.load;
  },
}));
vi.mock("@/lib/cost-store", () => ({ readCosts: mocks.costs }));
vi.mock("@/lib/ledger-store", () => ({ readLedger: vi.fn(), saveLedger: vi.fn() }));
vi.mock("@/lib/storage", () => ({ saveSnapshot: mocks.save, readHistory: mocks.history }));
import { dashboard } from "@/lib/service";
import { getAccountConfig } from "@/lib/config";
import { configure, fixture } from "./helpers";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function config(key: string) {
  mocks.costs.mockResolvedValue({ costs: {} });
  const raw = fixture("binance");
  raw.accounts[0].apiKey = key;
  const app = configure(raw);
  const c = getAccountConfig(app, "alice-account");
  return {
    ...c,
    DATABASE_URL: "postgresql://test.invalid/unit-test",
    PERFORMANCE_BASELINE_USDT: "50",
    PERFORMANCE_BASELINE_AT: "2026-01-01T00:00:00Z",
    PERFORMANCE_NET_FLOWS_USDT: "0",
  };
}
const base = {
  tickers: [],
  orders: [],
  trades: [],
  warnings: [],
  tradesComplete: true,
  ordersComplete: true,
};
describe("snapshot and valuation integrity", () => {
  it("uses manual costs immediately before history finishes and picks up edits without an upstream refresh", async () => {
    const c = config("manual-before-history-test");
    mocks.load.mockResolvedValue({
      ...base,
      tradesComplete: false,
      balances: [{ asset: "BTC", free: "1", locked: "0.5" }],
      tickers: [{ symbol: "BTCUSDT", lastPrice: "60000", priceChangePercent: "0" }],
    });
    mocks.history.mockResolvedValue([]);
    mocks.costs.mockResolvedValue({ costs: { BTC: "58000" } });
    const first = await dashboard(c);
    expect(first.holdings[0].averageCost).toBe("58000");
    expect(first.summary.unrealizedPnl).toBe("3000");
    expect(first.summary.realizedPnl).toBeNull();
    expect(first.summary.realizedPnlNote).toContain("成交历史同步中");
    mocks.costs.mockResolvedValue({ costs: { BTC: "59000" } });
    expect((await dashboard(c)).summary.unrealizedPnl).toBe("1500");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it("separates USDT cash, frozen funds and principal from other stablecoins and missing costs", async () => {
    const c = { ...config("cash-principal-test"), PRINCIPAL_USDT: "75" };
    mocks.load.mockResolvedValue({
      ...base,
      balances: [
        { asset: "USDT", free: "100", locked: "20" },
        { asset: "USDC", free: "50", locked: "0" },
      ],
      tickers: [{ symbol: "USDCUSDT", lastPrice: "0.99", priceChangePercent: "0" }],
    });
    mocks.history.mockResolvedValue([]);
    const d = await dashboard(c);
    expect(d.summary).toMatchObject({
      equity: "169.5",
      principal: "75",
      cash: "120",
      cashFree: "100",
      cashLocked: "20",
      stablecoinValue: "169.5",
      unrealizedPnl: "0",
      realizedPnl: null,
    });
  });
  it("does not save incomplete equity or calculate total PnL when an asset is unpriced", async () => {
    const c = config("unpriced-test");
    mocks.load.mockResolvedValue({
      ...base,
      balances: [
        { asset: "USDT", free: "100", locked: "0" },
        { asset: "UNKNOWN", free: "1", locked: "0" },
      ],
    });
    mocks.history.mockResolvedValue([]);
    const d = await dashboard(c, true);
    expect(d.summary.equity).toBe("100");
    expect(d.summary.totalPnl).toBeNull();
    expect(d.summary.unpricedAssets).toBe(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(d.connection.snapshotsSaved).toBe(false);
  });
  it("retains current data when persistence fails and records the failure honestly", async () => {
    const c = config("database-failure-test");
    mocks.load.mockResolvedValue({
      ...base,
      balances: [{ asset: "USDT", free: "100", locked: "0" }],
    });
    mocks.save.mockRejectedValue(new Error("private connection string"));
    const d = await dashboard(c, true);
    expect(d.summary.equity).toBe("100");
    expect(d.summary.totalPnl).toBe("50");
    expect(d.connection.snapshotsSaved).toBe(false);
    expect(d.warnings.join(" ")).toContain("历史净值暂时不可用");
    expect(JSON.stringify(d)).not.toContain("private connection string");
  });
});
