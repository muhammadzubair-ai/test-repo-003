import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { buildDerivedData } from "./derived";
import { loadSheets, truncateImportTables } from "./load";
import { readWorkbook } from "./workbook";

function parseArgs(argv: string[]) {
  let file: string | undefined;
  let skipEmbeddings = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") file = argv[++i];
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--skip-embeddings") skipEmbeddings = true;
  }
  return { file, skipEmbeddings };
}

async function main() {
  const { file, skipEmbeddings } = parseArgs(process.argv.slice(2));
  void skipEmbeddings; // embeddings are out of scope for U-7; flag accepted for CLI compatibility

  if (!file) {
    console.error("Usage: pnpm import -- --file <xlsx> [--skip-embeddings]");
    process.exit(1);
  }

  const { missing, sheets } = await readWorkbook(file);
  if (missing.length) {
    console.error(`Missing required tab(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  try {
    await db.$transaction(async (tx) => {
      const client = tx as unknown as PrismaClient;
      await truncateImportTables(client);
      const counts = await loadSheets(client, sheets);
      const derived = await buildDerivedData(client, sheets);
      console.log(JSON.stringify({ ok: true, file, counts, derived }, null, 2));
    });
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  } finally {
    await db.$disconnect();
  }
}

main();
