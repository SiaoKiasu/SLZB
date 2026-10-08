import { input, password, select } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { portalConfigSchema, accountSchema, userSchema } from "../src/lib/config-schema.ts";
import { hashPassword } from "./password.mjs";
import { costValuesSchema } from "../src/lib/cost-schema.ts";
import { neon } from "@neondatabase/serverless";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const file = resolve(process.env.PORTAL_CONFIG_FILE || ".slzb/accounts.json");
const privateDir = resolve(".slzb");
function privateWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
function envValue(text, name, value) {
  const line = `${name}=${value}`;
  const regex = new RegExp(`^${name}=.*$`, "m");
  return regex.test(text) ? text.replace(regex, () => line) : `${text.trimEnd()}\n${line}\n`;
}
function save(config) {
  const validated = portalConfigSchema.parse(config);
  let env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  const secret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
  if (secret.length < 32) throw new Error("SESSION_SECRET 至少需要 32 位，请先修正 .env.local。");
  privateWrite(file, `${JSON.stringify(validated, null, 2)}\n`);
  process.env.SESSION_SECRET = secret;
  env = envValue(env, "SESSION_SECRET", secret);
  // Keep JSON out of .env parsing: locally the server reads the private file.
  env = envValue(env, "PORTAL_CONFIG_JSON", "");
  env = envValue(env, "PORTAL_CONFIG_FILE", JSON.stringify(file));
  privateWrite(resolve(".env.local"), env);
  console.log(
    "已保存。本地文件中的变更会在下一次请求生效。首次配置请重启 npm run dev；Vercel 需重新导出并部署。",
  );
  return validated;
}
async function newPassword() {
  const first = await password({
    message: "设置查看密码（至少 8 位，不会保存明文）",
    mask: "*",
    validate: (v) => (v.length >= 8 && v.length <= 256) || "密码长度需为 8–256 位",
  });
  await password({
    message: "再次输入密码",
    mask: "*",
    validate: (v) => v === first || "两次密码不一致",
  });
  return hashPassword(first);
}
async function editAccount(old, config) {
  const id =
    old?.id ||
    (await input({
      message: "账户内部 ID（例如 friend-a）",
      validate: (v) =>
        (/^[a-zA-Z0-9_-]{1,64}$/.test(v) && !config.accounts.some((a) => a.id === v)) ||
        "ID 仅支持字母、数字、下划线和短横线，且不能重复",
    }));
  const label = await input({
    message: "显示名称",
    default: old?.label || id,
    validate: (v) => Boolean(v.trim()) || "请输入名称",
  });
  const source = await select({
    message: "数据来源",
    default: old?.source || "binance",
    choices: [
      { name: "Binance 现货", value: "binance" },
      { name: "模拟数据（先测试登录和页面）", value: "demo" },
    ],
  });
  let environment = old?.environment || "mainnet";
  let apiKey = "";
  let apiSecret = "";
  if (source === "binance") {
    environment = await select({
      message: "交易所环境",
      default: environment,
      choices: [
        { name: "主网", value: "mainnet" },
        { name: "Spot Testnet", value: "testnet" },
      ],
    });
    apiKey =
      (await password({
        message: `只读 API Key${old?.apiKey ? "（留空保留）" : ""}`,
        mask: "*",
      })) ||
      old?.apiKey ||
      "";
    apiSecret =
      (await password({
        message: `API Secret${old?.apiSecret ? "（留空保留）" : ""}`,
        mask: "*",
      })) ||
      old?.apiSecret ||
      "";
  }
  const principal = await input({
    message: "账户本金（初始投入 USDT，可留空；不是持仓成本）",
    default: old?.principal,
    validate: (v) => !v || /^\d+(\.\d+)?$/.test(v) || "请输入非负金额，或留空",
  });
  console.log("持仓与交易对将自动发现，成交历史分批同步。币种成本请用管理员账号登录网页维护。");
  return accountSchema.parse({
    id,
    label,
    source,
    environment,
    apiKey,
    apiSecret,
    principal: principal || undefined,
    symbols: old?.symbols || [],
    costs: old?.costs || {},
    performance: old?.performance,
    enabled: old?.enabled ?? true,
  });
}
function load() {
  // In imported environments, edit the effective configuration rather than an obsolete file.
  const raw =
    process.env.PORTAL_CONFIG_JSON || (existsSync(file) ? readFileSync(file, "utf8") : "");
  return raw ? portalConfigSchema.parse(JSON.parse(raw)) : { accounts: [], users: [] };
}
async function exportConfig(config) {
  if (!config.accounts.length || !config.users.length)
    throw new Error("请先创建交易所账户和查看用户。");
  const exported = portalConfigSchema.parse(config);
  for (const account of exported.accounts) {
    const scope = `${account.id}:${account.environment}:${createHash("sha256").update(account.apiKey).digest("hex").slice(0, 24)}`;
    let costs;
    if (process.env.DATABASE_URL) {
      const sql = neon(process.env.DATABASE_URL, {
        fetchOptions: { signal: AbortSignal.timeout(5000) },
      });
      try {
        const rows = await sql`SELECT data FROM slzb_cost_settings WHERE account_id = ${scope}`;
        if (rows.length) costs = rows[0].data.costs;
      } catch (e) {
        if (e?.code !== "42P01") throw e;
      }
    } else {
      const costFile = resolve(
        privateDir,
        "costs",
        `${createHash("sha256").update(scope).digest("hex")}.json`,
      );
      if (existsSync(costFile)) costs = JSON.parse(readFileSync(costFile, "utf8")).costs;
    }
    if (costs) account.costs = costValuesSchema.parse(costs);
  }
  const data = JSON.stringify(exported);
  if (Buffer.byteLength(data) > 60000)
    throw new Error("配置体积过大，请缩小配置或改为独立数据库管理。");
  privateWrite(resolve(privateDir, "vercel-config.json"), data);
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("请先运行 npm run setup 生成 SESSION_SECRET。");
  privateWrite(resolve(privateDir, "session-secret.txt"), secret);
  console.log(
    "已生成 .slzb/vercel-config.json 和 .slzb/session-secret.txt。\n在 Vercel 分别设置 PORTAL_CONFIG_JSON 和 SESSION_SECRET，值为对应文件的完整内容，然后 Redeploy。\n这些文件含私密配置，已被 .gitignore 排除；只给朋友网址、用户名和密码。",
  );
}
async function main() {
  let config = load();
  if (process.argv.includes("--check")) {
    console.log(`配置格式有效：${config.accounts.length} 个账户，${config.users.length} 个用户。`);
    return;
  }
  if (process.argv.includes("--export")) {
    await exportConfig(config);
    return;
  }
  console.log("SLZB 管理员配置 · 朋友无需操作本工具\n");
  if (process.env.PORTAL_CONFIG_JSON)
    console.log(
      "当前已读取 PORTAL_CONFIG_JSON；修改将保存到本地配置文件。若从 shell 设置该变量，请在启动本地服务前取消它。",
    );
  while (true) {
    const action = await select({
      message: "选择操作",
      choices: [
        { name: "1. 新增交易所账户 / API", value: "account-add" },
        { name: "2. 修改交易所账户 / API / 本金", value: "account-edit" },
        { name: "3. 新增查看用户并绑定账户", value: "user-add" },
        { name: "4. 修改用户密码", value: "password" },
        { name: "5. 更改用户绑定的账户", value: "binding" },
        { name: "6. 停用 / 启用查看用户", value: "enabled" },
        { name: "7. 撤销某个用户的全部登录", value: "revoke" },
        { name: "8. 导出 Vercel 配置", value: "export" },
        { name: "9. 设置用户角色（管理员 / 只读查看）", value: "role" },
        { name: "完成 / 退出", value: "exit" },
      ],
    });
    if (action === "exit") break;
    try {
      if (action === "export") {
        await exportConfig(config);
        continue;
      }
      // Work on a copy so cancelled or invalid input cannot corrupt the next operation.
      const next = structuredClone(config);
      if (action === "account-add") next.accounts.push(await editAccount(undefined, next));
      else if (action === "account-edit") {
        if (!next.accounts.length) {
          console.log("请先新增账户。");
          continue;
        }
        const id = await select({
          message: "修改哪个账户？",
          choices: next.accounts.map((a) => ({ name: `${a.label} (${a.id})`, value: a.id })),
        });
        const i = next.accounts.findIndex((a) => a.id === id);
        next.accounts[i] = await editAccount(next.accounts[i], next);
      } else if (action === "user-add") {
        if (!next.accounts.some((a) => a.enabled)) {
          console.log("请先新增可用账户。");
          continue;
        }
        const username = (
          await input({
            message: "查看用户名（至少 3 位英文/数字，可含 _ . -）",
            validate: (v) =>
              (/^[a-z0-9_.-]{3,64}$/.test(v.trim().toLowerCase()) &&
                !next.users.some((u) => u.username === v.trim().toLowerCase())) ||
              "用户名格式不正确或已存在",
          })
        )
          .trim()
          .toLowerCase();
        const displayName = await input({ message: "用户显示名称", default: username });
        const accountId = await select({
          message: "此用户可以查看哪个账户？",
          choices: next.accounts
            .filter((a) => a.enabled)
            .map((a) => ({ name: `${a.label} (${a.id})`, value: a.id })),
        });
        const role = await select({
          message: "用户角色",
          default: "viewer",
          choices: [
            { name: "只读查看（朋友使用）", value: "viewer" },
            { name: "管理员（可管理所有账户成本）", value: "admin" },
          ],
        });
        next.users.push(
          userSchema.parse({
            username,
            displayName,
            accountId,
            role,
            passwordHash: await newPassword(),
          }),
        );
      } else {
        if (!next.users.length) {
          console.log("请先新增查看用户。");
          continue;
        }
        const username = await select({
          message: "选择用户",
          choices: next.users.map((u) => ({
            name: `${u.username} → ${u.accountId}${u.enabled ? "" : "（已停用）"}`,
            value: u.username,
          })),
        });
        const user = next.users.find((u) => u.username === username);
        if (action === "role")
          user.role = await select({
            message: "设置角色（变更后需要重新登录）",
            default: user.role,
            choices: [
              { name: "只读查看", value: "viewer" },
              { name: "管理员：可管理所有账户成本", value: "admin" },
            ],
          });
        if (action === "password") user.passwordHash = await newPassword();
        if (action === "binding")
          user.accountId = await select({
            message: "重新绑定账户（旧登录会失效）",
            choices: next.accounts
              .filter((a) => a.enabled)
              .map((a) => ({ name: `${a.label} (${a.id})`, value: a.id })),
          });
        if (action === "enabled") user.enabled = !user.enabled;
        user.sessionVersion++;
      }
      config = save(next);
      console.log(`当前 ${config.accounts.length} 个账户、${config.users.length} 个用户。`);
    } catch (e) {
      if (e?.name === "ExitPromptError") return;
      console.error(
        e?.issues
          ? `未保存，请检查：${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；")}`
          : "未保存，请检查输入和文件权限后重试。",
      );
    }
  }
}
main().catch((e) => {
  if (e?.name === "ExitPromptError") return;
  console.error("管理工具无法完成操作，请检查本地配置格式、SESSION_SECRET 和文件权限。");
  process.exitCode = 1;
});
