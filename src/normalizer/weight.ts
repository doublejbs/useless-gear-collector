const PATTERN = /([\d.]+)\s*(g|gram|grams|kg|kilogram|lbs?|pound|oz|ounce)/i;
const LBS_TO_G = 453.592;
const OZ_TO_G = 28.3495;
const KG_TO_G = 1000;

export function normalizeWeight(raw: string): string {
  if (!raw) return "";
  const m = raw.match(PATTERN);
  if (!m) return "";
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  let grams: number;
  if (unit.startsWith("kg") || unit.startsWith("kilo")) {
    grams = value * KG_TO_G;
  } else if (unit.startsWith("lb") || unit.startsWith("pound")) {
    grams = value * LBS_TO_G;
  } else if (unit.startsWith("oz") || unit.startsWith("ounce")) {
    grams = value * OZ_TO_G;
  } else {
    grams = value;
  }
  return `${Math.round(grams)}g`;
}
