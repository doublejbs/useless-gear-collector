import { prisma } from "@/lib/db";
import { CrawlPanel } from "./crawl-panel";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const jobs = await prisma.crawlJob.findMany({
    take: 20,
    orderBy: { startedAt: "desc" },
    include: { source: { select: { name: true } } },
  });

  return <CrawlPanel initialJobs={jobs} />;
}
