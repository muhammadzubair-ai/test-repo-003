import { describe, expect, it } from "vitest";
import {
  isPartNumberCandidate,
  normalisePartNumber,
  partNumberCandidate,
} from "../src/api/part-number";

describe("normalisePartNumber", () => {
  it("maps spaced and compact Bosch-style numbers to the same form", () => {
    expect(normalisePartNumber("0986 494 104")).toBe("0986494104");
    expect(normalisePartNumber("0986494104")).toBe("0986494104");
  });

  it("upper-cases and strips hyphens, dots and slashes", () => {
    expect(normalisePartNumber("ab-12.3/4")).toBe("AB1234");
  });
});

describe("isPartNumberCandidate / partNumberCandidate", () => {
  it("treats a single token as a candidate", () => {
    expect(isPartNumberCandidate("0986494104")).toBe(true);
    expect(partNumberCandidate("0986494104")).toBe("0986494104");
  });

  it("treats digit-bearing token groups as a candidate", () => {
    expect(isPartNumberCandidate("0986 494 104")).toBe(true);
    expect(partNumberCandidate("0986 494 104")).toBe("0986494104");
  });

  it("does not concatenate multi-word free text into one part number", () => {
    const query = "front brake pads bmw x5";
    expect(isPartNumberCandidate(query)).toBe(false);
    expect(partNumberCandidate(query)).toBeNull();
  });

  it("rejects a multi-token query when any token is a vocabulary word", () => {
    const vocab = new Set(["PAD", "BRAKE"]);
    expect(isPartNumberCandidate("0986 PAD 104", vocab)).toBe(false);
  });
});
