import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { BinanceClient } from "@/lib/binance";
const config = {
  BINANCE_ENV: "testnet" as const,
  BINANCE_API_KEY: "unit-test-key",
  BINANCE_API_SECRET: "unit-test-secret",
};
describe("Binance read-only transport", () => {
  it("signs the exact query and maps trade data without a write request", async () => {
    const transport = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://testnet.binance.vision");
      expect(options?.method).toBe("GET");
      const signature = url.searchParams.get("signature");
      url.searchParams.delete("signature");
      expect(signature).toBe(
        createHmac("sha256", config.BINANCE_API_SECRET)
          .update(url.searchParams.toString())
          .digest("hex"),
      );
      expect(url.searchParams.get("fromId")).toBe("0");
      expect(url.searchParams.get("limit")).toBe("1000");
      return Response.json([
        {
          id: 100,
          symbol: "BTCUSDT",
          price: "100",
          qty: "2",
          quoteQty: "200",
          commission: "0.02",
          commissionAsset: "BNB",
          time: 1000,
          isBuyer: true,
          isMaker: false,
        },
      ]);
    });
    const rows = await new BinanceClient(config, transport).trades("BTCUSDT", "0", 1000);
    expect(rows[0]).toMatchObject({ id: "100", side: "BUY", quantity: "2", feeAsset: "BNB" });
  });
  it("sanitizes exchange errors instead of leaking URLs or credentials", async () => {
    const client = new BinanceClient(config, async () =>
      Response.json({ code: -2015, msg: "secret URL and key" }, { status: 401 }),
    );
    await expect(client.trades("BTCUSDT")).rejects.toThrow(/白名单/);
  });
  it("reports throttling and regional rejection distinctly", async () => {
    for (const [status, message] of [
      [429, /频繁/],
      [451, /部署出口/],
    ] as const) {
      const client = new BinanceClient(config, async () => new Response("", { status }));
      await expect(client.trades("BTCUSDT")).rejects.toThrow(message);
    }
  });
  it("keeps balances available when some trade symbols fail", async () => {
    const client = new BinanceClient(config, async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("time")) return Response.json({ serverTime: Date.now() });
      if (url.pathname.endsWith("account"))
        return Response.json({ balances: [{ asset: "USDT", free: "100", locked: "0" }] });
      if (url.pathname.endsWith("24hr")) return Response.json([]);
      if (url.pathname.endsWith("openOrders")) return Response.json([]);
      return Response.json({ code: -1121 }, { status: 400 });
    });
    const data = await client.load(["INVALIDUSDT"]);
    expect(data.balances).toHaveLength(1);
    expect(data.tradesComplete).toBe(false);
    expect(data.warnings.join(" ")).toContain("INVALIDUSDT");
  });
});
