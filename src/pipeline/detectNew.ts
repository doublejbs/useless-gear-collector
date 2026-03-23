import type { PrismaClient } from "@prisma/client";

export async function filterNewUrls(
  prisma: PrismaClient,
  candidates: Set<string>
): Promise<Set<string>> {
  if (candidates.size === 0) return new Set();
  const existing = await prisma.productSource.findMany({
    where: { sourceUrl: { in: [...candidates] } },
    select: { sourceUrl: true },
  });
  const existingUrls = new Set(existing.map((r) => r.sourceUrl));
  return new Set([...candidates].filter((u) => !existingUrls.has(u)));
}
