import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import { AppError } from "./errors";
export const COOKIE_NAME = "slzb_session";
export const SESSION_TTL = 60 * 60 * 12;
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function sign(payload: string, secret: string, password: string) {
  return createHmac("sha256", secret).update(`${payload}:${password}`).digest("base64url");
}
export function createSession(secret: string, password: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL * 1000 })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret, password)}`;
}
export function validSession(token: string, secret: string, password: string, now = Date.now()) {
  try {
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !secret ||
      !password ||
      !constantEqual(parts[1], sign(parts[0], secret, password))
    )
      return false;
    const { exp } = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return typeof exp === "number" && exp > now && exp <= now + SESSION_TTL * 1000;
  } catch {
    return false;
  }
}
export function authorize(request: Request) {
  const c = getConfig();
  if (!c.PORTAL_PASSWORD && c.DATA_SOURCE === "demo") return c;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (c.MONITOR_API_TOKEN && constantEqual(bearer, c.MONITOR_API_TOKEN)) return c;
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? "";
  if (!validSession(token, c.SESSION_SECRET, c.PORTAL_PASSWORD))
    throw new AppError("UNAUTHORIZED", "请先登录账户监控。", 401);
  return c;
}
export function checkOrigin(request: Request) {
  // Bearer clients do not rely on ambient cookies and are exempt from browser CSRF checks.
  const c = getConfig();
  if (
    c.MONITOR_API_TOKEN &&
    constantEqual(request.headers.get("authorization") ?? "", `Bearer ${c.MONITOR_API_TOKEN}`)
  )
    return;
  const origin = request.headers.get("origin");
  // Next may normalize request.url to localhost internally. The actual Host
  // header still identifies the origin that received the browser request.
  const target = new URL(request.url);
  let allowed = false;
  try {
    const source = new URL(origin ?? "");
    allowed =
      source.host === (request.headers.get("host") ?? target.host) &&
      source.protocol === target.protocol;
  } catch {
    /* malformed or absent Origin */
  }
  if (!allowed) throw new AppError("ORIGIN_REJECTED", "请求来源无效。", 403);
}
