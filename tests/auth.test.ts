import { afterEach, describe, expect, it, vi } from "vitest";
import { authorize, checkOrigin, createSession, SESSION_TTL, validSession } from "@/lib/auth";
import { getConfig } from "@/lib/config";
const secret = "test-session-secret-32-characters-long";
const password = "test-portal-password";
afterEach(() => vi.unstubAllEnvs());
function live() {
  vi.stubEnv("DATA_SOURCE", "binance");
  vi.stubEnv("BINANCE_API_KEY", "test-key");
  vi.stubEnv("BINANCE_API_SECRET", "test-secret");
  vi.stubEnv("PORTAL_PASSWORD", password);
  vi.stubEnv("SESSION_SECRET", secret);
}
describe("portal access boundaries", () => {
  it("rejects tampered, expired, password-rotated sessions", () => {
    const now = 100000;
    const token = createSession(secret, password, now);
    expect(validSession(token, secret, password, now + 1)).toBe(true);
    expect(validSession(token + "x", secret, password, now + 1)).toBe(false);
    expect(validSession(token, secret, "changed", now + 1)).toBe(false);
    expect(validSession(token, secret, password, now + SESSION_TTL * 1000)).toBe(false);
    expect(validSession("invalid", secret, password)).toBe(false);
  });
  it("fails closed for unprotected live accounts", () => {
    live();
    vi.stubEnv("PORTAL_PASSWORD", "");
    expect(() => getConfig()).toThrow(/PORTAL_PASSWORD/);
  });
  it("requires a valid cookie or configured bearer token", () => {
    live();
    expect(() => authorize(new Request("https://portal.test/api/dashboard"))).toThrow(/登录/);
    const token = createSession(secret, password);
    expect(
      authorize(
        new Request("https://portal.test/api/dashboard", {
          headers: { cookie: `slzb_session=${token}` },
        }),
      ).DATA_SOURCE,
    ).toBe("binance");
    vi.stubEnv("MONITOR_API_TOKEN", "a".repeat(32));
    expect(
      authorize(
        new Request("https://portal.test/api/dashboard", {
          headers: { authorization: `Bearer ${"a".repeat(32)}` },
        }),
      ).DATA_SOURCE,
    ).toBe("binance");
  });
  it("rejects cross-origin cookie writes and missing Origin", () => {
    vi.stubEnv("DATA_SOURCE", "demo");
    expect(() =>
      checkOrigin(
        new Request("https://portal.test/api/sync", { headers: { origin: "https://evil.test" } }),
      ),
    ).toThrow(/来源/);
    expect(() => checkOrigin(new Request("https://portal.test/api/sync"))).toThrow(/来源/);
    expect(() =>
      checkOrigin(
        new Request("https://portal.test/api/sync", { headers: { origin: "https://portal.test" } }),
      ),
    ).not.toThrow();
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/sync", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/sync", {
          headers: { host: "127.0.0.1:3000", origin: "http://evil.test" },
        }),
      ),
    ).toThrow(/来源/);
  });
  it("requires all baseline fields, including explicit net flows", () => {
    vi.stubEnv("PERFORMANCE_BASELINE_USDT", "100");
    vi.stubEnv("PERFORMANCE_BASELINE_AT", "2026-01-01T00:00:00Z");
    expect(() => getConfig()).toThrow(/同时设置/);
    vi.stubEnv("PERFORMANCE_NET_FLOWS_USDT", "0");
    expect(getConfig().PERFORMANCE_NET_FLOWS_USDT).toBe("0");
  });
});
