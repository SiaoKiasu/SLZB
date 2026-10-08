import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
const amount = z.string().regex(/^\d+(\.\d+)?$/);
const signedAmount = z.string().regex(/^-?\d+(\.\d+)?$/);
const schema = z.object({
  DATA_SOURCE: z.enum(["demo", "binance"]).default("demo"),
  ACCOUNT_LABEL: z.string().min(1).max(60).default("我的现货账户"),
  ACCOUNT_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .default("main"),
  BINANCE_ENV: z.enum(["mainnet", "testnet"]).default("mainnet"),
  BINANCE_API_KEY: z.string().default(""),
  BINANCE_API_SECRET: z.string().default(""),
  TRACKED_SYMBOLS: z.string().default("BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT"),
  PORTAL_PASSWORD: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  MONITOR_API_TOKEN: z.string().default(""),
  DATABASE_URL: z.string().default(""),
  CRON_SECRET: z.string().default(""),
  PERFORMANCE_BASELINE_USDT: amount.optional(),
  PERFORMANCE_BASELINE_AT: z.iso.datetime({ offset: true }).optional(),
  PERFORMANCE_NET_FLOWS_USDT: signedAmount.optional(),
  COST_BASIS_JSON: z.string().default("{}"),
});
export function getConfig() {
  const raw = { ...process.env };
  for (const key of [
    "PERFORMANCE_BASELINE_USDT",
    "PERFORMANCE_BASELINE_AT",
    "PERFORMANCE_NET_FLOWS_USDT",
  ])
    if (!raw[key]) delete raw[key];
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      "CONFIG_INVALID",
      `环境变量格式错误：${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      503,
    );
  const c = parsed.data;
  const symbols = [
    ...new Set(
      c.TRACKED_SYMBOLS.split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (symbols.length > 20 || symbols.some((s) => !/^[A-Z0-9]{5,30}$/.test(s)))
    throw new AppError("CONFIG_INVALID", "TRACKED_SYMBOLS 应为最多 20 个逗号分隔的交易对。", 503);
  if (c.DATA_SOURCE === "binance" && (!c.BINANCE_API_KEY || !c.BINANCE_API_SECRET))
    throw new AppError("CONFIG_MISSING", "请在服务端配置 Binance API Key 和 Secret。", 503);
  if (
    (c.DATA_SOURCE === "binance" || c.PORTAL_PASSWORD) &&
    (c.PORTAL_PASSWORD.length < 12 || c.SESSION_SECRET.length < 32)
  )
    throw new AppError(
      "AUTH_CONFIG",
      "请配置至少 12 位的 PORTAL_PASSWORD 和至少 32 位的 SESSION_SECRET。",
      503,
    );
  for (const k of ["MONITOR_API_TOKEN", "CRON_SECRET"] as const)
    if (c[k] && c[k].length < 32)
      throw new AppError("CONFIG_INVALID", `${k} 至少需要 32 位。`, 503);
  let costs: Record<string, string>;
  try {
    costs = z.record(z.string().regex(/^[A-Z0-9]+$/), amount).parse(JSON.parse(c.COST_BASIS_JSON));
  } catch {
    throw new AppError(
      "CONFIG_INVALID",
      'COST_BASIS_JSON 应为币种到成本字符串的 JSON，例如 {"BTC":"58000"}。',
      503,
    );
  }
  const perf = [
    c.PERFORMANCE_BASELINE_USDT,
    c.PERFORMANCE_BASELINE_AT,
    c.PERFORMANCE_NET_FLOWS_USDT,
  ];
  if (perf.some((v) => v !== undefined) && !perf.every((v) => v !== undefined))
    throw new AppError(
      "CONFIG_INVALID",
      "累计盈亏需要同时设置起始净值、起始时间和期间净入金。",
      503,
    );
  if (c.PERFORMANCE_BASELINE_AT && Date.parse(c.PERFORMANCE_BASELINE_AT) > Date.now())
    throw new AppError("CONFIG_INVALID", "盈亏起始时间不能晚于当前时间。", 503);
  return { ...c, symbols, costs };
}
export type Config = ReturnType<typeof getConfig>;
