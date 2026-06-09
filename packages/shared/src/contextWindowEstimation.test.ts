import { describe, expect, it } from "@effect/vitest";

import {
  estimateContentTokens,
  parseContextWindowTokenValue,
  resolveContextWindowLimit,
} from "./contextWindowEstimation.ts";

describe("parseContextWindowTokenValue", () => {
  it("parses common compact forms", () => {
    expect(parseContextWindowTokenValue("200k")).toBe(200_000);
    expect(parseContextWindowTokenValue("1m")).toBe(1_000_000);
    expect(parseContextWindowTokenValue("1.5m")).toBe(1_500_000);
    expect(parseContextWindowTokenValue("0.5m")).toBe(500_000);
    expect(parseContextWindowTokenValue("2.75m")).toBe(2_750_000);
    expect(parseContextWindowTokenValue("10k")).toBe(10_000);
    expect(parseContextWindowTokenValue("5k")).toBe(5_000);
  });

  it("handles whitespace around the value", () => {
    expect(parseContextWindowTokenValue(" 200k ")).toBe(200_000);
    expect(parseContextWindowTokenValue("  1m")).toBe(1_000_000);
  });

  it("treats unit suffix case-insensitively", () => {
    expect(parseContextWindowTokenValue("200K")).toBe(200_000);
    expect(parseContextWindowTokenValue("1M")).toBe(1_000_000);
    expect(parseContextWindowTokenValue("1.5M")).toBe(1_500_000);
  });

  it("parses plain integer strings", () => {
    expect(parseContextWindowTokenValue("500")).toBe(500);
    expect(parseContextWindowTokenValue("8000")).toBe(8_000);
    expect(parseContextWindowTokenValue("128000")).toBe(128_000);
  });

  it("returns null for unrecognised input", () => {
    expect(parseContextWindowTokenValue("")).toBeNull();
    expect(parseContextWindowTokenValue("abc")).toBeNull();
    expect(parseContextWindowTokenValue("k")).toBeNull();
    expect(parseContextWindowTokenValue("m")).toBeNull();
    expect(parseContextWindowTokenValue("-5k")).toBeNull();
    expect(parseContextWindowTokenValue("0k")).toBeNull();
    expect(parseContextWindowTokenValue("0")).toBeNull();
    expect(parseContextWindowTokenValue("0.0m")).toBeNull();
  });

  it("treats leading zeros as ordinary digits", () => {
    expect(parseContextWindowTokenValue("01k")).toBe(1_000);
  });

  it("returns null for booleans coerced to strings", () => {
    expect(parseContextWindowTokenValue("true")).toBeNull();
    expect(parseContextWindowTokenValue("false")).toBeNull();
  });
});

describe("resolveContextWindowLimit", () => {
  it("finds the contextWindow option and parses its value", () => {
    expect(
      resolveContextWindowLimit([
        { id: "contextWindow", value: "200k" },
        { id: "fastMode", value: true },
      ]),
    ).toBe(200_000);

    expect(
      resolveContextWindowLimit([
        { id: "effort", value: "max" },
        { id: "contextWindow", value: "1m" },
      ]),
    ).toBe(1_000_000);
  });

  it("returns null when no contextWindow option is present", () => {
    expect(resolveContextWindowLimit(null)).toBeNull();
    expect(resolveContextWindowLimit(undefined)).toBeNull();
    expect(resolveContextWindowLimit([])).toBeNull();
    expect(
      resolveContextWindowLimit([
        { id: "fastMode", value: true },
        { id: "effort", value: "max" },
      ]),
    ).toBeNull();
  });

  it("returns null when contextWindow has a non-string value", () => {
    expect(resolveContextWindowLimit([{ id: "contextWindow", value: true }])).toBeNull();
  });

  it("returns null when contextWindow value cannot be parsed", () => {
    expect(resolveContextWindowLimit([{ id: "contextWindow", value: "invalid" }])).toBeNull();
  });
});

describe("estimateContentTokens", () => {
  it("returns the ceiling of character-count divided by chars-per-token", () => {
    expect(estimateContentTokens([{ text: "12345678" }, { text: "abcdefghijkl" }])).toBe(5);
    expect(estimateContentTokens([{ text: "a" }])).toBe(1);
    expect(estimateContentTokens([{ text: "ab" }])).toBe(1);
    expect(estimateContentTokens([{ text: "abc" }])).toBe(1);
    expect(estimateContentTokens([{ text: "abcd" }])).toBe(1);
    expect(estimateContentTokens([{ text: "abcde" }])).toBe(2);
  });

  it("returns 0 for empty segments", () => {
    expect(estimateContentTokens([])).toBe(0);
  });

  it("handles segments with empty text", () => {
    expect(estimateContentTokens([{ text: "" }, { text: "hello" }])).toBe(2);
  });

  it("treats missing or non-string text as zero-length", () => {
    const segments = [{ text: "hello" }, { text: "world" } as { text: string }] as const;
    expect(estimateContentTokens(segments)).toBe(3);
  });

  it("respects a custom chars-per-token ratio", () => {
    expect(estimateContentTokens([{ text: "1234567890" }], 2)).toBe(5);
  });

  it("defaults to ratio 4 when given a non-positive ratio", () => {
    expect(estimateContentTokens([{ text: "12345678" }], 0)).toBe(2);

    expect(estimateContentTokens([{ text: "12345678" }], -1)).toBe(2);
  });

  it("returns 0 when all segments have empty text", () => {
    expect(estimateContentTokens([{ text: "" }, { text: "" }])).toBe(0);
  });
});
