import type { PrismaClient } from "@prisma/client";

export async function generateProductId(
  prisma: PrismaClient,
  today: Date = new Date()
): Promise<string> {
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateKey = `${yy}${mm}${dd}`;

  const row = await prisma.productIdSeq.upsert({
    where: { dateKey },
    update: { lastSeq: { increment: 1 } },
    create: { dateKey, lastSeq: 1 },
    select: { lastSeq: true },
  });

  const seq = row.lastSeq <= 99
    ? String(row.lastSeq).padStart(2, "0")
    : String(row.lastSeq);

  return `${dateKey}${seq}`;
}
