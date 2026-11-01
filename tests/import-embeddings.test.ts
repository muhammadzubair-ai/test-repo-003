import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { embeddingText } from "../infra/import/embeddings";
import { REQUIRED_TABS } from "../infra/import/workbook";

const root = resolve(".");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";

async function writeFixture(path: string) {
  const wb = new ExcelJS.Workbook();
  for (const name of REQUIRED_TABS) {
    const ws = wb.addWorksheet(name);
    if (name === "Catalogue") {
      ws.addRow(["sku", "partNumber", "nameEn", "category", "brand", "fitmentSummary", "completeness"]);
      ws.addRow(["SKU1", "P1", "Brake Pad", "Brakes", "Bosch", "", 1]);
      ws.addRow(["SKU2", "P2", "Oil Filter", "Filters", "Mann", "", 1]);
    } else if (name === "Vehicles") {
      ws.addRow(["vehicleId", "make", "model", "chassisCode", "yearFrom", "yearTo"]);
      ws.addRow(["V1", "Toyota", "Camry", "XV70", 2018, 2024]);
    } else if (name === "Fitment") {
      ws.addRow(["sku", "vehicleId"]);
      ws.addRow(["SKU1", "V1"]);
    } else if (name === "VIN_Decode") {
      ws.addRow(["vin", "make", "model", "chassis", "year"]);
      ws.addRow(["JT1BF1HK0U0000001", "Toyota", "Camry", "XV70", 2019]);
    } else if (name === "Sellers") {
      ws.addRow(["sellerId", "name", "type", "emirate", "specialistMakes", "rating"]);
      ws.addRow(["S1", "Parts Co", "retail", "Dubai", "Toyota", 4.5]);
    } else if (name === "Listings") {
      ws.addRow(["listingId", "sku", "sellerId", "condition", "price", "stock", "warranty", "deliveryDays", "recentSales"]);
      ws.addRow(["L1", "SKU1", "S1", "new", 120, 3, "12m", 2, 5]);
    } else if (name === "Orders") {
      ws.addRow(["orderLineId", "sku", "status", "courier", "paymentMethod", "returned", "orderDate"]);
      ws.addRow(["O1", "SKU1", "delivered", "Aramex", "card", false, "2026-01-02"]);
    } else if (name === "Search_Log") {
      ws.addRow(["queryText", "todayResultCount", "nextAction", "searchedAt"]);
      ws.addRow(["brake pad", 3, "click", "2026-01-03"]);
    } else if (name === "Search_Eval") {
      ws.addRow(["queryText", "expectedSkus"]);
      ws.addRow(["brake pad", "SKU1"]);
    } else if (name === "Policies") {
      ws.addRow(["key", "value", "sourceRow"]);
      ws.addRow(["delivery", "2", 2]);
    } else if (name === "Systems") {
      ws.addRow(["systemName", "holds", "standInTab"]);
      ws.addRow(["PartsLink24", "catalogue", "Catalogue"]);
    }
  }
  await wb.xlsx.writeFile(path);
}

function runImport(file: string, extraEnv: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(
    "pnpm",
    ["exec", "tsx", "infra/import/cli.ts", "--file", file, ...args],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl, ...extraEnv },
      encoding: "utf8",
    },
  );
}

describe("import embeddings", () => {
  const dir = mkdtempSync(join(tmpdir(), "ads-embed-"));
  const fixture = join(dir, "embed.xlsx");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  beforeAll(async () => {
    execFileSync("pnpm", ["db:deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    await writeFixture(fixture);
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("joins nameEn, category and brand for the embedding text", () => {
    expect(
      embeddingText({ nameEn: "Brake Pad", category: "Brakes", brand: "Bosch" }),
    ).toBe("Brake Pad Brakes Bosch");
  });

  it("writes a 384-dim embedding for every SKU (AC-1)", async () => {
    const result = runImport(fixture, { ADS_EMBEDDING_STUB: "1" });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const dims = await db.$queryRaw<{ sku: string; dims: number }[]>`
      SELECT sku, vector_dims(embedding) AS dims
      FROM "CatalogueSku"
      ORDER BY sku
    `;
    expect(dims).toEqual([
      { sku: "SKU1", dims: 384 },
      { sku: "SKU2", dims: 384 },
    ]);
  });

  it("leaves embeddings empty with --skip-embeddings (AC-2)", async () => {
    const result = runImport(fixture, {}, ["--skip-embeddings"]);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const rows = await db.$queryRaw<{ sku: string; embedding: unknown }[]>`
      SELECT sku, embedding FROM "CatalogueSku" ORDER BY sku
    `;
    expect(rows.every((r) => r.embedding == null)).toBe(true);
  });
});
