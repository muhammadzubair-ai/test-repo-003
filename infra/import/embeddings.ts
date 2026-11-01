import type { PrismaClient } from "../../src/generated/prisma/client";

export type EmbedFn = (text: string) => Promise<number[]>;

/** Join catalogue fields for embedding (ARCH-10): nameEn, then category, then brand. */
export function embeddingText(parts: {
  nameEn: string;
  category: string | null;
  brand: string | null;
}): string {
  return [parts.nameEn, parts.category ?? "", parts.brand ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

async function defaultEmbedder(): Promise<EmbedFn> {
  // Lazy-load so --skip-embeddings never pulls the model.
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return async (text: string) => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const data = output.data as Float32Array | number[];
    return Array.from(data);
  };
}

/** Deterministic 384-d stub for fast tests (ADS_EMBEDDING_STUB=1). */
export function stubEmbedder(): EmbedFn {
  return async (text: string) => {
    const vec = new Array(384).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 384] = ((vec[i % 384] as number) + text.charCodeAt(i)) % 97;
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
    return vec.map((x) => x / norm);
  };
}

export async function resolveEmbedder(): Promise<EmbedFn> {
  if (process.env.ADS_EMBEDDING_STUB === "1") return stubEmbedder();
  return defaultEmbedder();
}

/** Embed every CatalogueSku into the pgvector column (384 dims). */
export async function embedCatalogueSkus(
  db: PrismaClient,
  embed: EmbedFn,
): Promise<number> {
  const skus = await db.catalogueSku.findMany({
    select: { sku: true, nameEn: true, category: true, brand: true },
  });
  for (const row of skus) {
    const vec = await embed(embeddingText(row));
    if (vec.length !== 384) {
      throw new Error(`expected 384-dim embedding, got ${vec.length} for ${row.sku}`);
    }
    const literal = `[${vec.join(",")}]`;
    await db.$executeRawUnsafe(
      `UPDATE "CatalogueSku" SET embedding = $1::vector WHERE sku = $2`,
      literal,
      row.sku,
    );
  }
  return skus.length;
}
