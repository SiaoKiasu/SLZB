import { scryptSync } from "node:crypto";
import { vi } from "vitest";
import { getAppConfig } from "@/lib/config";
import { createSession } from "@/lib/auth";
const salt = "11".repeat(16);
export const password = "test-password-long";
export const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
export function fixture(source: "demo" | "binance" = "demo") {
  return {
    accounts: [
      {
        id: "alice-account",
        label: "Alice 现货",
        source,
        apiKey: "alice-key",
        apiSecret: "alice-secret",
        symbols: ["BTCUSDT"],
      },
      {
        id: "bob-account",
        label: "Bob 现货",
        source,
        apiKey: "bob-key",
        apiSecret: "bob-secret",
        symbols: ["ETHUSDT"],
      },
    ],
    users: [
      {
        username: "alice",
        displayName: "Alice",
        passwordHash,
        accountId: "alice-account",
        enabled: true,
        sessionVersion: 1,
      },
      {
        username: "bob",
        displayName: "Bob",
        passwordHash,
        accountId: "bob-account",
        enabled: true,
        sessionVersion: 1,
      },
    ],
  };
}
export function configure(raw = fixture()) {
  vi.stubEnv("PORTAL_CONFIG_JSON", JSON.stringify(raw));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("PORTAL_CONFIG_FILE", "");
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-more-than-thirty-two-characters");
  return getAppConfig();
}
export function request(
  path: string,
  username = "alice",
  init: RequestInit = {},
  issuedAt = Date.now(),
) {
  const app = getAppConfig();
  const user = app.users.find((u) => u.username === username)!;
  return new Request(`https://portal.test${path}`, {
    ...init,
    headers: {
      cookie: `slzb_session=${createSession(app, user, issuedAt)}`,
      origin: "https://portal.test",
      ...init.headers,
    },
  });
}
