import type { RawProduct } from "./types.js";

const API_URL = "https://openapi.naver.com/v1/search/shop.json";

export class NaverAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async fetchProducts(config: { query?: string; display?: number; maxPages?: number }): Promise<RawProduct[]> {
    const query = config.query ?? "백패킹";
    const display = config.display ?? 100;
    const maxPages = config.maxPages ?? 10;
    const all: RawProduct[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const start = (page - 1) * display + 1;
      if (start > 1000) break; // 네이버 API 최대 start=1000

      const params = new URLSearchParams({
        query,
        display: String(display),
        start: String(start),
      });
      const res = await fetch(`${API_URL}?${params}`, {
        headers: {
          "X-Naver-Client-Id": this.clientId,
          "X-Naver-Client-Secret": this.clientSecret,
        },
      });
      if (!res.ok) throw new Error(`Naver API error: ${res.status}`);
      const data = await res.json() as { items: Record<string, string>[]; total: number };
      const items = data.items.map((item) => this.parse(item));
      all.push(...items);

      // 더 이상 결과 없으면 중단
      if (items.length < display || start + display > data.total) break;

      // API 부하 방지 딜레이
      await new Promise((r) => setTimeout(r, 300));
    }

    return all;
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
