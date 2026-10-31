import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/0002_catalogue_aliases_vocabulary/migration.sql"),
  "utf8",
);

describe("catalogue / alias / vocabulary migration", () => {
  it("creates the three tables and required extensions", () => {
    expect(migration).toContain('CREATE TABLE "CatalogueSku"');
    expect(migration).toContain('CREATE TABLE "PartNumberAlias"');
    expect(migration).toContain('CREATE TABLE "VocabularyTerm"');
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });

  it("defines embedding vector(384) with an HNSW cosine index", () => {
    expect(migration).toContain("vector(384)");
    expect(migration).toMatch(/USING hnsw \("embedding" vector_cosine_ops\)/);
  });

  it("defines a generated english tsvector with a GIN index", () => {
    expect(migration).toMatch(/to_tsvector\('english'/);
    expect(migration).toMatch(/USING GIN \("searchVector"\)/);
  });

  it("is idempotent on extensions (IF NOT EXISTS)", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });
});
