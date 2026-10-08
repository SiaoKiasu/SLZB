import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixture } from "./helpers";
describe("administrator export", () => {
  it("exports validated private configuration without printing credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "slzb-admin-test-"));
    try {
      const config = fixture();
      const secret = "export-test-session-secret-over-thirty-two-characters";
      const output = execFileSync(process.execPath, [resolve("scripts/manage.mjs"), "--export"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PORTAL_CONFIG_JSON: JSON.stringify(config), SESSION_SECRET: secret },
      });
      const exported = JSON.parse(readFileSync(join(dir, ".slzb/vercel-config.json"), "utf8"));
      expect(exported.users[0].accountId).toBe("alice-account");
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
