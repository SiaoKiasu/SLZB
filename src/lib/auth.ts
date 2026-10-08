import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppConfig, getAccountConfig, type AppConfig } from "./config";
import type { PortalUser } from "./config-schema";
import { AppError } from "./errors";
export const COOKIE_NAME = "slzb_session";
// Long-lived and renewed after one day of activity. A browser may still clear cookies.
export const SESSION_TTL = 365 * 24 * 60 * 60;
export const RENEW_AFTER = 24 * 60 * 60 * 1000;
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function revision(user: PortalUser) {
  return createHash("sha256")
    .update(JSON.stringify([user.passwordHash, user.accountId, user.sessionVersion, user.role]))
    .digest("base64url");
}
function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
export function createSession(app: AppConfig, user: PortalUser, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ sub: user.username, rev: revision(user), exp: now + SESSION_TTL * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, app.sessionSecret)}`;
}
export function readSession(
  token: string,
  app: AppConfig,
  now = Date.now(),
): { user: PortalUser; expiresAt: number } | null {
  try {
    if (token.length > 2048) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !constantEqual(parts[1], sign(parts[0], app.sessionSecret)))
      return null;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.exp > now + SESSION_TTL * 1000 ||
      typeof payload.sub !== "string"
    )
      return null;
    const user = app.users.find((u) => u.username === payload.sub && u.enabled);
    if (
      !user ||
      payload.rev !== revision(user) ||
      !app.accounts.some((a) => a.id === user.accountId && a.enabled)
    )
      return null;
    return { user, expiresAt: payload.exp };
  } catch {
    return null;
  }
}
export function authorize(request: Request) {
  const app = getAppConfig();
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? "";
  const session = readSession(token, app);
  if (!session) throw new AppError("UNAUTHORIZED", "请登录你的查看账号。", 401);
  return {
    app,
    user: session.user,
    config: getAccountConfig(app, session.user.accountId),
    expiresAt: session.expiresAt,
  };
}
export type AuthContext = ReturnType<typeof authorize>;
export function setSessionCookie(response: NextResponse, app: AppConfig, user: PortalUser) {
  response.cookies.set(COOKIE_NAME, createSession(app, user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL,
  });
}
export function authenticatedJson(data: unknown, auth: AuthContext) {
  const response = NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
  if (auth.expiresAt - Date.now() < SESSION_TTL * 1000 - RENEW_AFTER)
    setSessionCookie(response, auth.app, auth.user);
  return response;
}
export function checkOrigin(request: Request) {
  const target = new URL(request.url);
  let allowed = false;
  try {
    const source = new URL(request.headers.get("origin") ?? "");
    allowed =
      source.host === (request.headers.get("host") ?? target.host) &&
      source.protocol === target.protocol;
  } catch {
    /* absent or malformed origin */
  }
  if (!allowed) throw new AppError("ORIGIN_REJECTED", "请求来源无效。", 403);
}

export function authorizeAdmin(request: Request) {
  const auth = authorize(request);
  if (auth.user.role !== "admin") throw new AppError("FORBIDDEN", "仅管理员可以维护成本。", 403);
  return auth;
}
