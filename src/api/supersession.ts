import { normalisePartNumber } from "./part-number";

/**
 * Supersession resolver (ARCH-4).
 *
 * Looks up each normalised part-number candidate in PartNumberAlias.
 * A PRIMARY alias returns that SKU. A SUPERSEDED alias follows the chain
 * to the latest SKU, at most five hops, and stops if a number or SKU repeats.
 * Superseded hits are marked matchedBy "superseded" and pinned at the same
 * relevance as an exact part-number match. Which tab stored the supersession
 * is chosen at import and is not decided here.
 */

export type PartNumberAliasKind = "PRIMARY" | "SUPERSEDED";

export type PartNumberAlias = {
  aliasNorm: string;
  sku: string;
  kind: PartNumberAliasKind;
};

/** Exact part-number hits are pinned at relevance 1. */
export const PINNED_PART_NUMBER_RELEVANCE = 1;

const MAX_SUPERSESSION_DEPTH = 5;

export type AliasResolution = {
  sku: string;
  matchedBy: "primary" | "superseded";
  /** Set for a superseded hit: "replaces superseded part number <X>". */
  explanation: string | null;
  relevance: number;
};

type AliasIndex = {
  byNorm: Map<string, PartNumberAlias[]>;
  primaryNormBySku: Map<string, string>;
};

function indexAliases(aliases: readonly PartNumberAlias[]): AliasIndex {
  const byNorm = new Map<string, PartNumberAlias[]>();
  const primaryNormBySku = new Map<string, string>();

  for (const alias of aliases) {
    const aliasNorm = normalisePartNumber(alias.aliasNorm);
    if (!aliasNorm) continue;
    const row: PartNumberAlias = { aliasNorm, sku: alias.sku, kind: alias.kind };
    const list = byNorm.get(aliasNorm) ?? [];
    list.push(row);
    byNorm.set(aliasNorm, list);
    if (alias.kind === "PRIMARY" && !primaryNormBySku.has(alias.sku)) {
      primaryNormBySku.set(alias.sku, aliasNorm);
    }
  }

  return { byNorm, primaryNormBySku };
}

function supersededHit(aliasNorm: string, sku: string, searched: string): AliasResolution {
  return {
    sku,
    matchedBy: "superseded",
    explanation: `replaces superseded part number ${searched}`,
    relevance: PINNED_PART_NUMBER_RELEVANCE,
  };
}

function resolveAgainst(candidate: string, index: AliasIndex): AliasResolution | null {
  const searched = candidate.trim();
  const aliasNorm = normalisePartNumber(searched);
  if (!aliasNorm) return null;

  const hits = index.byNorm.get(aliasNorm);
  if (!hits || hits.length === 0) return null;

  const superseded = hits.find((alias) => alias.kind === "SUPERSEDED");
  if (!superseded) {
    const primary = hits.find((alias) => alias.kind === "PRIMARY");
    if (!primary) return null;
    return {
      sku: primary.sku,
      matchedBy: "primary",
      explanation: null,
      relevance: PINNED_PART_NUMBER_RELEVANCE,
    };
  }

  let sku = superseded.sku;
  let hops = 1;
  const seenNorms = new Set<string>([aliasNorm]);
  const seenSkus = new Set<string>([sku]);

  while (hops < MAX_SUPERSESSION_DEPTH) {
    const nextNorm = index.primaryNormBySku.get(sku);
    if (!nextNorm || seenNorms.has(nextNorm)) break;
    const next = (index.byNorm.get(nextNorm) ?? []).find((alias) => alias.kind === "SUPERSEDED");
    if (!next || seenSkus.has(next.sku)) break;
    seenNorms.add(nextNorm);
    seenSkus.add(next.sku);
    sku = next.sku;
    hops += 1;
  }

  return supersededHit(aliasNorm, sku, searched);
}

/** Resolve one normalised part-number candidate against alias rows. */
export function resolvePartNumberAlias(
  candidate: string,
  aliases: readonly PartNumberAlias[],
): AliasResolution | null {
  return resolveAgainst(candidate, indexAliases(aliases));
}

/** Resolve each candidate. Misses are omitted. */
export function resolvePartNumberAliases(
  candidates: readonly string[],
  aliases: readonly PartNumberAlias[],
): AliasResolution[] {
  const index = indexAliases(aliases);
  const results: AliasResolution[] = [];
  for (const candidate of candidates) {
    const hit = resolveAgainst(candidate, index);
    if (hit) results.push(hit);
  }
  return results;
}
