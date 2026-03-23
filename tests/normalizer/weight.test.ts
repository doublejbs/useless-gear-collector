import { describe, it, expect } from "vitest";
import { normalizeWeight } from "../../src/normalizer/weight.js";

describe("normalizeWeight", () => {
  it.each([
    ["850g", "850g"],
    ["0.85kg", "850g"],
    ["0.85 kg", "850g"],
    ["1.2 lbs", "544g"],
    ["1.2lbs", "544g"],
    ["1.2 lb", "544g"],
    ["544 grams", "544g"],
    ["", ""],
    ["unknown", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeWeight(raw)).toBe(expected);
  });
});
