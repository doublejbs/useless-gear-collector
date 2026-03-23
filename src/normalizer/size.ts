const SIZE_MAP: Record<string, string> = {
  regular: "레귤러", r: "레귤러",
  "long wide": "롱와이드", lw: "롱와이드",
  long: "롱", l: "롱",
  large: "라지",
  short: "숏", s: "숏",
  small: "스몰",
  medium: "미디엄", m: "미디엄",
  레귤러: "레귤러", 롱: "롱", 롱와이드: "롱와이드",
  라지: "라지", 숏: "숏", 스몰: "스몰", 미디엄: "미디엄",
};

export function normalizeSizeKr(raw: string): string {
  return SIZE_MAP[raw.trim().toLowerCase()] ?? "";
}
