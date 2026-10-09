import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GET, POST } from "@/app/api/admin/route";
import { GET as session, POST as login } from "@/app/api/session/route";
import { GET as resource } from "@/app/api/[resource]/route";
import { GET as costs } from "@/app/api/costs/route";
import { loadAppConfig } from "@/lib/runtime-config";
import { createSession } from "@/lib/auth";
import { readDirectory } from "@/lib/directory-store";
import { passwordHash, password } from "./helpers";
let dir: string;
let rootCookie: string;
function req(cookie = rootCookie, body?: unknown, path = "/api/admin") {
  return new Request(`https://portal.test${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie: `slzb_session=${cookie}`, origin: "https://portal.test" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const account = (id = "friend") => ({
  id,
  label: id,
  source: "demo",
  environment: "mainnet",
  enabled: true,
  principal: "15000",
});
const user = (accountId = "friend") => ({
  username: "friend",
  displayName: "朋友",
  accountId,
  enabled: true,
  password,
});
async function action(payload: Record<string, unknown>) {
  const revision = (await readDirectory()).revision;
  return POST(req(rootCookie, { ...payload, revision }));
}
async function userCookie() {
  const app = await loadAppConfig();
  return createSession(
    app,
    app.users.find((u) => u.username === "friend")!,
  );
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linden-admin-"));
  vi.stubEnv("ADMIN_STORE_FILE", join(dir, "directory.enc"));
  vi.stubEnv("ADMIN_USERNAME", "owner");
  vi.stubEnv("ADMIN_PASSWORD_HASH", passwordHash);
  vi.stubEnv("CONFIG_ENCRYPTION_KEY", "19".repeat(32));
  vi.stubEnv("SESSION_SECRET", "a-private-unit-test-session-secret-long-enough");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("CRON_SECRET", "");
  const app = await loadAppConfig();
  rootCookie = createSession(app, app.users[0]);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
describe("fixed administrator and persisted directory", () => {
  it("boots with zero accounts, lets root log in and create accounts/users without deployment", async () => {
    const rootLogin = await login(req("", { username: "owner", password }, "/api/session"));
    expect(rootLogin.status).toBe(200);
    expect(await rootLogin.json()).toMatchObject({
      accountId: "",
      accounts: [],
      user: { role: "admin" },
    });
    expect((await GET(req())).status).toBe(200);
    expect((await action({ action: "createAccount", account: account() })).status).toBe(200);
    expect((await action({ action: "createUser", user: user() })).status).toBe(200);
    const result = await login(req("", { username: "friend", password }, "/api/session"));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.user.role).toBe("viewer");
    expect(body.accounts).toBeUndefined();
    const view = await (await GET(req())).json();
    expect(view.users).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/passwordHash|apiSecret|test-password-long|scrypt/);
  });
  it("blocks viewers and anonymous clients from every management and cost operation", async () => {
    await action({ action: "createAccount", account: account() });
    await action({ action: "createAccount", account: account("other") });
    await action({ action: "createUser", user: user() });
    const cookie = await userCookie();
    expect((await GET(req(""))).status).toBe(401);
    expect((await GET(req(cookie))).status).toBe(403);
    const forged = req(cookie, { action: "deleteUser", username: "owner", revision: null });
    forged.headers.set("x-role", "admin");
    expect((await POST(forged)).status).toBe(403);
    expect((await costs(req(cookie, undefined, "/api/costs?accountId=other"))).status).toBe(403);
    const dashboard = await resource(req(cookie, undefined, "/api/dashboard?accountId=other"), {
      params: Promise.resolve({ resource: "dashboard" }),
    });
    const accountData = await dashboard.json();
    expect(accountData.accountLabel).toBe("friend");
    expect(accountData.summary.principal).toBe("15000");
    const rootDashboard = await resource(
      req(rootCookie, undefined, "/api/dashboard?accountId=other"),
      { params: Promise.resolve({ resource: "dashboard" }) },
    );
    expect((await rootDashboard.json()).accountLabel).toBe("other");
  });
  it("keeps root immutable and rejects role elevation, bad bindings and cross-origin writes", async () => {
    await action({ action: "createAccount", account: account() });
    for (const body of [
      { action: "createUser", user: { ...user(), role: "admin" } },
      { action: "createUser", user: user("missing") },
      { action: "createUser", user: { ...user(), passwordHash } },
    ])
      expect((await action(body)).status).toBe(400);
    expect(
      (await action({ action: "createUser", user: { ...user(), username: "owner" } })).status,
    ).toBe(403);
    expect((await action({ action: "deleteUser", username: "owner" })).status).toBe(403);
    expect((await action({ action: "revokeSessions", username: "owner" })).status).toBe(403);
    const origin = req(rootCookie, {
      action: "createAccount",
      account: account("attack"),
      revision: (await readDirectory()).revision,
    });
    origin.headers.set("origin", "https://evil.test");
    expect((await POST(origin)).status).toBe(403);
    origin.headers.delete("origin");
    expect((await POST(origin)).status).toBe(403);
  });
  it("encrypts API credentials, preserves omitted credentials and rejects ciphertext tampering", async () => {
    const privateAccount = {
      ...account(),
      source: "binance",
      apiKey: "private-key-marker",
      apiSecret: "private-secret-marker",
    };
    const created = await action({ action: "createAccount", account: privateAccount });
    expect(created.status).toBe(200);
    expect(JSON.stringify(await created.json())).not.toMatch(
      /private-key-marker|private-secret-marker/,
    );
    const edited = await action({
      action: "updateAccount",
      account: { ...account(), source: "binance", label: "Renamed", apiKey: "", apiSecret: "" },
    });
    expect(edited.status).toBe(200);
    expect((await loadAppConfig()).accounts[0].apiSecret).toBe(privateAccount.apiSecret);
    expect(
      (await action({ action: "updateAccount", account: { ...privateAccount, apiSecret: "" } }))
        .status,
    ).toBe(400);
    const ciphertext = await readFile(join(dir, "directory.enc"), "utf8");
    expect(ciphertext).not.toMatch(/private-key-marker|private-secret-marker|Renamed/);
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", "20".repeat(32));
    expect((await GET(req())).status).toBe(503);
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", "19".repeat(32));
    await writeFile(join(dir, "directory.enc"), ciphertext.slice(0, -5) + "AAAAA");
    expect((await GET(req())).status).toBe(503);
  });
  it("revokes cookies on password, binding, disable/re-enable, revoke and deletion", async () => {
    await action({ action: "createAccount", account: account() });
    await action({ action: "createAccount", account: account("other") });
    await action({ action: "createUser", user: user() });
    for (const mutation of [
      { action: "updateUser", user: { ...user(), password: "changed-password" } },
      { action: "updateUser", user: { ...user("other"), password: undefined } },
      { action: "updateUser", user: { ...user(), password: undefined, enabled: false } },
      { action: "revokeSessions", username: "friend" },
      { action: "deleteUser", username: "friend" },
    ]) {
      const cookie = await userCookie();
      expect((await session(req(cookie, undefined, "/api/session"))).status).toBe(200);
      expect((await action(mutation)).status).toBe(200);
      expect((await session(req(cookie, undefined, "/api/session"))).status).toBe(401);
      if (mutation.action === "updateUser" && mutation.user?.enabled === false) {
        await action({ action: "updateUser", user: { ...user(), password: undefined } });
        expect((await session(req(cookie, undefined, "/api/session"))).status).toBe(401);
      }
    }
  });
  it("revokes viewer sessions when an account is disabled and keeps root access", async () => {
    await action({ action: "createAccount", account: account() });
    await action({ action: "createUser", user: user() });
    const cookie = await userCookie();
    await action({ action: "updateAccount", account: { ...account(), enabled: false } });
    expect((await session(req(cookie, undefined, "/api/session"))).status).toBe(401);
    expect((await GET(req())).status).toBe(200);
    await action({ action: "updateAccount", account: account() });
    expect((await session(req(cookie, undefined, "/api/session"))).status).toBe(401);
  });
  it("rejects stale and competing writes instead of overwriting accounts", async () => {
    const first = await action({ action: "createAccount", account: account() });
    expect(first.status).toBe(200);
    expect(
      (
        await POST(
          req(rootCookie, { action: "createAccount", account: account("stale"), revision: null }),
        )
      ).status,
    ).toBe(409);
    const revision = (await readDirectory()).revision;
    const results = await Promise.all(
      ["second", "third"].map((id) =>
        POST(req(rootCookie, { action: "createAccount", account: account(id), revision })),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await readDirectory()).directory.accounts).toHaveLength(2);
  });
  it("fails closed on partial root setup or Vercel without durable storage", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    expect((await GET(req())).status).toBe(503);
    vi.stubEnv("ADMIN_PASSWORD_HASH", passwordHash);
    vi.stubEnv("VERCEL", "1");
    expect((await GET(req())).status).toBe(503);
  });
});
