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

export async function getBrandSourcesAction() {
  return prisma.crawlSource.findMany({
    where: { adapterType: "ai_agent" },
    orderBy: { name: "asc" },
  });
}

export async function saveBrandSourceAction(params: {
  id?: string;
  name: string;
  entryUrl: string;
  newArrivalsUrl?: string;
  maxPages?: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = {
      entry_url: params.entryUrl,
      ...(params.newArrivalsUrl ? { new_arrivals_url: params.newArrivalsUrl } : {}),
      ...(params.maxPages ? { max_pages: params.maxPages } : {}),
    };

    if (params.id) {
      await prisma.crawlSource.update({
        where: { id: params.id },
        data: { name: params.name, config },
      });
    } else {
      await prisma.crawlSource.create({
        data: {
          name: params.name,
          adapterType: "ai_agent",
          config,
          isActive: true,
        },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Soft-deletes a source (marks as inactive). Unlike toggleBrandSourceAction,
// this is intended as a permanent removal — the record is kept for historical FK integrity.
export async function deleteBrandSourceAction(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.crawlSource.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function toggleBrandSourceAction(
  id: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.crawlSource.update({
      where: { id },
      data: { isActive },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
