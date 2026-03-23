"use server";

import { triggerWorkflow } from "@/lib/github";
import { prisma } from "@/lib/db";

export async function triggerCrawlAction(
  workflow: "crawl-weekly.yml" | "crawl-new.yml"
): Promise<{ ok: boolean; error?: string }> {
  try {
    await triggerWorkflow(workflow);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getJobsAction() {
  return prisma.crawlJob.findMany({
    take: 20,
    orderBy: { startedAt: "desc" },
    include: { source: { select: { name: true } } },
  });
}

export async function getQueriesAction(): Promise<string[]> {
  const source = await prisma.crawlSource.findFirst({
    where: { adapterType: "naver_api", isActive: true },
  });
  if (!source) return [];
  const config = (source.config as Record<string, unknown>) ?? {};
  return (config["queries"] as string[]) ?? [];
}

export async function saveQueriesAction(
  queries: string[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const source = await prisma.crawlSource.findFirst({
      where: { adapterType: "naver_api", isActive: true },
    });
    if (!source) return { ok: false, error: "네이버 크롤 소스를 찾을 수 없습니다." };

    await prisma.crawlSource.update({
      where: { id: source.id },
      data: { config: { queries } },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
