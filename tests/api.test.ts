import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/[resource]/route";
import { POST } from "@/app/api/sync/route";
import { GET as cron } from "@/app/api/cron/route";
import { POST as login, DELETE as logout, GET as session } from "@/app/api/session/route";
afterEach(() => vi.unstubAllEnvs());
describe("monitor API", () => {
  it("serves demo data and never serializes secret config", async () => {
    vi.stubEnv("DATA_SOURCE", "demo");
    vi.stubEnv("BINANCE_API_SECRET", "never-expose-this");
    const response = await GET(new Request("https://portal.test/api/dashboard"), {
      params: Promise.resolve({ resource: "dashboard" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    expect(body).not.toContain("never-expose-this");
    const data = JSON.parse(body);
    expect(data.holdings.length).toBe(5);
    expect(data.source).toBe("demo");
    expect(data.history.length).toBeGreaterThan(2);
  });
  it("protects writes and rejects unauthenticated cron calls", async () => {
    vi.stubEnv("DATA_SOURCE", "demo");
    expect(
      (await POST(new Request("https://portal.test/api/sync", { method: "POST" }))).status,
    ).toBe(403);
    expect((await cron(new Request("https://portal.test/api/cron"))).status).toBe(401);
  });
  it("rejects invalid pagination and unsupported resources", async () => {
    vi.stubEnv("DATA_SOURCE", "demo");
    expect(
      (
        await GET(new Request("https://portal.test/api/trades?symbol=BTCUSDT&limit=1001"), {
          params: Promise.resolve({ resource: "trades" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(new Request("https://portal.test/api/admin"), {
          params: Promise.resolve({ resource: "admin" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(new Request("https://portal.test/api/trades?fromId=0"), {
          params: Promise.resolve({ resource: "trades" }),
        })
      ).status,
    ).toBe(400);
  });
  it("logs in with a secure cookie, authenticates data, and clears it on logout", async () => {
    vi.stubEnv("DATA_SOURCE", "demo");
    vi.stubEnv("PORTAL_PASSWORD", "test-password-long");
    vi.stubEnv("SESSION_SECRET", "test-session-secret-over-thirty-two-characters");
    vi.stubEnv("NODE_ENV", "production");
    const headers = { origin: "https://portal.test", "content-type": "application/json" };
    const denied = await login(
      new Request("https://portal.test/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(denied.status).toBe(401);
    const response = await login(
      new Request("https://portal.test/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: "test-password-long" }),
      }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(
      (
        await session(
          new Request("https://portal.test/api/session", {
            headers: { cookie: cookie.split(";")[0] },
          }),
        )
      ).status,
    ).toBe(200);
    const cleared = await logout(
      new Request("https://portal.test/api/session", { method: "DELETE", headers }),
    );
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await session(new Request("https://portal.test/api/session"))).status).toBe(401);
  });
});
