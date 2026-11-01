/**
 * Reciprocal rank fusion and de-duplication (ARCH-12).
 *
 * Combines the part-number, supersession, lexical, semantic and symptom
 * lists by SKU. Rank is the 1-based position in a list (the first hit is
 * rank 1). A later duplicate of the same SKU in one list is ignored.
 *
 * score = Σ 1/(60 + rank) over the lists that returned the SKU.
 * Exact part-number hits and superseded hits are pinned at relevance 1.0.
 * Every other relevance is that score, which is in (0, 1) for these lists.
 * Each SKU is emitted once, with the set of retrievers that matched it.
 */

export const RRF_K = 60;

export const RETRIEVERS = [
  "part-number",
  "supersession",
  "lexical",
  "semantic",
  "symptom",
] as const;

export type Retriever = (typeof RETRIEVERS)[number];

/** Ordered hit lists. Missing or empty means that retriever returned nothing. */
export type FusionLists = Partial<Record<Retriever, readonly string[]>>;

export type FusedResult = {
  sku: string;
  relevance: number;
  /** Retrievers that matched this SKU, in canonical list order, without duplicates. */
  matchers: Retriever[];
};

const PINNED: ReadonlySet<Retriever> = new Set(["part-number", "supersession"]);

/**
 * Fuse retriever lists into one SKU list.
 * Higher relevance comes first. Equal relevance is ordered by SKU so the
 * result is stable; the unit does not define a tie-break.
 */
export function fuseResults(lists: FusionLists): FusedResult[] {
  const bySku = new Map<string, { score: number; matchers: Retriever[] }>();

  for (const retriever of RETRIEVERS) {
    const hits = lists[retriever];
    if (!hits || hits.length === 0) continue;

    const seen = new Set<string>();
    for (let index = 0; index < hits.length; index++) {
      const sku = hits[index];
      if (seen.has(sku)) continue;
      seen.add(sku);

      const rank = index + 1;
      const entry = bySku.get(sku) ?? { score: 0, matchers: [] };
      entry.score += 1 / (RRF_K + rank);
      entry.matchers.push(retriever);
      bySku.set(sku, entry);
    }
  }

  const results: FusedResult[] = [];
  for (const [sku, entry] of bySku) {
    const pinned = entry.matchers.some((matcher) => PINNED.has(matcher));
    results.push({
      sku,
      relevance: pinned ? 1 : entry.score,
      matchers: entry.matchers,
    });
  }

  results.sort(
    (a, b) => b.relevance - a.relevance || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),
  );
  return results;
}
