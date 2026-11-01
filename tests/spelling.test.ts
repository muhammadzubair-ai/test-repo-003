import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  chooseCorrection,
  correctQuery,
  correctSpelling,
  damerauLevenshtein,
  type VocabularyTerm,
} from "../src/api/query/spelling";

const vocabulary: VocabularyTerm[] = [
  { term: "front", frequency: 4 },
  { term: "brake", frequency: 5 },
  { term: "brakes", frequency: 1 },
  { term: "pads", frequency: 3 },
  { term: "filter", frequency: 2 },
];

const candidatesFor = (token: string): readonly VocabularyTerm[] => {
  const key = token.toLowerCase();
  if (key === "frnt") return [vocabulary[0], vocabulary[4]];
  if (key === "brak") return [vocabulary[1], vocabulary[2]];
  return vocabulary;
};

describe("chooseCorrection", () => {
  it("prefers the smaller distance and then the higher frequency", () => {
    expect(damerauLevenshtein("frnt", "front")).toBe(1);
    expect(chooseCorrection("brak", [
      { term: "brake", frequency: 1 },
      { term: "brakes", frequency: 9 },
    ])).toBe("brake");
    expect(chooseCorrection("cot", [
      { term: "cat", frequency: 1 },
      { term: "cut", frequency: 4 },
    ])).toBe("cut");
  });

  it("rejects a longer edit than the token length allows", () => {
    expect(chooseCorrection("frntx", [{ term: "front", frequency: 5 }])).toBeNull();
    expect(chooseCorrection("braikke", [{ term: "brake", frequency: 5 }])).toBe("brake");
  });
});

describe("correctQuery", () => {
  it("corrects 'frnt brak pads' to 'front brake pads' and records spelling interpretations", () => {
    const result = correctQuery("frnt brak pads", vocabulary, candidatesFor);

    expect(result.text).toBe("front brake pads");
    expect(result.interpretations).toEqual([
      { kind: "spelling", token: "frnt", correction: "front" },
      { kind: "spelling", token: "brak", correction: "brake" },
    ]);
  });

  it("leaves a digit token and a known word unchanged", () => {
    const result = correctQuery("w205 brak pads", vocabulary, candidatesFor);

    expect(result.text).toBe("w205 brake pads");
    expect(result.interpretations.map((item) => item.token)).toEqual(["brak"]);
    expect(correctQuery("0986 494 104", vocabulary, candidatesFor)).toEqual({
      text: "0986 494 104",
      interpretations: [],
    });
    expect(correctQuery("front pads", vocabulary, candidatesFor).text).toBe("front pads");
  });

  it("does not correct an abbreviation that was already expanded", () => {
    const result = correctQuery("ac frnt pads", vocabulary, candidatesFor);

    expect(result.text).toBe("ac front pads");
    expect(result.interpretations).toEqual([{ kind: "spelling", token: "frnt", correction: "front" }]);
  });
});

const connectionString = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const inserted: string[] = [];

async function ensureVocabulary(): Promise<void> {
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "VocabularyTerm" (
      term TEXT PRIMARY KEY,
      frequency INTEGER NOT NULL,
      source TEXT NOT NULL
    )
  `);
  for (const term of ["front", "brake", "pads"]) {
    const existing = await db.$queryRaw<{ term: string }[]>`
      SELECT term FROM "VocabularyTerm" WHERE term = ${term}
    `;
    if (existing.length > 0) continue;
    await db.$executeRaw`
      INSERT INTO "VocabularyTerm" (term, frequency, source)
      VALUES (${term}, ${5}, 'name')
    `;
    inserted.push(term);
  }
}

beforeAll(async () => {
  await ensureVocabulary();
});

afterAll(async () => {
  for (const term of inserted) {
    await db.$executeRaw`DELETE FROM "VocabularyTerm" WHERE term = ${term}`;
  }
  await db.$disconnect();
});

describe("correctSpelling trigram integration", () => {
  it("uses pg_trgm candidates to correct 'frnt brak pads'", async () => {
    const result = await correctSpelling("frnt brak pads", db);

    expect(result.text).toBe("front brake pads");
    expect(result.interpretations).toEqual([
      { kind: "spelling", token: "frnt", correction: "front" },
      { kind: "spelling", token: "brak", correction: "brake" },
    ]);
  });
});
