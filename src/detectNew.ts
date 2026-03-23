import { prisma } from "./db.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { filterNewUrls } from "./pipeline/detectNew.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";
import type { RawProduct } from "./adapters/types.js";

async function runDetectNew(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    try {
      let products: RawProduct[] = [];

      if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, unknown>) ?? {};
        const url =
          (cfg["new_arrivals_url"] as string) ??
          (cfg["entry_url"] as string) ??
          "";
        if (url) {
          products = await adapter.fetchProductsFromSite(url, 3);
        }
      }

      const candidateUrls = new Set(products.map((p) => p.sourceUrl).filter(Boolean));
      const newUrls = await filterNewUrls(prisma, candidateUrls);
      const newProducts = products.filter((p) => newUrls.has(p.sourceUrl));

      for (const raw of newProducts) {
        await ingestProduct(prisma, raw, source.id, undefined);
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
