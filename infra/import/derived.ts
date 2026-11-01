import { randomUUID } from "node:crypto";
import { normalisePartNumber } from "../../src/api/part-number";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { str, type SheetRows } from "./workbook";

const SUPERSESSION_HEADER =
  /supersed|replaced|old part|previous part number/i;

function chassisNorm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokensFrom(...parts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const t of p.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 2) out.push(t);
    }
  }
  return out;
}

function findSupersessionColumns(rows: SheetRows): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((h) => SUPERSESSION_HEADER.test(h));
}

/** Compute derived import fields (ARCH-3/38/41/48/59). Embeddings stay out of scope. */
export async function buildDerivedData(
  db: PrismaClient,
  sheets: Record<string, SheetRows>,
): Promise<{ supersessionSource: { tab: string; column: string } | null; vinGaps: number }> {
  const catalogue = sheets.Catalogue ?? [];
  const vehicles = await db.vehicle.findMany();
  const fitmentSkus = new Set(
    (await db.fitment.findMany({ select: { sku: true } })).map((f) => f.sku),
  );

  // partNumberNorm + PRIMARY aliases
  const primaryAliases: {
    id: string;
    aliasNorm: string;
    sku: string;
    kind: "PRIMARY";
    sourceTab: string;
    sourceColumn: string;
  }[] = [];

  for (const row of catalogue) {
    const sku = str(row, "sku", "SKU");
    const partNumber = str(row, "partNumber", "PartNumber", "part_number");
    if (!sku || !partNumber) continue;
    const norm = normalisePartNumber(partNumber);
    await db.catalogueSku.update({
      where: { sku },
      data: {
        partNumberNorm: norm,
        hasFitmentRecord: fitmentSkus.has(sku),
      },
    });
    primaryAliases.push({
      id: randomUUID(),
      aliasNorm: norm,
      sku,
      kind: "PRIMARY",
      sourceTab: "Catalogue",
      sourceColumn: "partNumber",
    });
  }
  if (primaryAliases.length) {
    await db.partNumberAlias.createMany({ data: primaryAliases });
  }

  // SUPERSEDED aliases from discovered columns (start with Catalogue)
  let supersessionSource: { tab: string; column: string } | null = null;
  const superseded: {
    id: string;
    aliasNorm: string;
    sku: string;
    kind: "SUPERSEDED";
    sourceTab: string;
    sourceColumn: string;
  }[] = [];

  for (const tab of ["Catalogue", "Fitment", "Listings", "Orders"] as const) {
    const rows = sheets[tab] ?? [];
    const cols = findSupersessionColumns(rows);
    for (const column of cols) {
      if (!supersessionSource) supersessionSource = { tab, column };
      for (const row of rows) {
        const sku = str(row, "sku", "SKU");
        const old = str(row, column);
        if (!sku || !old) continue;
        superseded.push({
          id: randomUUID(),
          aliasNorm: normalisePartNumber(old),
          sku,
          kind: "SUPERSEDED",
          sourceTab: tab,
          sourceColumn: column,
        });
      }
    }
  }
  if (superseded.length) {
    await db.partNumberAlias.createMany({ data: superseded });
  }

  // VocabularyTerm from catalogue names/categories and vehicles
  const vocab = new Map<string, { frequency: number; source: "name" | "category" | "make" | "model" | "chassis" }>();
  const bump = (term: string, source: "name" | "category" | "make" | "model" | "chassis") => {
    const cur = vocab.get(term);
    if (!cur) vocab.set(term, { frequency: 1, source });
    else cur.frequency += 1;
  };
  for (const row of catalogue) {
    for (const t of tokensFrom(str(row, "nameEn", "NameEn", "name"))) bump(t, "name");
    for (const t of tokensFrom(str(row, "category", "Category"))) bump(t, "category");
  }
  for (const v of vehicles) {
    for (const t of tokensFrom(v.make)) bump(t, "make");
    for (const t of tokensFrom(v.model)) bump(t, "model");
    for (const t of tokensFrom(v.chassisCode)) bump(t, "chassis");
  }
  if (vocab.size) {
    await db.vocabularyTerm.createMany({
      data: [...vocab.entries()].map(([term, v]) => ({
        term,
        frequency: v.frequency,
        source: v.source,
      })),
    });
  }

  // VIN → vehicle resolution; gaps stay null and are logged as DataQualityIssue
  const vinRow = new Map<string, number>();
  (sheets.VIN_Decode ?? []).forEach((row, index) => {
    const vin = str(row, "vin", "VIN").toUpperCase();
    if (vin && !vinRow.has(vin)) vinRow.set(vin, index + 2);
  });

  const importRun = await db.importRun.create({
    data: {
      id: randomUUID(),
      startedAt: new Date(),
      finishedAt: new Date(),
      file: "import",
      counts: {},
      supersessionSource: supersessionSource ?? undefined,
    },
  });

  let vinGaps = 0;
  const vins = await db.vinDecode.findMany();
  for (const vin of vins) {
    const chassis = chassisNorm(vin.chassis);
    const match = vehicles.find(
      (v) =>
        v.make.toLowerCase() === vin.make.toLowerCase() &&
        v.model.toLowerCase() === vin.model.toLowerCase() &&
        v.chassisCodeNorm === chassis &&
        vin.year >= v.yearFrom &&
        vin.year <= v.yearTo,
    );
    if (match) {
      await db.vinDecode.update({
        where: { vin: vin.vin },
        data: { vehicleId: match.vehicleId },
      });
    } else {
      vinGaps += 1;
      await db.dataQualityIssue.create({
        data: {
          id: randomUUID(),
          importRunId: importRun.id,
          tab: "VIN_Decode",
          row: vinRow.get(vin.vin) ?? 0,
          issueType: "vin_unresolved",
          detail: `VIN ${vin.vin} matched no Vehicles row`,
          handling: "no filter, log",
        },
      });
    }
  }

  return { supersessionSource, vinGaps };
}
