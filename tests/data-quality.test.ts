import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { planDataQuality, type DataQualityReport } from "../infra/import/quality";
import { REQUIRED_TABS } from "../infra/import/workbook";

const root = resolve(".");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/app";

describe("planDataQuality", () => {
  const plan = planDataQuality({
    Catalogue: [
      { sku: "A", partNumber: "AB-1", category: "Brakes", brand: "Bosch", fitmentSummary: "Camry" },
      { sku: "A", partNumber: "ZZ-9", category: "Brakes", brand: "Bosch", fitmentSummary: "Camry" },
      { sku: "B", partNumber: "ab-1", category: "", brand: "Mann", fitmentSummary: "" },
      { sku: "C", partNumber: "CC-1", category: "Brakes", brand: "", fitmentSummary: "Camry" },
    ],
    Fitment: [
      { sku: "A", vehicleId: "V1" },
      { sku: "NOPE", vehicleId: "V1" },
      { sku: "C", vehicleId: "V-MISSING" },
    ],
    Vehicles: [{ vehicleId: "V1" }],
    Sellers: [{ sellerId: "S1" }],
    Listings: [
      { listingId: "L1", sku: "A", sellerId: "S1", price: 10, stock: 1 },
      { listingId: "L2", sku: "MISSING", sellerId: "S1", price: 10, stock: 1 },
      { listingId: "L3", sku: "A", sellerId: "NO", price: 5, stock: 1 },
      { listingId: "L4", sku: "A", sellerId: "S1", price: 0, stock: 2 },
      { listingId: "L5", sku: "A", sellerId: "S1", price: 8, stock: -3 },
    ],
    Search_Eval: [{ expectedSkus: "A, GONE" }],
  });

  it("counts the four catalogue gaps (AC-1)", () => {
    expect(plan.counts).toEqual({
      skusMissingCategory: 1,
      skusMissingBrand: 1,
      skusMissingFitmentData: 1,
      skusWithoutFitmentRecord: 1,
    });
  });

  it("logs duplicate SKUs and unknown-SKU fitment rows with tab, row, type and handling (AC-2)", () => {
    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tab: "Catalogue",
          row: 3,
          issueType: "duplicate_sku",
          handling: "keep the first, log the rest",
        }),
        expect.objectContaining({
          tab: "Fitment",
          row: 3,
          issueType: "unknown_sku",
          handling: "skip, log",
        }),
      ]),
    );
    expect(plan.sheets.Catalogue.map((row) => row.partNumber)).toEqual(["AB-1", "ab-1", "CC-1"]);
    expect(plan.sheets.Fitment).toEqual([{ sku: "A", vehicleId: "V1" }]);
    expect(plan.sheets.Listings.map((row) => [row.listingId, row.excludedFromRanking])).toEqual([
      ["L1", undefined],
      ["L4", true],
      ["L5", true],
    ]);
  });
});

async function writeGapFixture(path: string) {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    for (const row of rows) ws.addRow(row);
  };
  for (const name of REQUIRED_TABS) {
    if (name === "Catalogue") {
      sheet(name, ["sku", "partNumber", "nameEn", "category", "brand", "fitmentSummary", "completeness", "superseded part"], [
        ["A", "AB-1", "Brake Pad", "Brakes", "Bosch", "Camry", 1, "OLD-1"],
        ["A", "ZZ-9", "Duplicate", "Brakes", "Bosch", "Camry", 1, ""],
        ["B", "ab-1", "Filter", "", "Mann", "", 1, ""],
        ["C", "CC-1", "Rotor", "Brakes", "", "Camry", 1, ""],
      ]);
    } else if (name === "Vehicles") {
      sheet(name, ["vehicleId", "make", "model", "chassisCode", "yearFrom", "yearTo"], [
        ["V1", "Toyota", "Camry", "XV70", 2018, 2024],
      ]);
    } else if (name === "Fitment") {
      sheet(name, ["sku", "vehicleId"], [
        ["A", "V1"],
        ["NOPE", "V1"],
        ["C", "V-MISSING"],
      ]);
    } else if (name === "VIN_Decode") {
      sheet(name, ["vin", "make", "model", "chassis", "year"], [
        ["JT1MATCHED0000001", "Toyota", "Camry", "XV70", 2019],
        ["JT1UNMATCHED00001", "Ford", "Focus", "C346", 2015],
      ]);
    } else if (name === "Sellers") {
      sheet(name, ["sellerId", "name", "type", "emirate", "specialistMakes", "rating"], [
        ["S1", "Parts Co", "retail", "Dubai", "Toyota", 4.5],
      ]);
    } else if (name === "Listings") {
      sheet(name, ["listingId", "sku", "sellerId", "condition", "price", "stock", "warranty", "deliveryDays", "recentSales"], [
        ["L1", "A", "S1", "new", 10, 1, "12m", 5, 1],
        ["L2", "MISSING", "S1", "new", 10, 1, "12m", 2, 1],
        ["L3", "A", "NO", "new", 5, 1, "12m", 2, 1],
        ["L4", "A", "S1", "new", 0, 2, "12m", 2, 1],
        ["L5", "A", "S1", "new", 8, -3, "12m", 2, 1],
      ]);
    } else if (name === "Orders") {
      sheet(name, ["orderLineId", "sku", "status", "courier", "paymentMethod", "returned", "orderDate"], [
        ["O1", "A", "delivered", "Aramex", "card", false, "2026-01-02"],
      ]);
    } else if (name === "Search_Log") {
      sheet(name, ["queryText", "todayResultCount", "nextAction", "searchedAt"], [
        ["brake pad", 3, "click", "2026-01-03"],
      ]);
    } else if (name === "Search_Eval") {
      sheet(name, ["queryText", "expectedSkus"], [["brake pad", "A, GONE"]]);
    } else if (name === "Policies") {
      sheet(name, ["key", "value", "sourceRow"], [
        ["delivery", "2", 2],
        ["commission", "10", 3],
      ]);
    } else if (name === "Systems") {
      sheet(name, ["systemName", "holds", "standInTab"], [["PartsLink24", "catalogue", "Catalogue"]]);
    }
  }
  await wb.xlsx.writeFile(path);
}

describe("import data-quality report", () => {
  const dir = mkdtempSync(join(tmpdir(), "ads-quality-"));
  const fixture = join(dir, "gaps.xlsx");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  beforeAll(async () => {
    execFileSync("pnpm", ["db:deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    await writeGapFixture(fixture);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "infra/import/cli.ts", "--file", fixture, "--skip-embeddings"],
      { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
  }, 120_000);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the four counts to reports/data-quality.json after import (AC-1)", () => {
    const report = JSON.parse(readFileSync(resolve("reports/data-quality.json"), "utf8")) as DataQualityReport;
    expect(report.file).toBe(fixture);
    expect(report.counts).toEqual({
      skusMissingCategory: 1,
      skusMissingBrand: 1,
      skusMissingFitmentData: 1,
      skusWithoutFitmentRecord: 1,
    });
    expect(report.supersessionSource).toEqual({ tab: "Catalogue", column: "superseded part" });
    expect(report.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Catalogue", rowsRead: 4, rowsLoaded: 3, rowsSkipped: 1 }),
      ]),
    );
  });

  it("records duplicate SKUs and unknown-SKU fitment rows on the import run (AC-2)", async () => {
    const report = JSON.parse(readFileSync(resolve("reports/data-quality.json"), "utf8")) as DataQualityReport;
    const markdown = readFileSync(resolve("reports/data-quality.md"), "utf8");
    const expected = [
      {
        tab: "Catalogue",
        row: 3,
        issueType: "duplicate_sku",
        handling: "keep the first, log the rest",
      },
      {
        tab: "Fitment",
        row: 3,
        issueType: "unknown_sku",
        handling: "skip, log",
      },
    ];
    expect(report.issues).toEqual(expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))));
    expect(report.issues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining([
        "part_number_collision",
        "unknown_vehicle",
        "unknown_seller",
        "non_positive_price",
        "negative_stock",
        "missing_expected_sku",
        "vin_unresolved",
        "policy_override",
      ]),
    );
    expect(markdown).toContain("skusMissingCategory: 1 (catalogue SKUs lacking a category)");
    expect(markdown).toContain("Supersession source: Catalogue / superseded part");
    for (const issue of report.issues) {
      expect(issue.row).toBeGreaterThan(0);
      expect(issue.detail).not.toBe("");
      expect(issue.handling).not.toBe("");
      expect(markdown).toContain(issue.handling);
    }

    const run = await db.importRun.findUniqueOrThrow({
      where: { id: report.runId },
      include: { issues: true },
    });
    expect(run.file).toBe(fixture);
    expect(run.counts).toEqual(report.counts);
    expect(run.supersessionSource).toEqual({ tab: "Catalogue", column: "superseded part" });
    expect(run.issues).toEqual(
      expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))),
    );

    const kept = await db.catalogueSku.findUniqueOrThrow({ where: { sku: "A" } });
    expect(kept.partNumber).toBe("AB-1");
    expect(await db.catalogueSku.count()).toBe(3);
    expect(await db.fitment.count()).toBe(1);
    expect(await db.listing.findUnique({ where: { listingId: "L2" } })).toBeNull();
    expect((await db.listing.findUniqueOrThrow({ where: { listingId: "L4" } })).excludedFromRanking).toBe(true);
    expect((await db.listing.findUniqueOrThrow({ where: { listingId: "L5" } })).excludedFromRanking).toBe(true);

    const vin = run.issues.find((issue) => issue.issueType === "vin_unresolved");
    expect(vin).toEqual(expect.objectContaining({ tab: "VIN_Decode", row: 3, handling: "no filter, log" }));
    const policy = run.issues.find((issue) => issue.issueType === "policy_override");
    expect(policy?.handling).toContain("override:2");
  });
});
