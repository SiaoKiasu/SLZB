import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => mock.sql }));
import { readDirectory, writeDirectory } from "@/lib/directory-store";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Neon directory persistence", () => {
  it("persists encrypted data, reloads it and checks SQL revision for concurrent writes", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test-database-only");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("CONFIG_ENCRYPTION_KEY", "22".repeat(32));
    let row: { revision: string; ciphertext: string } | null = null;
    let simulateConflict = false;
    mock.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.join("?");
      if (query.includes("CREATE TABLE")) return [];
      if (query.includes("SELECT")) return row ? [row] : [];
      if (query.includes("INSERT")) {
        expect(query).toContain("ON CONFLICT DO NOTHING");
        if (row) return [];
        row = { revision: values[0] as string, ciphertext: values[1] as string };
        return [{ revision: row.revision }];
      }
      if (query.includes("UPDATE")) {
        expect(query).toContain("AND revision = ?");
        if (simulateConflict || values[2] !== row?.revision) return [];
        row = { revision: values[0] as string, ciphertext: values[1] as string };
        return [{ revision: row.revision }];
      }
      throw new Error("Unexpected SQL");
    });
    const directory = { accounts: [], users: [] };
    expect((await readDirectory()).revision).toBeNull();
    const first = await writeDirectory(directory, null, {
      at: 1,
      by: "root",
      action: "createAccount",
      target: "sensitive-account-id",
    });
    expect(JSON.stringify(row)).not.toContain("sensitive-account-id");
    expect(await readDirectory()).toEqual(first);
    const second = await writeDirectory(directory, first.revision, {
      at: 2,
      by: "root",
      action: "updateAccount",
      target: "account",
    });
    expect(second.revision).not.toBe(first.revision);
    expect(await readDirectory()).toEqual(second);
    simulateConflict = true;
    await expect(
      writeDirectory(directory, second.revision, {
        at: 3,
        by: "root",
        action: "updateAccount",
        target: "account",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readDirectory()).toEqual(second);
  });
});
