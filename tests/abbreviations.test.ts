import { describe, expect, it } from "vitest";
import dictionary from "../src/api/query/abbreviations.json";
import { expandAbbreviations } from "../src/api/query/abbreviations";

describe("expandAbbreviations", () => {
  it("adds 'air conditioning' for 'ac compressor' and records the interpretation", () => {
    const result = expandAbbreviations("ac compressor");

    expect(result.added).toContain("air conditioning");
    expect(result.interpretations).toEqual([
      { token: "ac", expansion: "air conditioning" },
    ]);
    expect(result.originalTokens).toEqual(["ac", "compressor"]);
    expect(result.lexicalTokens).toEqual([
      "ac",
      "compressor",
      "air",
      "conditioning",
    ]);
  });

  it("keeps the original token when the abbreviation is written a/c", () => {
    const result = expandAbbreviations("a/c compressor");

    expect(result.added).toEqual(["air conditioning"]);
    expect(result.interpretations).toEqual([
      { token: "a/c", expansion: "air conditioning" },
    ]);
    expect(result.lexicalTokens).toContain("a/c");
    expect(result.lexicalTokens).toEqual(
      expect.arrayContaining(["air", "conditioning"]),
    );
  });

  it("expands the other Search_Log abbreviations without dropping surrounding tokens", () => {
    expect(expandAbbreviations("lh headlight").added).toEqual(["left"]);
    expect(expandAbbreviations("RH light").interpretations).toEqual([
      { token: "RH", expansion: "right" },
    ]);
    expect(expandAbbreviations("abs sensor").lexicalTokens).toEqual([
      "abs",
      "sensor",
      "anti-lock",
      "brake",
    ]);
  });

  it("records nothing when the query has no abbreviation", () => {
    const result = expandAbbreviations("front brake pads");
    expect(result.added).toEqual([]);
    expect(result.interpretations).toEqual([]);
    expect(result.lexicalTokens).toEqual(["front", "brake", "pads"]);
  });
});

describe("abbreviations dictionary", () => {
  it("maps the ARCH-6 abbreviations", () => {
    expect(dictionary).toEqual({
      ac: "air conditioning",
      frt: "front",
      rr: "rear",
      lh: "left",
      rh: "right",
      assy: "assembly",
      abs: "anti-lock brake",
    });
  });
});
