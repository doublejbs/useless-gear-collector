import { describe, it, expect, vi } from "vitest";
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
