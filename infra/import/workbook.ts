import ExcelJS from "exceljs";

export const REQUIRED_TABS = [
  "Catalogue",
  "Fitment",
  "Vehicles",
  "VIN_Decode",
  "Listings",
  "Search_Log",
  "Search_Eval",
  "Orders",
  "Sellers",
  "Policies",
  "Systems",
] as const;

export type SheetRows = Record<string, unknown>[];

function cellValue(raw: ExcelJS.CellValue): unknown {
  if (raw == null) return null;
  if (typeof raw === "object" && "text" in raw && typeof (raw as { text: string }).text === "string") {
    return (raw as { text: string }).text;
  }
  if (typeof raw === "object" && "result" in raw) return (raw as { result: unknown }).result;
  if (raw instanceof Date) return raw;
  return raw;
}

export async function readWorkbook(filePath: string): Promise<{
  missing: string[];
  sheets: Record<string, SheetRows>;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const byName = new Map(wb.worksheets.map((ws) => [ws.name, ws]));
  const missing = REQUIRED_TABS.filter((name) => !byName.has(name));
  const sheets: Record<string, SheetRows> = {};
  if (missing.length) return { missing, sheets };

  for (const name of REQUIRED_TABS) {
    const ws = byName.get(name)!;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col] = String(cellValue(cell.value) ?? "").trim();
    });
    const rows: SheetRows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, unknown> = {};
      let any = false;
      for (let col = 1; col < headers.length; col++) {
        const key = headers[col];
        if (!key) continue;
        const v = cellValue(row.getCell(col).value);
        if (v != null && v !== "") any = true;
        obj[key] = v;
      }
      if (any) rows.push(obj);
    });
    sheets[name] = rows;
  }
  return { missing, sheets };
}

export function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function num(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

export function bool(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === "") continue;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}
