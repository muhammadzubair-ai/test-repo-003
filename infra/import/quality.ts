import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalisePartNumber } from "../../src/api/part-number";
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client";
import { REQUIRED_TABS, num, str, type SheetRows } from "./workbook";

/** Handling phrases from ARCH-21, stored on each DataQualityIssue. */
export const QUALITY_HANDLING = {
  duplicateSku: "keep the first, log the rest",
  partNumberCollision: "keep both, log",
  skip: "skip, log",
  excludeFromRanking: "exclude from ranking, log",
  keepFlag: "keep, flag",
} as const;

export type QualityIssue = {
  tab: string;
  row: number;
  issueType: string;
  detail: string;
  handling: string;
};

export type QualityCounts = {
  skusMissingCategory: number;
  skusMissingBrand: number;
  skusMissingFitmentData: number;
  skusWithoutFitmentRecord: number;
};

export type TabStat = {
  name: string;
  rowsRead: number;
  rowsLoaded: number;
  rowsSkipped: number;
};

export type QualityPlan = {
  /** Sheets with duplicate SKUs and unknown fitment/listing rows removed. */
  sheets: Record<string, SheetRows>;
  issues: QualityIssue[];
  tabs: TabStat[];
  counts: QualityCounts;
};

export type SupersessionSource = { tab: string; column: string };

export type DataQualityReport = {
  runId: string;
  startedAt: string;
  file: string;
  tabs: TabStat[];
  counts: QualityCounts;
  issues: QualityIssue[];
  supersessionSource: SupersessionSource | null;
};

function sheetRow(index: number): number {
  return index + 2;
}

function compareIssues(a: QualityIssue, b: QualityIssue): number {
  return (
    a.tab.localeCompare(b.tab) ||
    a.row - b.row ||
    a.issueType.localeCompare(b.issueType) ||
    a.detail.localeCompare(b.detail)
  );
}

/**
 * Plan the data-quality checks that must happen before rows are inserted.
 * Duplicate catalogue SKUs and fitment/listing rows with unknown references
 * are dropped here so the load keeps the first SKU and skips the bad rows.
 */
export function planDataQuality(sheets: Record<string, SheetRows>): QualityPlan {
  const catalogueIn = sheets.Catalogue ?? [];
  const fitmentIn = sheets.Fitment ?? [];
  const listingsIn = sheets.Listings ?? [];
  const vehicleIds = new Set(
    (sheets.Vehicles ?? [])
      .map((row) => str(row, "vehicleId", "VehicleId", "id"))
      .filter(Boolean),
  );
  const sellerIds = new Set(
    (sheets.Sellers ?? []).map((row) => str(row, "sellerId", "SellerId")).filter(Boolean),
  );
  const fitmentSkus = new Set(
    fitmentIn.map((row) => str(row, "sku", "SKU")).filter(Boolean),
  );

  const issues: QualityIssue[] = [];
  const keptCatalogue: SheetRows = [];
  const seenSku = new Set<string>();
  const norms = new Map<string, { sku: string; row: number }>();

  catalogueIn.forEach((row, index) => {
    const rowNumber = sheetRow(index);
    const sku = str(row, "sku", "SKU");
    if (sku && seenSku.has(sku)) {
      issues.push({
        tab: "Catalogue",
        row: rowNumber,
        issueType: "duplicate_sku",
        detail: `duplicate SKU ${sku}`,
        handling: QUALITY_HANDLING.duplicateSku,
      });
      return;
    }
    if (sku) seenSku.add(sku);
    keptCatalogue.push(row);

    const norm = normalisePartNumber(str(row, "partNumber", "PartNumber", "part_number"));
    if (!sku || !norm) return;
    const previous = norms.get(norm);
    if (previous) {
      issues.push({
        tab: "Catalogue",
        row: rowNumber,
        issueType: "part_number_collision",
        detail: `normalised part number ${norm} also used by ${previous.sku} (row ${previous.row})`,
        handling: QUALITY_HANDLING.partNumberCollision,
      });
      return;
    }
    norms.set(norm, { sku, row: rowNumber });
  });

  const counts: QualityCounts = {
    skusMissingCategory: 0,
    skusMissingBrand: 0,
    skusMissingFitmentData: 0,
    skusWithoutFitmentRecord: 0,
  };
  for (const row of keptCatalogue) {
    const sku = str(row, "sku", "SKU");
    if (!str(row, "category", "Category")) counts.skusMissingCategory += 1;
    if (!str(row, "brand", "Brand")) counts.skusMissingBrand += 1;
    if (!str(row, "fitmentSummary", "FitmentSummary")) counts.skusMissingFitmentData += 1;
    if (sku && !fitmentSkus.has(sku)) counts.skusWithoutFitmentRecord += 1;
  }

  const keptFitment: SheetRows = [];
  fitmentIn.forEach((row, index) => {
    const rowNumber = sheetRow(index);
    const sku = str(row, "sku", "SKU");
    const vehicleId = str(row, "vehicleId", "VehicleId");
    if (!seenSku.has(sku)) {
      issues.push({
        tab: "Fitment",
        row: rowNumber,
        issueType: "unknown_sku",
        detail: `Fitment row references unknown SKU ${sku || "(blank)"}`,
        handling: QUALITY_HANDLING.skip,
      });
      return;
    }
    if (!vehicleIds.has(vehicleId)) {
      issues.push({
        tab: "Fitment",
        row: rowNumber,
        issueType: "unknown_vehicle",
        detail: `Fitment row for ${sku} references unknown vehicle ${vehicleId || "(blank)"}`,
        handling: QUALITY_HANDLING.skip,
      });
      return;
    }
    keptFitment.push(row);
  });

  const keptListings: SheetRows = [];
  listingsIn.forEach((row, index) => {
    const rowNumber = sheetRow(index);
    const sku = str(row, "sku", "SKU");
    const sellerId = str(row, "sellerId", "SellerId");
    const listingId = str(row, "listingId", "ListingId") || "(blank)";
    if (!seenSku.has(sku)) {
      issues.push({
        tab: "Listings",
        row: rowNumber,
        issueType: "unknown_sku",
        detail: `Listing ${listingId} references unknown SKU ${sku || "(blank)"}`,
        handling: QUALITY_HANDLING.skip,
      });
      return;
    }
    if (!sellerIds.has(sellerId)) {
      issues.push({
        tab: "Listings",
        row: rowNumber,
        issueType: "unknown_seller",
        detail: `Listing ${listingId} references unknown seller ${sellerId || "(blank)"}`,
        handling: QUALITY_HANDLING.skip,
      });
      return;
    }

    const price = num(row, "price", "Price");
    const stock = num(row, "stock", "Stock");
    const exclude = price <= 0 || stock < 0;
    if (price <= 0) {
      issues.push({
        tab: "Listings",
        row: rowNumber,
        issueType: "non_positive_price",
        detail: `Listing ${listingId} price ${price}`,
        handling: QUALITY_HANDLING.excludeFromRanking,
      });
    }
    if (stock < 0) {
      issues.push({
        tab: "Listings",
        row: rowNumber,
        issueType: "negative_stock",
        detail: `Listing ${listingId} stock ${stock}`,
        handling: QUALITY_HANDLING.excludeFromRanking,
      });
    }
    keptListings.push({
      ...(exclude ? { ...row, excludedFromRanking: true } : row),
      __sourceRow: rowNumber,
    });
  });

  (sheets.Search_Eval ?? []).forEach((row, index) => {
    const expected = str(row, "expectedSkus", "ExpectedSkus")
      .split(/[,;]/)
      .map((sku) => sku.trim())
      .filter(Boolean);
    for (const sku of expected) {
      if (seenSku.has(sku)) continue;
      issues.push({
        tab: "Search_Eval",
        row: sheetRow(index),
        issueType: "missing_expected_sku",
        detail: `expected SKU ${sku} missing from the catalogue`,
        handling: QUALITY_HANDLING.keepFlag,
      });
    }
  });

  const cleaned: Record<string, SheetRows> = {
    ...sheets,
    Catalogue: keptCatalogue,
    Fitment: keptFitment,
    Listings: keptListings,
  };
  const tabs = REQUIRED_TABS.map((name) => {
    const rowsRead = (sheets[name] ?? []).length;
    const rowsLoaded = (cleaned[name] ?? []).length;
    return { name, rowsRead, rowsLoaded, rowsSkipped: rowsRead - rowsLoaded };
  });

  return { sheets: cleaned, issues, tabs, counts };
}

function markdownCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderDataQualityMarkdown(report: DataQualityReport): string {
  const source = report.supersessionSource
    ? `${report.supersessionSource.tab} / ${report.supersessionSource.column}`
    : "none";
  const lines = [
    "# Data-quality report",
    "",
    `- Run: ${report.runId}`,
    `- Started: ${report.startedAt}`,
    `- File: ${report.file}`,
    `- Supersession source: ${source}`,
    "",
    "## Counts",
    "",
    `- skusMissingCategory: ${report.counts.skusMissingCategory} (catalogue SKUs lacking a category)`,
    `- skusMissingBrand: ${report.counts.skusMissingBrand} (SKUs lacking a brand)`,
    `- skusMissingFitmentData: ${report.counts.skusMissingFitmentData} (SKUs lacking fitment data)`,
    `- skusWithoutFitmentRecord: ${report.counts.skusWithoutFitmentRecord} (SKUs with no Fitment tab record)`,
    "",
    "## Tabs",
    "",
    "| Tab | Rows read | Rows loaded | Rows skipped |",
    "| --- | --- | --- | --- |",
    ...report.tabs.map(
      (tab) =>
        `| ${markdownCell(tab.name)} | ${tab.rowsRead} | ${tab.rowsLoaded} | ${tab.rowsSkipped} |`,
    ),
    "",
    "## Issues",
    "",
  ];
  if (report.issues.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push("| Tab | Row | Type | Detail | Handling |", "| --- | --- | --- | --- | --- |");
    for (const issue of report.issues) {
      lines.push(
        `| ${markdownCell(issue.tab)} | ${issue.row} | ${markdownCell(issue.issueType)} | ${markdownCell(issue.detail)} | ${markdownCell(issue.handling)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Write ImportRun fields, DataQualityIssue rows, and reports/data-quality.json + .md. */
export async function persistDataQualityReport(
  db: PrismaClient,
  args: {
    file: string;
    startedAt: Date;
    plan: QualityPlan;
    supersessionSource: SupersessionSource | null;
    reportsDir?: string;
  },
): Promise<DataQualityReport> {
  const run = await db.importRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!run) throw new Error("Data-quality report requires an import run");

  if (args.plan.issues.length) {
    await db.dataQualityIssue.createMany({
      data: args.plan.issues.map((issue) => ({
        id: randomUUID(),
        importRunId: run.id,
        tab: issue.tab,
        row: issue.row,
        issueType: issue.issueType,
        detail: issue.detail,
        handling: issue.handling,
      })),
    });
  }

  const finishedAt = new Date();
  await db.importRun.update({
    where: { id: run.id },
    data: {
      startedAt: args.startedAt,
      finishedAt,
      file: args.file,
      counts: args.plan.counts,
      supersessionSource: args.supersessionSource ?? Prisma.JsonNull,
    },
  });

  const stored = await db.dataQualityIssue.findMany({ where: { importRunId: run.id } });
  const report: DataQualityReport = {
    runId: run.id,
    startedAt: args.startedAt.toISOString(),
    file: args.file,
    tabs: args.plan.tabs,
    counts: args.plan.counts,
    issues: stored
      .map((issue) => ({
        tab: issue.tab,
        row: issue.row,
        issueType: issue.issueType,
        detail: issue.detail,
        handling: issue.handling,
      }))
      .sort(compareIssues),
    supersessionSource: args.supersessionSource,
  };

  const dir = args.reportsDir ?? resolve("reports");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "data-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "data-quality.md"), renderDataQualityMarkdown(report), "utf8");
  return report;
}
