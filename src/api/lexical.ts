/**
 * Lexical retriever (ARCH-9).
 *
 * Full-text search uses websearch_to_tsquery('english', correctedPartTerms)
 * against CatalogueSku.searchVector. ts_rank_cd is scaled to 0–1 within that
 * candidate set. When fewer than 10 rows match, pg_trgm similarity on nameEn
 * is added. The result is the top 50 rows as (sku, lexicalScore, rank).
 * Spelling correction is applied by the caller before this runs.
 */

export type LexicalHit = {
  sku: string;
  lexicalScore: number;
  /** 1-based position after ordering by score, then SKU. */
  rank: number;
};

export type LexicalDb = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

const FULL_TEXT_FALLBACK_BELOW = 10;
const TOP_N = 50;
/** pg_trgm's default similarity_threshold. */
const TRIGRAM_MIN_SIMILARITY = 0.3;

type ScoredRow = { sku: string; score: number | string | null };

function clamp01(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function toScored(rows: ScoredRow[]): { sku: string; score: number }[] {
  return rows.map((row) => ({ sku: row.sku, score: clamp01(Number(row.score)) }));
}

function byScoreThenSku(a: { sku: string; score: number }, b: { sku: string; score: number }): number {
  return b.score - a.score || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

async function fullText(client: LexicalDb, query: string): Promise<{ sku: string; score: number }[]> {
  const rows = await client.$queryRaw<ScoredRow[]>`
    WITH matched AS (
      SELECT "sku" AS sku,
             ts_rank_cd("searchVector", websearch_to_tsquery('english', ${query})) AS score
      FROM "CatalogueSku"
      WHERE "searchVector" @@ websearch_to_tsquery('english', ${query})
    ),
    scaled AS (
      SELECT sku,
             CASE
               WHEN MAX(score) OVER () > 0 THEN score / MAX(score) OVER ()
               ELSE 0
             END AS score
      FROM matched
    )
    SELECT sku, score
    FROM scaled
    ORDER BY score DESC, sku ASC
    LIMIT ${TOP_N}
  `;
  return toScored(rows);
}

async function trigram(client: LexicalDb, query: string): Promise<{ sku: string; score: number }[]> {
  const rows = await client.$queryRaw<ScoredRow[]>`
    SELECT "sku" AS sku,
           similarity("nameEn", ${query}) AS score
    FROM "CatalogueSku"
    WHERE similarity("nameEn", ${query}) >= ${TRIGRAM_MIN_SIMILARITY}
    ORDER BY score DESC, sku ASC
    LIMIT ${TOP_N}
  `;
  return toScored(rows);
}

/** Top 50 lexical hits for part terms that are already corrected. */
export async function retrieveLexical(correctedPartTerms: string, client: LexicalDb): Promise<LexicalHit[]> {
  const query = correctedPartTerms.trim();
  if (!query) return [];

  const fullTextHits = await fullText(client, query);
  const hits = [...fullTextHits];

  if (fullTextHits.length < FULL_TEXT_FALLBACK_BELOW) {
    const seen = new Set(hits.map((hit) => hit.sku));
    for (const hit of await trigram(client, query)) {
      if (seen.has(hit.sku)) continue;
      seen.add(hit.sku);
      hits.push(hit);
    }
    hits.sort(byScoreThenSku);
  }

  return hits.slice(0, TOP_N).map((hit, index) => ({
    sku: hit.sku,
    lexicalScore: hit.score,
    rank: index + 1,
  }));
}
