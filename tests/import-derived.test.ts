import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { REQUIRED_TABS } from "../infra/import/workbook";

const root = resolve(".");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";

async function writeDerivedFixture(path: string) {
  const wb = new ExcelJS.Workbook();
  for (const name of REQUIRED_TABS) {
    const ws = wb.addWorksheet(name);
    if (name === "Catalogue") {
      ws.addRow(["sku", "partNumber", "nameEn", "category", "brand", "fitmentSummary", "completeness", "superseded part"]);
      ws.addRow(["SKU1", "0986 494 104", "Brake Pad Front", "Brakes", "Bosch", "Camry", 0.8, "0986-000-001"]);
      ws.addRow(["SKU2", "AB-12.3/4", "Cabin Filter", "Filters", "Mann", "", 0.5, ""]);
    } else if (name === "Vehicles") {
      ws.addRow(["vehicleId", "make", "model", "chassisCode", "yearFrom", "yearTo"]);
      ws.addRow(["V1", "Toyota", "Camry", "XV70", 2018, 2024]);
    } else if (name === "Fitment") {
      ws.addRow(["sku", "vehicleId"]);
      ws.addRow(["SKU1", "V1"]);
    } else if (name === "VIN_Decode") {
      ws.addRow(["vin", "make", "model", "chassis", "year"]);
      ws.addRow(["JT1MATCHED0000001", "Toyota", "Camry", "XV70", 2019]);
      ws.addRow(["JT1UNMATCHED00001", "Ford", "Focus", "C346", 2015]);
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

function runImport(file: string) {
  return spawnSync(
    "pnpm",
    ["exec", "tsx", "infra/import/cli.ts", "--file", file, "--skip-embeddings"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    },
  );
}

describe("import derived data", () => {
  const dir = mkdtempSync(join(tmpdir(), "ads-derived-"));
  const fixture = join(dir, "derived.xlsx");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  beforeAll(async () => {
    execFileSync("pnpm", ["db:deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    await writeDerivedFixture(fixture);
    const result = runImport(fixture);
    expect(result.status, result.stderr + result.stdout).toBe(0);
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores normalised part numbers and PRIMARY aliases (AC-1)", async () => {
    const sku1 = await db.catalogueSku.findUniqueOrThrow({ where: { sku: "SKU1" } });
    expect(sku1.partNumberNorm).toBe("0986494104");
    const primary = await db.partNumberAlias.findMany({
      where: { sku: "SKU1", kind: "PRIMARY" },
    });
    expect(primary).toEqual([
      expect.objectContaining({ aliasNorm: "0986494104", sourceTab: "Catalogue" }),
    ]);
    expect(sku1.hasFitmentRecord).toBe(true);
  });

  it("stores SUPERSEDED aliases from supersession headers (AC-2)", async () => {
    const rows = await db.partNumberAlias.findMany({
      where: { kind: "SUPERSEDED" },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        aliasNorm: "0986000001",
        sku: "SKU1",
        sourceColumn: "superseded part",
      }),
    ]);
  });

  it("leaves unmatched VIN vehicleId null and logs the gap (AC-3)", async () => {
    const matched = await db.vinDecode.findUniqueOrThrow({ where: { vin: "JT1MATCHED0000001" } });
    expect(matched.vehicleId).toBe("V1");
    const unmatched = await db.vinDecode.findUniqueOrThrow({ where: { vin: "JT1UNMATCHED00001" } });
    expect(unmatched.vehicleId).toBeNull();
    const issues = await db.dataQualityIssue.findMany({
      where: { issueType: "vin_unresolved" },
    });
    expect(issues.some((i) => i.detail.includes("JT1UNMATCHED00001"))).toBe(true);
  });
});
