import { input, password, confirm } from "@inquirer/prompts";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { hashPassword } from "./password.mjs";

// Generates bootstrap environment values only. Accounts and users are created in the portal.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const directory = resolve(".slzb");
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = resolve(directory, "admin-env.txt");
if (
  existsSync(output) &&
  !(await confirm({
    message: "管理员初始化文件已存在，重新生成？现有加密密钥会保留。",
    default: false,
  }))
)
  process.exit(0);
const previous = existsSync(output)
  ? Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    )
  : {};
const username = await input({
  message: "固定管理员用户名",
  default: process.env.ADMIN_USERNAME || previous.ADMIN_USERNAME || "admin",
  validate: (v) =>
    /^[a-z0-9_.-]{3,64}$/.test(v) || "使用 3–64 位小写英文、数字、下划线、点或短横线。",
});
const secret = await password({
  message: "管理员登录密码",
  mask: true,
  validate: (v) => (v.length >= 8 && v.length <= 256) || "密码应为 8–256 位。",
});
await password({
  message: "再次输入密码",
  mask: true,
  validate: (v) => v === secret || "两次密码不一致。",
});
const values = {
  ADMIN_USERNAME: username,
  ADMIN_PASSWORD_HASH: await hashPassword(secret),
  SESSION_SECRET:
    process.env.SESSION_SECRET || previous.SESSION_SECRET || randomBytes(32).toString("hex"),
  CONFIG_ENCRYPTION_KEY:
    process.env.CONFIG_ENCRYPTION_KEY ||
    previous.CONFIG_ENCRYPTION_KEY ||
    randomBytes(32).toString("hex"),
};
if (values.SESSION_SECRET.length < 32 || !/^[a-fA-F0-9]{64}$/.test(values.CONFIG_ENCRYPTION_KEY)) {
  throw new Error("现有 SESSION_SECRET 或 CONFIG_ENCRYPTION_KEY 格式无效，请检查后重试。");
}
await writeFile(
  output,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
await chmod(output, 0o600);
const localOutput = resolve(directory, "admin-local.env");
await writeFile(
  localOutput,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v.replaceAll("$", "\\$")}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
await chmod(localOutput, 0o600);
console.log(`已生成：${output}`);
console.log(
  "Vercel：将文件中的 4 项分别填入环境变量，并连接 Neon 数据库设置 DATABASE_URL，然后重新部署一次。",
);
console.log(
  "本地：将 .slzb/admin-local.env 的 4 项合并到 .env.local，然后重启 npm run dev。新后台从空目录开始，不自动导入旧配置。",
);
console.log("后续用户、API、账户本金和成本均在网页维护，无需重新导出或部署。请保留加密密钥备份。");
