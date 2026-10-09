import "server-only";
import { getAppConfig, type AppConfig } from "./config";
import { userSchema } from "./config-schema";
import { readDirectory } from "./directory-store";
import { AppError } from "./errors";

export function managedMode() {
  // A partially configured administrator must fail closed, never enable demo access.
  return Boolean(
    process.env.ADMIN_USERNAME ||
    process.env.ADMIN_PASSWORD_HASH ||
    process.env.CONFIG_ENCRYPTION_KEY,
  );
}
export async function loadAppConfig(): Promise<AppConfig> {
  if (!managedMode()) return getAppConfig();
  const root = userSchema.safeParse({
    username: process.env.ADMIN_USERNAME,
    displayName: process.env.ADMIN_DISPLAY_NAME || "管理员",
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    accountId: "root",
    role: "admin",
    enabled: true,
    sessionVersion: 1,
  });
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!root.success || sessionSecret.length < 32 || (cronSecret && cronSecret.length < 32))
    throw new AppError("CONFIG_INVALID", "管理员环境变量配置不完整。", 503);
  const state = await readDirectory();
  // Root can never be shadowed or modified by database records.
  if (state.directory.users.some((u) => u.username === root.data.username))
    throw new AppError("CONFIG_INVALID", "管理员用户名与查看用户重复。", 503);
  return {
    ...state.directory,
    users: [root.data, ...state.directory.users],
    sessionSecret,
    cronSecret,
    databaseUrl: process.env.DATABASE_URL || "",
    builtInDemo: false,
    managed: true,
  };
}
