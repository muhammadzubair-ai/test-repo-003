import { describe, expect, it } from "vitest";
import {
  resolvePartNumberAlias,
  resolvePartNumberAliases,
  type PartNumberAlias,
} from "../src/api/supersession";

const direct: PartNumberAlias[] = [
  { aliasNorm: "OLD1", sku: "SKU-NEW", kind: "SUPERSEDED" },
  { aliasNorm: "NEW1", sku: "SKU-NEW", kind: "PRIMARY" },
];

describe("resolvePartNumberAlias", () => {
  it("returns the superseding SKU with matchedBy superseded", () => {
    const hit = resolvePartNumberAlias("OLD1", direct);

    expect(hit).toEqual({
      sku: "SKU-NEW",
      matchedBy: "superseded",
      explanation: "replaces superseded part number OLD1",
      relevance: 1,
    });
  });

  it("follows a chain to the latest SKU", () => {
    const aliases: PartNumberAlias[] = [
      { aliasNorm: "A", sku: "SKU-B", kind: "SUPERSEDED" },
      { aliasNorm: "B", sku: "SKU-B", kind: "PRIMARY" },
      { aliasNorm: "B", sku: "SKU-C", kind: "SUPERSEDED" },
      { aliasNorm: "C", sku: "SKU-C", kind: "PRIMARY" },
    ];

    expect(resolvePartNumberAlias("A", aliases)?.sku).toBe("SKU-C");
    expect(resolvePartNumberAlias("A", aliases)?.matchedBy).toBe("superseded");
  });

  it("stops on a supersession cycle without looping", () => {
    const aliases: PartNumberAlias[] = [
      { aliasNorm: "A1", sku: "SKU-B", kind: "SUPERSEDED" },
      { aliasNorm: "B1", sku: "SKU-B", kind: "PRIMARY" },
      { aliasNorm: "B1", sku: "SKU-A", kind: "SUPERSEDED" },
      { aliasNorm: "A1", sku: "SKU-A", kind: "PRIMARY" },
    ];

    const hit = resolvePartNumberAlias("A1", aliases);

    expect(hit?.sku).toBe("SKU-A");
    expect(hit?.matchedBy).toBe("superseded");
    expect(hit?.explanation).toBe("replaces superseded part number A1");
  });

  it("stops at depth 5", () => {
    const aliases: PartNumberAlias[] = [];
    for (let hop = 1; hop <= 6; hop++) {
      const from = hop === 1 ? "N0" : `N${hop - 1}`;
      aliases.push({ aliasNorm: from, sku: `SKU-${hop}`, kind: "SUPERSEDED" });
      aliases.push({ aliasNorm: `N${hop}`, sku: `SKU-${hop}`, kind: "PRIMARY" });
    }

    expect(resolvePartNumberAlias("N0", aliases)?.sku).toBe("SKU-5");
  });

  it("returns the PRIMARY SKU when the alias is not superseded", () => {
    const hit = resolvePartNumberAlias("new-1", [
      { aliasNorm: "NEW1", sku: "SKU-NEW", kind: "PRIMARY" },
    ]);

    expect(hit).toEqual({
      sku: "SKU-NEW",
      matchedBy: "primary",
      explanation: null,
      relevance: 1,
    });
  });

  it("resolves each normalised candidate", () => {
    const hits = resolvePartNumberAliases(["OLD1", "missing", "NEW1"], direct);

    expect(hits.map((hit) => hit.sku)).toEqual(["SKU-NEW", "SKU-NEW"]);
    expect(hits.map((hit) => hit.matchedBy)).toEqual(["superseded", "primary"]);
  });
});
