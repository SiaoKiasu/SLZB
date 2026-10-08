import { NextResponse } from "next/server";
import {
  authorize,
  authenticatedJson,
  checkOrigin,
  COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth";
import { getAppConfig, DEMO_CONFIG } from "@/lib/config";
import { verifyPassword } from "../../../../scripts/password.mjs";
import { json, failure } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { createHash } from "node:crypto";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
export async function GET(request: Request) {
  try {
    const auth = authorize(request);
    return authenticatedJson(
      {
        authenticated: true,
        demo: auth.app.builtInDemo,
        user: { username: auth.user.username, displayName: auth.user.displayName },
        accountLabel: auth.config.ACCOUNT_LABEL,
      },
      auth,
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 401)
      return json(
        {
          authenticated: false,
          demo: getAppConfig().builtInDemo,
          error: { code: e.code, message: e.message },
        },
        401,
      );
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const app = getAppConfig();
    const key = createHash("sha256")
      .update(request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local")
      .digest("hex");
    const now = Date.now();
    for (const [k, value] of attempts) if (value.until < now) attempts.delete(k);
    if (attempts.size >= 10000 && !attempts.has(key))
      throw new AppError("RATE_LIMIT", "登录请求过多，请稍后重试。", 429);
    const limit = attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (limit.count >= 8)
      throw new AppError("RATE_LIMIT", "尝试次数过多，请在 15 分钟后重试。", 429);
    limit.count++;
    attempts.set(key, limit);
    if (Number(request.headers.get("content-length") ?? 0) > 2048)
      throw new AppError("INVALID_BODY", "请求过大。", 400);
    const body = await request.text();
    if (body.length > 2048) throw new AppError("INVALID_BODY", "请求过大。", 400);
    let username: unknown;
    let password: unknown;
    try {
      ({ username, password } = JSON.parse(body));
    } catch {
      throw new AppError("INVALID_BODY", "请求格式无效。", 400);
    }
    if (typeof username !== "string" || typeof password !== "string" || password.length > 256)
      throw new AppError("INVALID_CREDENTIALS", "用户名或密码不正确。", 401);
    const user = app.users.find((u) => u.username === username.trim().toLowerCase());
    const verified = await verifyPassword(
      password,
      user?.passwordHash ?? DEMO_CONFIG.users[0].passwordHash,
    );
    if (
      !user?.enabled ||
      !verified ||
      !app.accounts.some((a) => a.id === user.accountId && a.enabled)
    )
      throw new AppError("INVALID_CREDENTIALS", "用户名或密码不正确。", 401);
    attempts.delete(key);
    const response = NextResponse.json(
      { ok: true, user: { username: user.username, displayName: user.displayName } },
      { headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(response, app, user);
    return response;
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (e) {
    return failure(e);
  }
}
