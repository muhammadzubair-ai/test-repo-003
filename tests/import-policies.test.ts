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

async function writeConflictingFixture(path: string) {
  const wb = new ExcelJS.Workbook();
  for (const name of REQUIRED_TABS) {
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
      ws.addRow(["S1", "Parts Co", "retail", "Dubai", "Toyota", 4.5]);
    } else if (name === "Listings") {
      ws.addRow(["listingId", "sku", "sellerId", "condition", "price", "stock", "warranty", "deliveryDays", "recentSales"]);
      ws.addRow(["L1", "SKU1", "S1", "new", 120, 3, "12m", 5, 5]);
      ws.addRow(["L2", "SKU1", "S1", "new", 80, 1, "6m", 2, 1]);
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
      ws.addRow(["commission", "10", 3]);
    } else if (name === "Systems") {
      ws.addRow(["systemName", "holds", "standInTab"]);
      ws.addRow(["PartsLink24", "catalogue", "Catalogue"]);
    }
  }
  await wb.xlsx.writeFile(path);
}

describe("policies precedence at import", () => {
  const dir = mkdtempSync(join(tmpdir(), "ads-policies-"));
  const fixture = join(dir, "conflict.xlsx");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  beforeAll(async () => {
    execFileSync("pnpm", ["db:deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    await writeConflictingFixture(fixture);
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores the Policies delivery value and records the original and the override", async () => {
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "infra/import/cli.ts", "--file", fixture, "--skip-embeddings"],
      { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);

    const overridden = await db.listing.findUniqueOrThrow({ where: { listingId: "L1" } });
    expect(overridden.deliveryDays).toBe(2);
    expect(overridden.price).toBe(120);

    const unchanged = await db.listing.findUniqueOrThrow({ where: { listingId: "L2" } });
    expect(unchanged.deliveryDays).toBe(2);

    const issues = await db.dataQualityIssue.findMany({ where: { issueType: "policy_override" } });
    expect(issues).toHaveLength(1);
    expect(issues[0].tab).toBe("Listings");
    expect(issues[0].detail).toContain("original:5");
    expect(issues[0].handling).toContain("override:2");
  });
});
