import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Semantic retriever (ARCH-10).
 *
 * The corrected query is embedded in-process with all-MiniLM-L6-v2
 * (384 dimensions). The model is loaded once per process. Retrieval is
 * `ORDER BY embedding <=> $1 LIMIT 50` against CatalogueSku.embedding.
 * Import-time embeddings are out of scope.
 */

env.cacheDir = process.env.TRANSFORMERS_CACHE ?? join(tmpdir(), "motoark-minilm");

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;
const TOP_N = 50;

let embedder: Promise<FeatureExtractionPipeline> | null = null;

/** Load the local embedding model once per process. */
export function loadQueryEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    embedder = pipeline("feature-extraction", MODEL);
  }
  return embedder;
}

/** Embed corrected query text. Vectors are mean-pooled and L2-normalised. */
export async function embedQuery(correctedQuery: string): Promise<number[]> {
  const extractor = await loadQueryEmbedder();
  const output = await extractor(correctedQuery, { pooling: "mean", normalize: true });
  return Array.from(output.data as ArrayLike<number>);
}

export type SemanticHit = {
  sku: string;
  rank: number;
};

export type SemanticDb = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

function vectorLiteral(values: readonly number[]): string {
  if (values.length !== DIMENSIONS) {
    throw new Error(`query embedding must have ${DIMENSIONS} dimensions, got ${values.length}`);
  }
  return `[${values.join(",")}]`;
}

/** Top 50 catalogue SKUs nearest the query embedding in cosine distance. */
export async function retrieveSemantic(correctedQuery: string, client: SemanticDb): Promise<SemanticHit[]> {
  const query = correctedQuery.trim();
  if (!query) return [];

  const literal = vectorLiteral(await embedQuery(query));
  const rows = await client.$queryRaw<{ sku: string }[]>`
    SELECT "sku" AS sku
    FROM "CatalogueSku"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${TOP_N}
  `;

  return rows.map((row, index) => ({ sku: row.sku, rank: index + 1 }));
}
