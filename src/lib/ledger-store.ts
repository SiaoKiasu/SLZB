import "server-only";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { Config } from "./config";
import type { TradeLedger } from "./types";
import { accountScope } from "./storage";

type Stored = { revision: string; ledger: TradeLedger };
const memory = new Map<string, Stored>();
const initialized = new Map<string, Promise<void>>();
function sqlFor(c: Config) {
  return neon(c.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(5000) } });
}
async function initialize(c: Config) {
  let ready = initialized.get(c.DATABASE_URL);
  if (!ready) {
    ready = (async () => {
      const sql = sqlFor(c);
      await sql`CREATE TABLE IF NOT EXISTS slzb_trade_ledgers (account_id TEXT PRIMARY KEY, revision TEXT NOT NULL, data JSONB NOT NULL)`;
    })().catch((e) => {
      initialized.delete(c.DATABASE_URL);
      throw e;
    });
    initialized.set(c.DATABASE_URL, ready);
  }
  await ready;
}
function fileFor(c: Config) {
  const hash = createHash("sha256").update(accountScope(c)).digest("hex");
  return resolve(/*turbopackIgnore: true*/ ".slzb", "ledgers", `${hash}.json`);
}
export async function readLedger(c: Config): Promise<Stored | undefined> {
  if (c.DATABASE_URL) {
    await initialize(c);
    const sql = sqlFor(c);
    const rows =
      await sql`SELECT revision, data FROM slzb_trade_ledgers WHERE account_id = ${accountScope(c)}`;
    return rows.length ? { revision: rows[0].revision, ledger: rows[0].data } : undefined;
  }
  if (process.env.VERCEL) return memory.get(accountScope(c));
  try {
    const stored = JSON.parse(
      await readFile(/*turbopackIgnore: true*/ fileFor(c), "utf8"),
    ) as Stored;
    if (stored.ledger.version !== 1 || !stored.ledger.markets) throw new Error("Invalid ledger");
    return stored;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function saveLedger(c: Config, ledger: TradeLedger, previous?: string) {
  const revision = randomUUID();
  const stored = { revision, ledger };
  if (c.DATABASE_URL) {
    await initialize(c);
    const sql = sqlFor(c);
    const rows = previous
      ? await sql`UPDATE slzb_trade_ledgers SET revision = ${revision}, data = ${JSON.stringify(ledger)}::jsonb WHERE account_id = ${accountScope(c)} AND revision = ${previous} RETURNING revision`
      : await sql`INSERT INTO slzb_trade_ledgers (account_id, revision, data) VALUES (${accountScope(c)}, ${revision}, ${JSON.stringify(ledger)}::jsonb) ON CONFLICT DO NOTHING RETURNING revision`;
    // A concurrent function won the update. Reload its ledger on the next sync.
    if (!rows.length) throw new Error("Concurrent ledger update");
  } else if (process.env.VERCEL) memory.set(accountScope(c), stored);
  else {
    const dir = resolve(/*turbopackIgnore: true*/ ".slzb", "ledgers");
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
    const target = fileFor(c);
    const temporary = `${target}.${revision}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ temporary, JSON.stringify(stored), { mode: 0o600 });
    await rename(/*turbopackIgnore: true*/ temporary, /*turbopackIgnore: true*/ target);
  }
}
