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
