import { prisma } from "@/lib/db";
import { CrawlPanel } from "./crawl-panel";
import { BrandSitesEditor } from "./brand-sites-editor";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const [jobs, brandSources] = await Promise.all([
    prisma.crawlJob.findMany({
      take: 20,
      orderBy: { startedAt: "desc" },
      include: { source: { select: { name: true } } },
    }),
    prisma.crawlSource.findMany({
      where: { adapterType: "ai_agent" },
      orderBy: { name: "asc" },
    }),
  ]);

  const sources = brandSources.map((s) => ({
    id: s.id,
    name: s.name,
    isActive: s.isActive,
    config: s.config as { entry_url: string; new_arrivals_url?: string; max_pages?: number } | null,
  }));

  return (
    <div className="space-y-8">
      <CrawlPanel initialJobs={jobs} />
      <BrandSitesEditor initialSources={sources} />
    </div>
  );
}
