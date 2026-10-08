import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/binance", () => ({
  BinanceClient: class {
    load = mocks.load;
  },
}));
vi.mock("@/lib/storage", () => ({ saveSnapshot: mocks.save, readHistory: mocks.history }));
import { dashboard } from "@/lib/service";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function config(key: string) {
  vi.stubEnv("DATA_SOURCE", "binance");
  vi.stubEnv("BINANCE_API_KEY", key);
  vi.stubEnv("BINANCE_API_SECRET", "test-secret");
  vi.stubEnv("PORTAL_PASSWORD", "test-password-long");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-over-thirty-two-characters");
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/unit-test");
  vi.stubEnv("PERFORMANCE_BASELINE_USDT", "50");
  vi.stubEnv("PERFORMANCE_BASELINE_AT", "2026-01-01T00:00:00Z");
  vi.stubEnv("PERFORMANCE_NET_FLOWS_USDT", "0");
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
    config("unpriced-test");
    mocks.load.mockResolvedValue({
      ...base,
      balances: [
        { asset: "USDT", free: "100", locked: "0" },
        { asset: "UNKNOWN", free: "1", locked: "0" },
      ],
    });
    mocks.history.mockResolvedValue([]);
    const d = await dashboard(true);
    expect(d.summary.equity).toBe("100");
    expect(d.summary.totalPnl).toBeNull();
    expect(d.summary.unpricedAssets).toBe(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(d.connection.snapshotsSaved).toBe(false);
  });
  it("retains current data when persistence fails and records the failure honestly", async () => {
    config("database-failure-test");
    mocks.load.mockResolvedValue({
      ...base,
      balances: [{ asset: "USDT", free: "100", locked: "0" }],
    });
    mocks.save.mockRejectedValue(new Error("private connection string"));
    const d = await dashboard(true);
    expect(d.summary.equity).toBe("100");
    expect(d.summary.totalPnl).toBe("50");
    expect(d.connection.snapshotsSaved).toBe(false);
    expect(d.warnings.join(" ")).toContain("数据库连接失败");
    expect(JSON.stringify(d)).not.toContain("private connection string");
  });
});
