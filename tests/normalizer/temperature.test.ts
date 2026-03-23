import { describe, it, expect } from "vitest";
import { normalizeTemperature } from "../../src/normalizer/temperature.js";

describe("normalizeTemperature", () => {
  it.each([
    ["-7°C", "-7°C"],
    ["-7 °C", "-7°C"],
    ["20°F", "-7°C"],
    ["32°F", "0°C"],
    ["-40°F", "-40°C"],
    ["0°C", "0°C"],
    ["", ""],
    ["n/a", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeTemperature(raw)).toBe(expected);
  });
});
