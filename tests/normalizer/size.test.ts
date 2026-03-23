import { describe, it, expect } from "vitest";
import { normalizeSizeKr } from "../../src/normalizer/size.js";

describe("normalizeSizeKr", () => {
  it.each([
    ["Regular", "레귤러"],
    ["regular", "레귤러"],
    ["R", "레귤러"],
    ["Long", "롱"],
    ["L", "롱"],
    ["Long Wide", "롱와이드"],
    ["LW", "롱와이드"],
    ["Large", "라지"],
    ["Short", "숏"],
    ["S", "숏"],
    ["Small", "스몰"],
    ["Medium", "미디엄"],
    ["M", "미디엄"],
    ["레귤러", "레귤러"],
    ["", ""],
    ["XL", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeSizeKr(raw)).toBe(expected);
  });
});
