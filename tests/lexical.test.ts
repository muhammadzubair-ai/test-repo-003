import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { retrieveLexical } from "../src/api/lexical";

const connectionString = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SKU_PREFIX = "LEXTEST-";

let columns = new Set<string>();

async function ensureCatalogue(): Promise<void> {
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CatalogueSku" (
      "sku" TEXT PRIMARY KEY,
      "nameEn" TEXT NOT NULL,
      "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("nameEn", ''))) STORED
    )
  `);
  const rows = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CatalogueSku'
  `;
  columns = new Set(rows.map((row) => row.column_name));
}

async function insertName(sku: string, nameEn: string): Promise<void> {
  if (columns.has("partNumber")) {
    await db.$executeRaw`
      INSERT INTO "CatalogueSku" (
        "sku", "partNumber", "partNumberNorm", "nameEn", "completeness", "hasFitmentRecord", "qualityFlags"
      ) VALUES (
        ${sku}, ${sku}, ${sku}, ${nameEn}, ${1}, ${false}, ${"{}"}::jsonb
      )
    `;
    return;
  }
  await db.$executeRaw`
    INSERT INTO "CatalogueSku" ("sku", "nameEn") VALUES (${sku}, ${nameEn})
  `;
}

async function removeFixtures(): Promise<void> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PartNumberAlias'
  `;
  if (tables.length > 0) {
    await db.$executeRaw`DELETE FROM "PartNumberAlias" WHERE "sku" LIKE ${`${SKU_PREFIX}%`}`;
  }
  await db.$executeRaw`DELETE FROM "CatalogueSku" WHERE "sku" LIKE ${`${SKU_PREFIX}%`}`;
}

beforeAll(async () => {
  await ensureCatalogue();
});

beforeEach(async () => {
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await db.$disconnect();
});

describe("retrieveLexical", () => {
  it("returns brake-pad names with scores from 0 to 1", async () => {
    await insertName("LEXTEST-pads", "Front brake pads");
    await insertName("LEXTEST-oil", "Oil filter");

    const hits = await retrieveLexical("brake pads", db);
    const bySku = new Map(hits.map((hit) => [hit.sku, hit]));

    expect(bySku.has("LEXTEST-pads")).toBe(true);
    expect(bySku.has("LEXTEST-oil")).toBe(false);
    expect(hits.length).toBeLessThanOrEqual(50);
    expect(hits[0]?.rank).toBe(1);
    for (const hit of hits) {
      expect(hit.lexicalScore).toBeGreaterThanOrEqual(0);
      expect(hit.lexicalScore).toBeLessThanOrEqual(1);
      expect(hit.rank).toBe(hits.indexOf(hit) + 1);
    }
    expect(hits[0]?.lexicalScore).toBeCloseTo(1, 5);
  });

  it("adds trigram matches when full-text returns fewer than 10 rows", async () => {
    await insertName("LEXTEST-exact", "qxbrake qxpads");
    await insertName("LEXTEST-typo", "qxbrake qxpdz");

    const hits = await retrieveLexical("qxbrake qxpads", db);
    const skus = hits.map((hit) => hit.sku);

    expect(skus).toContain("LEXTEST-exact");
    expect(skus).toContain("LEXTEST-typo");
    expect(hits.find((hit) => hit.sku === "LEXTEST-exact")?.rank).toBe(1);
  });

  it("does not add trigram-only rows when full-text already has 10 hits", async () => {
    for (let n = 1; n <= 10; n++) {
      await insertName(`LEXTEST-ft-${String(n).padStart(2, "0")}`, `qxbrake qxpads ${n}`);
    }
    await insertName("LEXTEST-typo", "qxbrake qxpdz");

    const hits = await retrieveLexical("qxbrake qxpads", db);

    expect(hits.some((hit) => hit.sku.startsWith("LEXTEST-ft-"))).toBe(true);
    expect(hits.map((hit) => hit.sku)).not.toContain("LEXTEST-typo");
    expect(hits.length).toBeLessThanOrEqual(50);
  });

  it("returns at most 50 rows", async () => {
    for (let n = 0; n <= 50; n++) {
      await insertName(`LEXTEST-cap-${String(n).padStart(2, "0")}`, `zzlexcap item ${n}`);
    }

    const hits = await retrieveLexical("zzlexcap", db);

    expect(hits).toHaveLength(50);
    expect(hits[0]?.sku).toBe("LEXTEST-cap-00");
    expect(hits[49]?.sku).toBe("LEXTEST-cap-49");
    expect(hits.map((hit) => hit.sku)).not.toContain("LEXTEST-cap-50");
    expect(hits.every((hit) => hit.lexicalScore >= 0 && hit.lexicalScore <= 1)).toBe(true);
  });
});
