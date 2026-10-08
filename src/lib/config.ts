import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scryptSync } from "node:crypto";
import { portalConfigSchema, type AccountSettings, type PortalUser } from "./config-schema";
import { AppError } from "./errors";
const demoSalt = "8b31a42e977553eabbc9954e16f55a11";
const demoHash = `scrypt$${demoSalt}$${scryptSync("demo123456", demoSalt, 64).toString("hex")}`;
export const DEMO_CONFIG = {
  accounts: [{ id: "demo", label: "演示现货账户", source: "demo" as const }],
  users: [{ username: "demo", displayName: "演示用户", passwordHash: demoHash, accountId: "demo" }],
};
export type AppConfig = {
  accounts: AccountSettings[];
  users: PortalUser[];
  sessionSecret: string;
  databaseUrl: string;
  cronSecret: string;
  builtInDemo: boolean;
};
export function getAppConfig(): AppConfig {
  // Private local config is read at runtime, never traced into deployment bundles.
  const file = resolve(
    /*turbopackIgnore: true*/ process.env.PORTAL_CONFIG_FILE || ".slzb/accounts.json",
  );
  let raw = process.env.PORTAL_CONFIG_JSON;
  if (!raw && (process.env.PORTAL_CONFIG_FILE || existsSync(/*turbopackIgnore: true*/ file))) {
    try {
      raw = readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    } catch {
      throw new AppError("CONFIG_INVALID", "账户服务配置暂不可用，请联系管理员。", 503);
    }
  }
  if (
    !raw &&
    (process.env.DATA_SOURCE === "binance" ||
      process.env.BINANCE_API_KEY ||
      process.env.BINANCE_API_SECRET ||
      process.env.PORTAL_PASSWORD ||
      process.env.MONITOR_API_TOKEN)
  )
    throw new AppError("CONFIG_MIGRATION", "管理员需要将旧单账户配置迁移到多用户配置。", 503);
  const builtInDemo = !raw;
  let parsed: ReturnType<typeof portalConfigSchema.parse>;
  try {
    parsed = portalConfigSchema.parse(raw ? JSON.parse(raw) : DEMO_CONFIG);
  } catch {
    throw new AppError("CONFIG_INVALID", "账户服务配置暂不可用，请联系管理员。", 503);
  }
  if (!parsed.accounts.length || !parsed.users.length)
    throw new AppError("CONFIG_MISSING", "查看账号尚未开通，请联系管理员。", 503);
  const sessionSecret =
    process.env.SESSION_SECRET ||
    (builtInDemo ? "slzb-public-demo-session-secret-not-for-real-accounts" : "");
  if (sessionSecret.length < 32)
    throw new AppError("CONFIG_INVALID", "账户服务配置暂不可用，请联系管理员。", 503);
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && cronSecret.length < 32)
    throw new AppError("CONFIG_INVALID", "后台采集配置暂不可用，请联系管理员。", 503);
  return {
    ...parsed,
    sessionSecret,
    databaseUrl: process.env.DATABASE_URL || "",
    cronSecret,
    builtInDemo,
  };
}
export function getAccountConfig(app: AppConfig, accountId: string) {
  const a = app.accounts.find((account) => account.id === accountId && account.enabled);
  if (!a) throw new AppError("UNAUTHORIZED", "账户访问已停用，请联系管理员。", 401);
  return {
    ACCOUNT_ID: a.id,
    ACCOUNT_LABEL: a.label,
    DATA_SOURCE: a.source,
    BINANCE_ENV: a.environment,
    BINANCE_API_KEY: a.apiKey,
    BINANCE_API_SECRET: a.apiSecret,
    DATABASE_URL: app.databaseUrl,
    symbols: a.symbols,
    costs: a.costs,
    PRINCIPAL_USDT: a.principal,
    PERFORMANCE_BASELINE_USDT: a.performance?.baseline,
    PERFORMANCE_BASELINE_AT: a.performance?.startedAt,
    PERFORMANCE_NET_FLOWS_USDT: a.performance?.netFlows,
  };
}
export type Config = ReturnType<typeof getAccountConfig>;
