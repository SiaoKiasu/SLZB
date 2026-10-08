import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorize,
  checkOrigin,
  createSession,
  SESSION_TTL,
  readSession,
  authenticatedJson,
} from "@/lib/auth";
import { getAppConfig } from "@/lib/config";
import { configure, fixture, request, passwordHash } from "./helpers";
import { hashPassword, verifyPassword } from "../scripts/password.mjs";
afterEach(() => vi.unstubAllEnvs());
describe("individual user sessions", () => {
  it("survives the old 12-hour cutoff, rejects tampering and expires after a year", () => {
    const app = configure();
    const now = 100000;
    const token = createSession(app, app.users[0], now);
    expect(readSession(token, app, now + 13 * 3600000)?.user.username).toBe("alice");
    expect(readSession(token + "x", app, now + 1)).toBeNull();
    expect(readSession(token, app, now + SESSION_TTL * 1000)).toBeNull();
  });
  it("requires login even for the demo and never accepts legacy global bearer tokens", () => {
    configure();
    expect(() => authorize(new Request("https://portal.test/api/dashboard"))).toThrow(/登录/);
    expect(() =>
      authorize(
        new Request("https://portal.test/api/dashboard", {
          headers: { authorization: "Bearer anything" },
        }),
      ),
    ).toThrow(/登录/);
    expect(authorize(request("/api/dashboard")).config.ACCOUNT_ID).toBe("alice-account");
  });
  it("invalidates existing sessions on password change, reassignment, revocation, disabling or secret rotation", () => {
    const app = configure();
    const token = createSession(app, app.users[0]);
    for (const mutate of [
      (a: typeof app) => {
        a.users[0].passwordHash = passwordHash.replace(/.$/, "f");
      },
      (a: typeof app) => {
        a.users[0].accountId = "bob-account";
      },
      (a: typeof app) => {
        a.users[0].sessionVersion++;
      },
      (a: typeof app) => {
        a.users[0].enabled = false;
      },
      (a: typeof app) => {
        a.accounts[0].enabled = false;
      },
      (a: typeof app) => {
        a.sessionSecret = "rotated-secret";
      },
      (a: typeof app) => {
        a.users.shift();
      },
    ]) {
      const changed = structuredClone(app);
      mutate(changed);
      expect(readSession(token, changed)).toBeNull();
    }
  });
  it("renews old active cookies and keeps username bound to the same account", () => {
    configure();
    const auth = authorize(request("/api/dashboard", "alice", {}, Date.now() - 2 * 86400000));
    const response = authenticatedJson({ ok: true }, auth);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`Max-Age=${SESSION_TTL}`);
    expect(
      readSession(cookie.split(";")[0].slice("slzb_session=".length), auth.app)?.user.accountId,
    ).toBe("alice-account");
    expect(
      authenticatedJson({}, authorize(request("/api/dashboard"))).headers.has("set-cookie"),
    ).toBe(false);
  });
  it("rejects cross-origin writes while accepting normalized localhost Host", () => {
    expect(() =>
      checkOrigin(
        new Request("https://portal.test/api/sync", { headers: { origin: "https://evil.test" } }),
      ),
    ).toThrow(/来源/);
    expect(() => checkOrigin(new Request("https://portal.test/api/sync"))).toThrow(/来源/);
    expect(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/sync", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("uses salted scrypt hashes and verifies without plaintext storage", async () => {
    const first = await hashPassword("a-test-password");
    const second = await hashPassword("a-test-password");
    expect(first).not.toEqual(second);
    expect(first).not.toContain("a-test-password");
    expect(await verifyPassword("a-test-password", first)).toBe(true);
    expect(await verifyPassword("incorrect", first)).toBe(false);
  });
});
describe("administrator configuration", () => {
  it("rejects missing account bindings and duplicate usernames", () => {
    const raw = fixture();
    raw.users[0].accountId = "missing";
    expect(() => configure(raw)).toThrow(/配置/);
    const duplicate = fixture();
    duplicate.users[1].username = "ALICE";
    expect(() => configure(duplicate)).toThrow(/配置/);
  });
  it("fails closed for malformed explicit config and legacy live configuration", () => {
    vi.stubEnv("PORTAL_CONFIG_JSON", "not-json");
    expect(() => getAppConfig()).toThrow(/配置/);
    vi.stubEnv("PORTAL_CONFIG_JSON", "");
    vi.stubEnv("DATA_SOURCE", "binance");
    expect(() => getAppConfig()).toThrow(/迁移/);
  });
  it("requires a private session secret for custom users", () => {
    configure();
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => getAppConfig()).toThrow(/配置/);
  });
});
