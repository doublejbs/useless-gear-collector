const PATTERN = /(-?[\d.]+)\s*°?\s*(C|F)/i;

export function normalizeTemperature(raw: string): string {
  if (!raw) return "";
  const m = raw.match(PATTERN);
  if (!m) return "";
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const celsius = unit === "F" ? (value - 32) * 5 / 9 : value;
  return `${Math.round(celsius)}°C`;
}
