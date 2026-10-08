import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/binance", () => ({
  BinanceClient: class {
    load = mocks.load;
  },
}));
vi.mock("@/lib/storage", () => ({ saveSnapshot: mocks.save, readHistory: mocks.history }));
import { dashboard } from "@/lib/service";
import { getAccountConfig } from "@/lib/config";
import { configure, fixture } from "./helpers";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function config(key: string) {
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
