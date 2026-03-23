import { prisma } from "./db.js";
import { NaverAdapter } from "./adapters/naver.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { fetchPageHtml } from "./adapters/playwright.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";

async function runCrawl(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    const job = await prisma.crawlJob.create({
      data: { sourceId: source.id, status: "running", startedAt: new Date() },
    });

    let itemsFound = 0;
    try {
      let products: Awaited<ReturnType<NaverAdapter["fetchProducts"]>> = [];
      if (source.adapterType === "naver_api") {
        const adapter = new NaverAdapter(config.naverClientId, config.naverClientSecret);
        const cfg = (source.config as Record<string, unknown>) ?? {};
        const queries = (cfg["queries"] as string[]) ?? [cfg["query"] as string ?? "백패킹"];
        for (const q of queries) {
          const batch = await adapter.fetchProducts({ query: q });
          products.push(...batch);
        }
      } else if (source.adapterType === "playwright") {
        const cfg = (source.config as Record<string, string>) ?? {};
        const html = await fetchPageHtml(cfg["entry_url"] ?? "");
        products = html ? [] : [];
      } else if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, string>) ?? {};
        const html = await fetchPageHtml(cfg["entry_url"] ?? "");
        if (html) products = await adapter.extractFromHtml(html, cfg["entry_url"] ?? "");
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
