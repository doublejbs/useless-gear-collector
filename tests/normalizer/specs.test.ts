import { describe, it, expect } from "vitest";
import { normalizeSpecs, CATEGORY_SPEC_KEYS } from "../../src/normalizer/specs.js";

describe("CATEGORY_SPEC_KEYS", () => {
  it("covers exactly 34 categories", () => {
    expect(Object.keys(CATEGORY_SPEC_KEYS).length).toBe(34);
  });
});

describe("normalizeSpecs", () => {
  it("drops unknown keys", () => {
    const result = normalizeSpecs("텐트", { 수용_인원: "2", unknown_key: "drop" });
    expect("unknown_key" in result).toBe(false);
    expect(result["수용_인원"]).toBe("2");
  });

  it("fills missing keys with empty string", () => {
    const result = normalizeSpecs("침낭", {});
    for (const key of CATEGORY_SPEC_KEYS["침낭"]!) {
      expect(result[key]).toBe("");
    }
  });

  it("returns empty object for unknown category", () => {
    expect(normalizeSpecs("없는카테고리", {})).toEqual({});
  });

  it("normalizes weight in sleeping bag fill weight", () => {
    const result = normalizeSpecs("침낭", { 충전량: "1.2 lbs" });
    expect(result["충전량"]).toBe("544g");
  });

  it("normalizes temperature in sleeping bag", () => {
    const result = normalizeSpecs("침낭", { 온도_comfort: "20°F" });
    expect(result["온도_comfort"]).toBe("-7°C");
  });
});
