import { AppError } from "./errors";
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  // Never serialize upstream errors: fetch/Postgres errors may contain URLs or credentials.
  return json(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试或联系管理员。" } },
    500,
  );
}
