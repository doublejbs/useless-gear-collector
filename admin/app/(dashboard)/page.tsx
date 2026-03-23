import { prisma } from "@/lib/db";
import { CrawlPanel } from "./crawl-panel";
import { QueryEditor } from "./query-editor";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const [jobs, source] = await Promise.all([
    prisma.crawlJob.findMany({
      take: 20,
      orderBy: { startedAt: "desc" },
      include: { source: { select: { name: true } } },
    }),
    prisma.crawlSource.findFirst({
      where: { adapterType: "naver_api", isActive: true },
    }),
  ]);

  const config = (source?.config as Record<string, unknown>) ?? {};
  const queries = (config["queries"] as string[]) ?? [];

  return (
    <div className="space-y-8">
      <CrawlPanel initialJobs={jobs} />
      <QueryEditor initialQueries={queries} />
    </div>
  );
}
