import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { directorySchema, type Directory } from "./directory-schema";
import { AppError } from "./errors";

const auditSchema = z.object({
  at: z.number(),
  by: z.string(),
  action: z.string(),
  target: z.string(),
});
const stateSchema = z.object({
  revision: z.string().uuid().nullable(),
  directory: directorySchema,
  audit: z.array(auditSchema).max(100),
});
export type DirectoryState = z.infer<typeof stateSchema>;
const empty = (): DirectoryState => ({
  revision: null,
  directory: { accounts: [], users: [] },
  audit: [],
});
const conflict = () => new AppError("DIRECTORY_CONFLICT", "配置已更新，请重新加载后再保存。", 409);
const ready = new Map<string, Promise<void>>();
function encryptionKey() {
  const value = process.env.CONFIG_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new AppError("CONFIG_INVALID", "请配置 CONFIG_ENCRYPTION_KEY（64 位十六进制）。", 503);
  return Buffer.from(value, "hex");
}
// Bind authenticated ciphertext to this application and schema version.
const aad = Buffer.from("linden-directory:v1");
function seal(state: DirectoryState) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
function unseal(value: string): DirectoryState {
  try {
    const [version, iv, tag, data, extra] = value.split(".");
    if (version !== "v1" || extra || !data) throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
    return stateSchema.parse(JSON.parse(plain.toString("utf8")));
  } catch {
    throw new AppError("DIRECTORY_UNREADABLE", "账户配置无法读取，请检查数据库与加密密钥。", 503);
  }
}
function localFile() {
  return resolve(/*turbopackIgnore: true*/ process.env.ADMIN_STORE_FILE || ".slzb/directory.enc");
}
function checkStorage() {
  encryptionKey();
  if (process.env.VERCEL && !process.env.DATABASE_URL)
    throw new AppError("STORAGE_REQUIRED", "管理后台需要先配置 DATABASE_URL。", 503);
}
async function database() {
  const url = process.env.DATABASE_URL!;
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(8000) } });
  if (!ready.has(url))
    ready.set(
      url,
      (async () => {
        await sql`CREATE TABLE IF NOT EXISTS linden_directory (id TEXT PRIMARY KEY, revision TEXT NOT NULL, ciphertext TEXT NOT NULL)`;
      })().catch((e) => {
        ready.delete(url);
        throw e;
      }),
    );
  await ready.get(url);
  return sql;
}
export async function readDirectory(): Promise<DirectoryState> {
  checkStorage();
  if (process.env.DATABASE_URL) {
    const sql = await database();
    const rows = await sql`SELECT revision, ciphertext FROM linden_directory WHERE id = 'main'`;
    if (!rows.length) return empty();
    const state = unseal(rows[0].ciphertext);
    if (state.revision !== rows[0].revision) throw new Error("Directory revision mismatch");
    return state;
  }
  try {
    return unseal(await readFile(/*turbopackIgnore: true*/ localFile(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw e;
  }
}
export async function writeDirectory(
  directory: Directory,
  revision: string | null,
  event: z.infer<typeof auditSchema>,
): Promise<DirectoryState> {
  checkStorage();
  directorySchema.parse(directory);
  let release: (() => Promise<void>) | undefined;
  if (!process.env.DATABASE_URL) {
    const file = localFile();
    await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`;
    try {
      const handle = await open(/*turbopackIgnore: true*/ lock, "wx", 0o600);
      release = async () => {
        await handle.close();
        await unlink(/*turbopackIgnore: true*/ lock);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw conflict();
      throw e;
    }
  }
  try {
    const current = await readDirectory();
    if (current.revision !== revision) throw conflict();
    const next: DirectoryState = {
      revision: randomUUID(),
      directory,
      audit: [...current.audit, event].slice(-100),
    };
    const ciphertext = seal(next);
    if (process.env.DATABASE_URL) {
      const sql = await database();
      const rows = revision
        ? await sql`UPDATE linden_directory SET revision = ${next.revision}, ciphertext = ${ciphertext} WHERE id = 'main' AND revision = ${revision} RETURNING revision`
        : await sql`INSERT INTO linden_directory (id, revision, ciphertext) VALUES ('main', ${next.revision}, ${ciphertext}) ON CONFLICT DO NOTHING RETURNING revision`;
      if (!rows.length) throw conflict();
    } else {
      const target = localFile(),
        temp = `${target}.${next.revision}.tmp`;
      try {
        await writeFile(/*turbopackIgnore: true*/ temp, ciphertext, { mode: 0o600 });
        await rename(/*turbopackIgnore: true*/ temp, /*turbopackIgnore: true*/ target);
      } finally {
        await unlink(/*turbopackIgnore: true*/ temp).catch(() => {});
      }
    }
    return next;
  } finally {
    await release?.();
  }
}
