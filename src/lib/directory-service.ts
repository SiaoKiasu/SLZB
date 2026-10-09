import "server-only";
import { accountSchema, userSchema, type PortalUser } from "./config-schema";
import { directorySchema, type AdminMutation, type DirectoryView } from "./directory-schema";
import { readDirectory, writeDirectory, type DirectoryState } from "./directory-store";
import { hashPassword } from "../../scripts/password.mjs";
import { AppError } from "./errors";

export function directoryView(state: DirectoryState, administrator: PortalUser): DirectoryView {
  return {
    revision: state.revision,
    administrator: { username: administrator.username, displayName: administrator.displayName },
    accounts: state.directory.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      source: a.source,
      environment: a.environment,
      enabled: a.enabled,
      principal: a.principal ?? null,
      hasCredentials: Boolean(a.apiKey && a.apiSecret),
    })),
    users: state.directory.users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      accountId: u.accountId,
      enabled: u.enabled,
      role: "viewer",
    })),
    audit: [...state.audit].reverse(),
  };
}
export async function mutateDirectory(body: AdminMutation, root: PortalUser) {
  const state = await readDirectory();
  if (state.revision !== body.revision)
    throw new AppError("DIRECTORY_CONFLICT", "配置已更新，请重新加载后再保存。", 409);
  const directory = structuredClone(state.directory);
  let target: string;
  if (body.action === "createAccount" || body.action === "updateAccount") {
    const input = body.account;
    target = input.id;
    const index = directory.accounts.findIndex((a) => a.id === input.id);
    const previous = directory.accounts[index];
    if (body.action === "createAccount" ? Boolean(previous) : !previous)
      throw new AppError("ACCOUNT_CONFLICT", "账户已存在或不存在，请重新加载。", 409);
    if (
      previous &&
      (previous.source !== input.source || previous.environment !== input.environment)
    )
      throw new AppError("INVALID_BODY", "账户类型和网络不可更改，请新建账户。", 400);
    const key = input.apiKey?.trim(),
      secret = input.apiSecret?.trim();
    if (Boolean(key) !== Boolean(secret))
      throw new AppError("INVALID_BODY", "更新 API 时需同时填写 Key 和 Secret。", 400);
    const parsed = accountSchema.safeParse({
      ...previous,
      ...input,
      principal: input.principal ?? undefined,
      apiKey: input.source === "demo" ? "" : key || previous?.apiKey || "",
      apiSecret: input.source === "demo" ? "" : secret || previous?.apiSecret || "",
    });
    if (!parsed.success)
      throw new AppError("INVALID_BODY", "请填写完整有效的账户和 API 配置。", 400);
    if (previous) {
      directory.accounts[index] = parsed.data;
      if (previous.enabled && !parsed.data.enabled)
        for (const u of directory.users) if (u.accountId === input.id) u.sessionVersion++;
    } else directory.accounts.push(parsed.data);
  } else {
    const username = "user" in body ? body.user.username : body.username;
    target = username;
    if (username === root.username)
      throw new AppError("IMMUTABLE_ADMIN", "固定管理员只能通过环境变量配置。", 403);
    const index = directory.users.findIndex((u) => u.username === username);
    const previous = directory.users[index];
    if (body.action === "createUser" ? Boolean(previous) : !previous)
      throw new AppError("USER_CONFLICT", "用户已存在或不存在，请重新加载。", 409);
    if (body.action === "deleteUser") directory.users.splice(index, 1);
    else if (body.action === "revokeSessions") directory.users[index].sessionVersion++;
    else {
      const { password, ...input } = body.user;
      if (!directory.accounts.some((a) => a.id === input.accountId))
        throw new AppError("INVALID_BODY", "请选择已创建的账户。", 400);
      if (!previous && !password) throw new AppError("INVALID_BODY", "新用户需要设置密码。", 400);
      const parsed = userSchema.parse({
        ...input,
        role: "viewer",
        passwordHash: password ? await hashPassword(password) : previous.passwordHash,
        // Every edit revokes existing cookies, including disable then re-enable.
        sessionVersion: (previous?.sessionVersion ?? 0) + 1,
      });
      if (previous) directory.users[index] = parsed;
      else directory.users.push(parsed);
    }
  }
  const checked = directorySchema.safeParse(directory);
  if (!checked.success)
    throw new AppError("INVALID_BODY", "账户或用户配置无效，或已达到数量上限。", 400);
  return writeDirectory(checked.data, state.revision, {
    at: Date.now(),
    by: root.username,
    action: body.action,
    target,
  });
}
