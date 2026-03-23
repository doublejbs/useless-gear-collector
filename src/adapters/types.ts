export interface RawProduct {
  sourceUrl: string;
  brandEn: string;
  nameEn: string;
  category: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  brandKr?: string;
  nameKr?: string;
  colorEn?: string;
  colorKr?: string;
  sizeEn?: string;
  weightRaw?: string;
  salesRegion?: string;
  specsRaw?: Record<string, string>;
  needsReviewFlag?: boolean;
}
