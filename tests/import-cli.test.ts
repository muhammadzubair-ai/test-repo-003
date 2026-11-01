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

async function writeFixture(path: string, omitTab?: string) {
  const wb = new ExcelJS.Workbook();
  for (const name of REQUIRED_TABS) {
    if (name === omitTab) continue;
    const ws = wb.addWorksheet(name);
    if (name === "Catalogue") {
      ws.addRow(["sku", "partNumber", "nameEn", "category", "brand", "fitmentSummary", "completeness"]);
      ws.addRow(["SKU1", "0986 494 104", "Brake Pad", "Brakes", "Bosch", "Camry", 0.8]);
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
      ws.addRow(["S1", "Parts Co", "retail", "Dubai", "Toyota,Honda", 4.5]);
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

describe("import CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "ads-import-"));
  const fixture = join(dir, "mini.xlsx");
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

  it("loads tabs twice with identical counts (AC-1)", async () => {
    const first = runImport(fixture);
    expect(first.status, first.stderr).toBe(0);
    const counts1 = {
      catalogue: await db.catalogueSku.count(),
      fitment: await db.fitment.count(),
      vehicles: await db.vehicle.count(),
      vins: await db.vinDecode.count(),
      listings: await db.listing.count(),
      logs: await db.searchLog.count(),
      evals: await db.searchEval.count(),
      orders: await db.orderLine.count(),
      sellers: await db.seller.count(),
    };

    const second = runImport(fixture);
    expect(second.status, second.stderr).toBe(0);
    const counts2 = {
      catalogue: await db.catalogueSku.count(),
      fitment: await db.fitment.count(),
      vehicles: await db.vehicle.count(),
      vins: await db.vinDecode.count(),
      listings: await db.listing.count(),
      logs: await db.searchLog.count(),
      evals: await db.searchEval.count(),
      orders: await db.orderLine.count(),
      sellers: await db.seller.count(),
    };
    expect(counts2).toEqual(counts1);
    expect(counts1.catalogue).toBe(1);
  });

  it("exits 1 and rolls back when a required tab is missing (AC-2)", async () => {
    const before = await db.catalogueSku.count();
    const bad = join(dir, "missing.xlsx");
    await writeFixture(bad, "Sellers");
    const result = runImport(bad);
    expect(result.status).toBe(1);
    expect(await db.catalogueSku.count()).toBe(before);
  });

  it("stores SystemStandIn from the Systems tab without network calls (AC-3)", async () => {
    const result = runImport(fixture);
    expect(result.status).toBe(0);
    const rows = await db.systemStandIn.findMany();
    expect(rows).toEqual([
      expect.objectContaining({
        systemName: "PartsLink24",
        holds: "catalogue",
        standInTab: "Catalogue",
      }),
    ]);
    expect(result.stderr).not.toMatch(/fetch|http|partsLink/i);
  });
});
