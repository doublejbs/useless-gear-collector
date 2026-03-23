import { prisma } from "./db.js";
import { NaverAdapter } from "./adapters/naver.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { fetchPageHtml } from "./adapters/playwright.js";
import { filterNewUrls } from "./pipeline/detectNew.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";

async function runDetectNew(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    try {
      let products: Awaited<ReturnType<NaverAdapter["fetchProducts"]>> = [];
      if (source.adapterType === "naver_api") {
        const adapter = new NaverAdapter(config.naverClientId, config.naverClientSecret);
        products = await adapter.fetchNewProducts((source.config as Record<string, string>) ?? {});
      } else if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, string>) ?? {};
        const url = cfg["new_arrivals_url"] ?? cfg["entry_url"] ?? "";
        const html = await fetchPageHtml(url);
        if (html) products = await adapter.extractFromHtml(html, url);
      }

      const candidateUrls = new Set(products.map((p) => p.sourceUrl).filter(Boolean));
      const newUrls = await filterNewUrls(prisma, candidateUrls);
      const newProducts = products.filter((p) => newUrls.has(p.sourceUrl));

      for (const raw of newProducts) {
        await ingestProduct(prisma, raw, source.id, "detect_new");
      }
    } catch (err) {
      await sendSlackAlert(`:warning: New product detect FAILED: ${source.name}\n\`\`\`${err}\`\`\``);
    }
  }

  await prisma.$disconnect();
}

runDetectNew().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
