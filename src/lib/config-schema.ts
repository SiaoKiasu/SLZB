import { z } from "zod";
const amount = z.string().regex(/^\d+(\.\d+)?$/);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const passwordHashPattern = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
export const accountSchema = z
  .object({
    id: identifier,
    label: z.string().min(1).max(60),
    source: z.enum(["demo", "binance"]).default("binance"),
    environment: z.enum(["mainnet", "testnet"]).default("mainnet"),
    enabled: z.boolean().default(true),
    apiKey: z.string().default(""),
    apiSecret: z.string().default(""),
    symbols: z
      .array(z.string().regex(/^[A-Z0-9]{5,30}$/))
      .max(20)
      .default([]),
    principal: amount.optional(),
    costs: z.record(z.string().regex(/^[A-Z0-9]+$/), amount).default({}),
    performance: z
      .object({
        baseline: amount,
        startedAt: z.iso
          .datetime({ offset: true })
          .refine((v) => Date.parse(v) <= Date.now(), "起始时间不能是未来"),
        netFlows: z.string().regex(/^-?\d+(\.\d+)?$/),
      })
      .optional(),
  })
  .superRefine((account, ctx) => {
    if (account.source === "binance" && (!account.apiKey || !account.apiSecret))
      ctx.addIssue({ code: "custom", path: ["apiKey"], message: "真实账户需要 API Key 和 Secret" });
    if (new Set(account.symbols).size !== account.symbols.length)
      ctx.addIssue({ code: "custom", path: ["symbols"], message: "交易对不能重复" });
  });
export const userSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,64}$/),
  displayName: z.string().min(1).max(60),
  passwordHash: z.string().regex(passwordHashPattern),
  accountId: identifier,
  enabled: z.boolean().default(true),
  sessionVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
});
export const portalConfigSchema = z
  .object({ accounts: z.array(accountSchema).max(20), users: z.array(userSchema).max(100) })
  .superRefine((config, ctx) => {
    if (new Set(config.accounts.map((a) => a.id)).size !== config.accounts.length)
      ctx.addIssue({ code: "custom", path: ["accounts"], message: "账户 ID 重复" });
    if (new Set(config.users.map((u) => u.username)).size !== config.users.length)
      ctx.addIssue({ code: "custom", path: ["users"], message: "用户名重复" });
    for (let i = 0; i < config.users.length; i++)
      if (!config.accounts.some((a) => a.id === config.users[i].accountId))
        ctx.addIssue({
          code: "custom",
          path: ["users", i, "accountId"],
          message: "绑定的账户不存在",
        });
  });
export type PortalUser = z.infer<typeof userSchema>;
export type AccountSettings = z.infer<typeof accountSchema>;
