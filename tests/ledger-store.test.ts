import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { getAccountConfig } from "@/lib/config";
import { accountScope } from "@/lib/storage";
import { readLedger, saveLedger } from "@/lib/ledger-store";
import { configure } from "./helpers";
afterEach(() => vi.unstubAllEnvs());
it("persists local progress privately and separates another account and rotated API key", async () => {
  vi.stubEnv("VERCEL", "");
  const c = {
    ...getAccountConfig(configure(), "alice-account"),
    ACCOUNT_ID: `test-${randomUUID()}`,
    DATABASE_URL: "",
  };
  const hash = createHash("sha256").update(accountScope(c)).digest("hex");
  const file = resolve(".slzb", "ledgers", `${hash}.json`);
  try {
    await saveLedger(c, {
      version: 1,
      markets: {
        ETHUSDT: {
          baseAsset: "ETH",
          quoteAsset: "USDT",
          nextId: "1001",
          complete: false,
          checkedAt: 100,
          trades: [],
        },
      },
    });
    expect((await readLedger(c))?.ledger.markets.ETHUSDT.nextId).toBe("1001");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readLedger({ ...c, ACCOUNT_ID: `${c.ACCOUNT_ID}-other` })).toBeUndefined();
    expect(await readLedger({ ...c, BINANCE_API_KEY: "rotated-test-key" })).toBeUndefined();
  } finally {
    await unlink(file).catch(() => undefined);
  }
});
