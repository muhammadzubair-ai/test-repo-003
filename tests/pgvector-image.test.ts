import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PGVECTOR_IMAGE = "pgvector/pgvector:pg16";

describe("Postgres uses the free pgvector image", () => {
  it("compose.yml starts from pgvector/pgvector:pg16", () => {
    const compose = readFileSync(resolve("compose.yml"), "utf8");
    expect(compose).toContain(`image: ${PGVECTOR_IMAGE}`);
    expect(compose).not.toMatch(/image:\s*postgres:\d+/);
  });

  it("CI Postgres service uses pgvector/pgvector:pg16", () => {
    const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain(`image: ${PGVECTOR_IMAGE}`);
    expect(ci).not.toMatch(/image:\s*postgres:\d+/);
  });
});
