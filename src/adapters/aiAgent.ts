import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { RawProduct } from "./types.js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_HTML_BYTES = 5_000;
const SYSTEM_PROMPT = `당신은 백패킹 장비 제품 페이지에서 정보를 추출하는 전문가입니다.
주어진 HTML에서 제품 정보를 아래 JSON 형식으로 추출하세요:
{"brand_en":"","brand_kr":"","name_en":"","name_kr":"","category":"",
"color_en":"","color_kr":"","size_en":"","weight_raw":"","specs_raw":{}}
JSON 외 다른 텍스트는 출력하지 마세요.`;

export function stripHtmlNoise(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, noscript").remove();
  const cleaned = $.html();
  return Buffer.from(cleaned, "utf8").slice(0, MAX_HTML_BYTES).toString("utf8");
}

export class AIAgentAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractFromHtml(html: string, sourceUrl: string): Promise<RawProduct[]> {
    const cleaned = stripHtmlNoise(html);
    try {
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: cleaned }],
      });
      const text = (message.content[0] as { text: string }).text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return [{
        sourceUrl,
        brandEn: String(data["brand_en"] ?? ""),
        brandKr: String(data["brand_kr"] ?? ""),
        nameEn: String(data["name_en"] ?? ""),
        nameKr: String(data["name_kr"] ?? ""),
        category: String(data["category"] ?? ""),
        colorEn: String(data["color_en"] ?? ""),
        colorKr: String(data["color_kr"] ?? ""),
        sizeEn: String(data["size_en"] ?? ""),
        weightRaw: String(data["weight_raw"] ?? ""),
        specsRaw: (data["specs_raw"] as Record<string, string>) ?? {},
      }];
    } catch {
      return [{ sourceUrl, brandEn: "", nameEn: "", category: "", specsRaw: {}, needsReviewFlag: true }];
    }
  }
}
