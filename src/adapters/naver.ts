import type { RawProduct } from "./types.js";

const API_URL = "https://openapi.naver.com/v1/search/shop.json";

export class NaverAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async fetchProducts(config: { query?: string; display?: number }): Promise<RawProduct[]> {
    const params = new URLSearchParams({
      query: config.query ?? "백패킹",
      display: String(config.display ?? 100),
    });
    const res = await fetch(`${API_URL}?${params}`, {
      headers: {
        "X-Naver-Client-Id": this.clientId,
        "X-Naver-Client-Secret": this.clientSecret,
      },
    });
    if (!res.ok) throw new Error(`Naver API error: ${res.status}`);
    const data = await res.json() as { items: Record<string, string>[] };
    return data.items.map((item) => this.parse(item));
  }

  async fetchNewProducts(config: { query?: string }): Promise<RawProduct[]> {
    return this.fetchProducts({ ...config, query: config.query ?? "신상" });
  }

  private parse(item: Record<string, string>): RawProduct {
    return {
      sourceUrl: item["link"] ?? "",
      brandEn: item["brand"] ?? "",
      nameEn: (item["title"] ?? "").replace(/<[^>]+>/g, ""),
      category: item["category3"] ?? item["category2"] ?? "",
      price: item["lprice"] ? parseFloat(item["lprice"]) : undefined,
      currency: "KRW",
      imageUrl: item["image"] ?? "",
      salesRegion: "국내",
    };
  }
}
