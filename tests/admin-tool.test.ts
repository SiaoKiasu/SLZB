import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fixture } from "./helpers";
describe("administrator export", () => {
  it("exports validated private configuration without printing credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "slzb-admin-test-"));
    try {
      const config = fixture();
      const scope = `alice-account:mainnet:${createHash("sha256").update("alice-key").digest("hex").slice(0, 24)}`;
      mkdirSync(join(dir, ".slzb/costs"), { recursive: true });
      writeFileSync(
        join(dir, ".slzb/costs", `${createHash("sha256").update(scope).digest("hex")}.json`),
        JSON.stringify({ costs: { BTC: "59000", 牛来: "0.07453" } }),
      );
      const secret = "export-test-session-secret-over-thirty-two-characters";
      const output = execFileSync(process.execPath, [resolve("scripts/manage.mjs"), "--export"], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PORTAL_CONFIG_JSON: JSON.stringify(config),
          SESSION_SECRET: secret,
          DATABASE_URL: "",
        },
      });
      const exported = JSON.parse(readFileSync(join(dir, ".slzb/vercel-config.json"), "utf8"));
      expect(exported.users[0].accountId).toBe("alice-account");
      expect(exported.accounts[0].costs).toEqual({ BTC: "59000", 牛来: "0.07453" });
      expect(exported.users[0].role).toBe("viewer");
      expect(exported.accounts[1].apiKey).toBe("bob-key");
      expect(readFileSync(join(dir, ".slzb/session-secret.txt"), "utf8")).toBe(secret);
      expect(output).not.toContain(secret);
      expect(output).not.toContain("bob-secret");
      expect(statSync(join(dir, ".slzb/vercel-config.json")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
