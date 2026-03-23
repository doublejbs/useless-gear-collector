import { describe, it, expect, vi } from "vitest";
import { NaverAdapter } from "../../src/adapters/naver.js";

const MOCK_RESPONSE = {
  items: [{
    title: "<b>MSR</b> Hubba Hubba 2",
    link: "https://shopping.naver.com/hubba",
    image: "https://image.naver.com/hubba.jpg",
    lprice: "450000",
    brand: "MSR",
    category3: "텐트",
  }],
};

describe("NaverAdapter", () => {
  it("parses items and strips HTML from title", async () => {
    const adapter = new NaverAdapter("test-id", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const products = await adapter.fetchProducts({ query: "텐트" });

    expect(products).toHaveLength(1);
    expect(products[0].brandEn).toBe("MSR");
    expect(products[0].price).toBe(450000);
    expect(products[0].currency).toBe("KRW");
    expect(products[0].nameEn).not.toContain("<b>");
  });

  it("sets salesRegion to 국내", async () => {
    const adapter = new NaverAdapter("id", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));
    const products = await adapter.fetchProducts({ query: "텐트" });
    expect(products[0].salesRegion).toBe("국내");
  });
});
