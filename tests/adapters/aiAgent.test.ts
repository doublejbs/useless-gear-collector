import { describe, it, expect, vi, beforeEach } from "vitest";
import { stripHtmlNoise, AIAgentAdapter } from "../../src/adapters/aiAgent.js";

describe("stripHtmlNoise", () => {
  it("removes script tags", () => {
    const html = "<html><script>alert(1)</script><div>Weight: 850g</div></html>";
    const result = stripHtmlNoise(html);
    expect(result).not.toContain("alert");
    expect(result).toContain("850g");
  });

  it("truncates to 5KB", () => {
    const html = "<html>" + "x".repeat(100_000) + "</html>";
    const result = stripHtmlNoise(html);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(5_000);
  });
});

describe("AIAgentAdapter", () => {
  it("parses valid JSON response", async () => {
    const adapter = new AIAgentAdapter("test-key");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: '{"brand_en":"MSR","name_en":"Hubba","category":"텐트","specs_raw":{"수용_인원":"2"}}' }],
    });
    vi.spyOn(adapter["client"].messages, "create").mockImplementation(mockCreate);

    const products = await adapter.extractFromHtml("<html/>", "https://msr.com");
    expect(products[0].brandEn).toBe("MSR");
    expect(products[0].specsRaw?.["수용_인원"]).toBe("2");
  });

  it("returns needsReviewFlag=true on invalid JSON", async () => {
    const adapter = new AIAgentAdapter("test-key");
    vi.spyOn(adapter["client"].messages, "create").mockResolvedValue({
      content: [{ text: "not json" }],
    });

    const products = await adapter.extractFromHtml("<html/>", "https://x.com/product");
    expect(products[0].needsReviewFlag).toBe(true);
    expect(products[0].specsRaw).toEqual({});
  });
});

import * as playwright from "../../src/adapters/playwright.js";

describe("AIAgentAdapter.fetchProductsFromSite", () => {
  let adapter: AIAgentAdapter;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new AIAgentAdapter("test-key");
    mockCreate = vi.fn();
    vi.spyOn(adapter["client"].messages, "create").mockImplementation(mockCreate);
  });

  it("단일 페이지: 제품 목록을 반환하고 nextPageUrl이 null이면 종료", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "Tent", category: "", price: 500, currency: "USD", imageUrl: "" }],
          nextPageUrl: null,
        }),
      }],
    });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(1);
    expect(results[0].brandEn).toBe("MSR");
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(1);
  });

  it("다음 페이지 링크를 따라 여러 페이지 순회", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "P1", category: "", price: 100, currency: "USD", imageUrl: "" }],
            nextPageUrl: "https://brand.com/products?page=2",
          }),
        }],
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            products: [{ sourceUrl: "https://brand.com/p2", brandEn: "MSR", nameEn: "P2", category: "", price: 200, currency: "USD", imageUrl: "" }],
            nextPageUrl: null,
          }),
        }],
      });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(2);
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(2);
  });

  it("이미 방문한 URL은 다시 방문하지 않음 (순환 링크 방지)", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "P1", category: "", price: 100, currency: "USD", imageUrl: "" }],
          nextPageUrl: "https://brand.com/products", // 첫 페이지로 돌아오는 순환
        }),
      }],
    });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(1);
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(1);
  });

  it("maxPages를 초과하면 순회를 중단", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    let pageNum = 1;
    mockCreate.mockImplementation(async () => ({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: `https://brand.com/p${pageNum}`, brandEn: "X", nameEn: `P${pageNum++}`, category: "", price: 100, currency: "USD", imageUrl: "" }],
          nextPageUrl: `https://brand.com/products?page=${pageNum}`,
        }),
      }],
    }));

    const results = await adapter.fetchProductsFromSite("https://brand.com/products", 3);
    expect(results).toHaveLength(3);
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(3);
  });

  it("fetchPageHtml이 null을 반환하면 빈 배열 반환", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue(null);
    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toEqual([]);
  });

  it("Haiku 응답이 JSON이 아닌 경우 해당 페이지 건너뜀", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({ content: [{ text: "not json" }] });
    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toEqual([]);
  });
});
