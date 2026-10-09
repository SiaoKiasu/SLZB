import { authorizeOwner, authenticatedJson, checkOrigin } from "@/lib/auth";
import { readDirectory } from "@/lib/directory-store";
import { directoryView, mutateDirectory } from "@/lib/directory-service";
import { adminMutationSchema } from "@/lib/directory-schema";
import { AppError } from "@/lib/errors";
import { failure } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await authorizeOwner(request);
    return authenticatedJson(directoryView(await readDirectory(), auth.user), auth);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const auth = await authorizeOwner(request);
    checkOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 10000)
      throw new AppError("INVALID_BODY", "请求过大。", 400);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 10000) throw new AppError("INVALID_BODY", "请求过大。", 400);
    let parsed;
    try {
      parsed = adminMutationSchema.parse(JSON.parse(raw));
    } catch {
      throw new AppError("INVALID_BODY", "配置格式无效，请检查必填项。", 400);
    }
    return authenticatedJson(
      directoryView(await mutateDirectory(parsed, auth.user), auth.user),
      auth,
    );
  } catch (e) {
    return failure(e);
  }
}
