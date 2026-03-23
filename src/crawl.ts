import { prisma } from "./db.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";
import type { RawProduct } from "./adapters/types.js";

async function runCrawl(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    const job = await prisma.crawlJob.create({
      data: { sourceId: source.id, status: "running", startedAt: new Date() },
    });

    let itemsFound = 0;
    try {
      let products: RawProduct[] = [];

      if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, unknown>) ?? {};
        const entryUrl = (cfg["entry_url"] as string) ?? "";
        const maxPages = (cfg["max_pages"] as number) ?? 20;
        if (entryUrl) {
          products = await adapter.fetchProductsFromSite(entryUrl, maxPages);
        }
      } else if (source.adapterType === "playwright") {
        // TODO: playwright-only sources (REI, Backcountry 등) — 별도 구현 예정
        products = [];
      }

      for (const raw of products) {
        await ingestProduct(prisma, raw, source.id, job.id);
        itemsFound++;
      }

      await prisma.crawlJob.update({
        where: { id: job.id },
        data: { status: "done", finishedAt: new Date(), itemsFound, itemsUpdated: itemsFound },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.crawlJob.update({
        where: { id: job.id },
        data: { status: "failed", finishedAt: new Date(), error: message },
      });
      await sendSlackAlert(`:red_circle: Crawl FAILED: ${source.name}\n\`\`\`${message}\`\`\``);
    }
  }

  await prisma.$disconnect();
}

runCrawl().catch(async (err) => {
  console.error(err);
  await sendSlackAlert(`:red_circle: Crawl script crashed: ${err}`);
  process.exit(1);
});
