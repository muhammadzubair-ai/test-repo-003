import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("dataset stays local and confidential", () => {
  it("gitignores data/, reports/ and .env", () => {
    const root = resolve(".");
    const dataProbe = join(root, "data", ".ads-probe");
    const reportsProbe = join(root, "reports", ".ads-probe");
    const envPath = join(root, ".env");
    const createdEnv = !existsSync(envPath);
    try {
      mkdirSync(join(root, "data"), { recursive: true });
      mkdirSync(join(root, "reports"), { recursive: true });
      writeFileSync(dataProbe, "x");
      writeFileSync(reportsProbe, "x");
      if (createdEnv) writeFileSync(envPath, "# probe only\n");

      const out = execFileSync(
        "git",
        ["check-ignore", "-v", "data/.ads-probe", "reports/.ads-probe", ".env"],
        { cwd: root, encoding: "utf8" },
      );
      expect(out).toMatch(/data\//);
      expect(out).toMatch(/reports\//);
      expect(out).toMatch(/\.env/);
    } finally {
      rmSync(dataProbe, { force: true });
      rmSync(reportsProbe, { force: true });
      if (createdEnv) rmSync(envPath, { force: true });
    }
  });

  it("documents an external Interview Dataset path and no other seed loaders", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");
    expect(readme.toLowerCase()).toContain("outside");
    expect(readme).toMatch(/Interview Dataset/i);

    // No committed seed SQL/CSV/XLSX loaders besides documenting the external import path.
    const seedLike = execFileSync(
      "git",
      ["ls-files", "*.xlsx", "*.csv", "**/seed*.ts", "**/seed*.sql", "**/fixtures/**/*.json"],
      { cwd: resolve("."), encoding: "utf8" },
    ).trim();
    expect(seedLike).toBe("");
  });
});
