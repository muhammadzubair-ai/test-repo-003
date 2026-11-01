import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("code layers", () => {
  it("keeps web, api, db, infra and tests folders, with src/db reusing src/lib/db.ts", () => {
    for (const path of ["src/web", "src/api", "src/db", "infra", "tests"]) {
      expect(existsSync(resolve(path)), path).toBe(true);
    }
    expect(existsSync(resolve("src/db/index.ts"))).toBe(true);
    expect(existsSync(resolve("src/lib/db.ts"))).toBe(true);
  });

  it("fails lint when a file in src/web imports from src/db", () => {
    const fixture = resolve("src/web/__lint_fixtures__/forbidden-db-import.ts");
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [
          resolve("node_modules/eslint/bin/eslint.js"),
          "--no-ignore",
          fixture,
        ],
        { stdio: "pipe" },
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
