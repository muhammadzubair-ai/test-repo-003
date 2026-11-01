import { describe, expect, it } from "vitest";
import { RRF_K, fuseResults, type FusedResult } from "../src/api/fusion";

function bySku(results: FusedResult[], sku: string): FusedResult {
  const found = results.filter((result) => result.sku === sku);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("fuseResults", () => {
  it("emits a SKU in both lexical and semantic lists once, with both retrievers", () => {
    const results = fuseResults({
      lexical: ["SKU-1", "SKU-2"],
      semantic: ["SKU-2", "SKU-1"],
    });

    const sku1 = bySku(results, "SKU-1");
    expect(sku1.matchers).toEqual(["lexical", "semantic"]);
    expect(results.filter((result) => result.sku === "SKU-1")).toHaveLength(1);
    expect(new Set(results.map((result) => result.sku)).size).toBe(results.length);
  });

  it("pins an exact part-number hit at relevance 1.0", () => {
    const results = fuseResults({
      "part-number": ["SKU-EXACT"],
      lexical: ["SKU-OTHER", "SKU-EXACT"],
    });

    expect(bySku(results, "SKU-EXACT").relevance).toBe(1);
    expect(bySku(results, "SKU-EXACT").matchers).toEqual(["part-number", "lexical"]);
  });

  it("pins a superseded hit at relevance 1.0", () => {
    const results = fuseResults({
      supersession: ["SKU-OLD"],
    });

    expect(bySku(results, "SKU-OLD")).toEqual({
      sku: "SKU-OLD",
      relevance: 1,
      matchers: ["supersession"],
    });
  });

  it("scores a non-pinned SKU as Σ 1/(60 + rank)", () => {
    const results = fuseResults({
      lexical: ["SKU-A", "SKU-B"],
      semantic: ["SKU-B"],
      symptom: ["SKU-C"],
    });

    // lexical rank 1
    expect(bySku(results, "SKU-A").relevance).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(bySku(results, "SKU-A").matchers).toEqual(["lexical"]);

    // lexical rank 2 + semantic rank 1
    expect(bySku(results, "SKU-B").relevance).toBeCloseTo(
      1 / (RRF_K + 2) + 1 / (RRF_K + 1),
      12,
    );
    expect(bySku(results, "SKU-B").matchers).toEqual(["lexical", "semantic"]);

    expect(bySku(results, "SKU-C").matchers).toEqual(["symptom"]);
    expect(bySku(results, "SKU-C").relevance).toBeGreaterThan(0);
    expect(bySku(results, "SKU-C").relevance).toBeLessThan(1);
  });

  it("keeps the best rank when a list repeats a SKU", () => {
    const results = fuseResults({
      lexical: ["SKU-A", "SKU-B", "SKU-A"],
    });

    expect(bySku(results, "SKU-A").relevance).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(bySku(results, "SKU-A").matchers).toEqual(["lexical"]);
  });

  it("orders higher relevance first and returns nothing for empty lists", () => {
    expect(fuseResults({})).toEqual([]);
    expect(fuseResults({ lexical: [], semantic: [] })).toEqual([]);

    const results = fuseResults({
      lexical: ["SKU-LOW"],
      semantic: ["SKU-HIGH"],
      symptom: ["SKU-HIGH"],
    });

    expect(results.map((result) => result.sku)).toEqual(["SKU-HIGH", "SKU-LOW"]);
  });
});
