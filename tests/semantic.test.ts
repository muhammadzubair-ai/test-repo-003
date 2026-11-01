import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { embedQuery, retrieveSemantic } from "../src/api/semantic";

const connectionString = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "SEMTEST-";

let columns = new Set<string>();

function unitVector(seed: number): number[] {
  const values: number[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < 384; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    values.push(state / 0xffffffff - 0.5);
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}

async function ensureCatalogue(): Promise<void> {
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CatalogueSku" (
      "sku" TEXT PRIMARY KEY,
      "nameEn" TEXT NOT NULL,
      embedding vector(384)
    )
  `);
  const rows = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CatalogueSku'
  `;
  columns = new Set(rows.map((row) => row.column_name));
}

async function insertEmbedding(sku: string, nameEn: string, embedding: number[]): Promise<void> {
  const literal = `[${embedding.join(",")}]`;
  if (columns.has("partNumber")) {
    await db.$executeRaw`
      INSERT INTO "CatalogueSku" (
        "sku", "partNumber", "partNumberNorm", "nameEn", "completeness", "hasFitmentRecord", "qualityFlags", embedding
      ) VALUES (
        ${sku}, ${sku}, ${sku}, ${nameEn}, ${1}, ${false}, ${"{}"}::jsonb, ${literal}::vector
      )
    `;
    return;
  }
  await db.$executeRaw`
    INSERT INTO "CatalogueSku" ("sku", "nameEn", embedding)
    VALUES (${sku}, ${nameEn}, ${literal}::vector)
  `;
}

async function removeFixtures(): Promise<void> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'PartNumberAlias'
  `;
  if (tables.length > 0) {
    await db.$executeRaw`DELETE FROM "PartNumberAlias" WHERE "sku" LIKE ${`${PREFIX}%`}`;
  }
  await db.$executeRaw`DELETE FROM "CatalogueSku" WHERE "sku" LIKE ${`${PREFIX}%`}`;
}

beforeAll(async () => {
  await ensureCatalogue();
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await db.$disconnect();
});

describe("retrieveSemantic", () => {
  it("returns brake pad SKUs for 'stopping noise', which shares no word with Brake Pad", async () => {
    const brake = await embedQuery("Brake Pad");
    const plug = await embedQuery("Spark Plug");
    await insertEmbedding("SEMTEST-pads", "Brake Pad", brake);
    await insertEmbedding("SEMTEST-plug", "Spark Plug", plug);
    for (let n = 0; n < 55; n++) {
      await insertEmbedding(`SEMTEST-noise-${String(n).padStart(2, "0")}`, `noise ${n}`, unitVector(n + 1));
    }

    const hits = await retrieveSemantic("stopping noise", db);
    const pads = hits.find((hit) => hit.sku === "SEMTEST-pads");
    const spark = hits.find((hit) => hit.sku === "SEMTEST-plug");

    expect(hits.length).toBeLessThanOrEqual(50);
    expect(pads).toBeDefined();
    expect(pads!.rank).toBeLessThan(spark?.rank ?? 51);
    expect(hits[0]?.rank).toBe(1);
    expect("stopping noise".split(/\s+/).some((word) => "brake pad".includes(word))).toBe(false);
  });
});
