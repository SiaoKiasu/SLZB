import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/cost-store", () => ({ readCosts: mocks.read, writeCosts: mocks.write }));
import { GET, PUT } from "@/app/api/costs/route";
import { configure, fixture, request } from "./helpers";
import { createSession } from "@/lib/auth";
function setup() {
  const f = fixture();
  const config = {
    ...f,
    users: f.users.map((u) => ({
      ...u,
      role: u.username === "alice" ? ("admin" as const) : ("viewer" as const),
    })),
  };
  return configure(config);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("administrator cost permissions", () => {
  it("rejects anonymous and viewer reads/writes, including forged admin headers", async () => {
    setup();
    expect((await GET(new Request("https://portal.test/api/costs"))).status).toBe(401);
    expect((await GET(request("/api/costs", "bob"))).status).toBe(403);
    expect(
      (
        await PUT(
          request("/api/costs", "bob", {
            method: "PUT",
            headers: { "x-role": "admin" },
            body: JSON.stringify({ costs: { BTC: "1" }, revision: null }),
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("writes only the admin's bound account and never accepts a caller-selected account", async () => {
    setup();
    mocks.write.mockResolvedValue({
      costs: { BTC: "58000" },
      revision: "stored",
      updatedBy: "alice",
    });
    const response = await PUT(
      request("/api/costs?accountId=bob-account", "alice", {
        method: "PUT",
        body: JSON.stringify({ costs: { BTC: "58000" }, revision: null }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.write.mock.calls[0][0].ACCOUNT_ID).toBe("alice-account");
    expect(mocks.write.mock.calls[0].slice(1)).toEqual([{ BTC: "58000" }, null, "alice"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("alice-secret");
  });
  it("enforces same-origin and validates amounts, currency basis and extra fields", async () => {
    setup();
    const missingOrigin = request("/api/costs", "alice", { method: "PUT" });
    missingOrigin.headers.delete("origin");
    expect((await PUT(missingOrigin)).status).toBe(403);
    for (const body of [
      { costs: { BTC: "-1" }, revision: null },
      { costs: { BTC: "NaN" }, revision: null },
      { costs: { USDT: "2" }, revision: null },
      { costs: { BTC: "1e999" }, revision: null },
      { costs: { BTC: "1" }, revision: null, accountId: "bob-account" },
    ])
      expect(
        (await PUT(request("/api/costs", "alice", { method: "PUT", body: JSON.stringify(body) })))
          .status,
      ).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("revokes an existing admin session immediately after demotion", async () => {
    const app = setup();
    const cookie = createSession(app, app.users[0]);
    configure(fixture());
    expect(
      (
        await PUT(
          new Request("https://portal.test/api/costs", {
            method: "PUT",
            headers: { cookie: `slzb_session=${cookie}`, origin: "https://portal.test" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
