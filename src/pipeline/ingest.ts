import type { PrismaClient } from "@prisma/client";
import type { RawProduct } from "../adapters/types.js";
import { generateProductId } from "../productId.js";
import { normalizeWeight } from "../normalizer/weight.js";
import { normalizeSizeKr } from "../normalizer/size.js";
import { normalizeSpecs } from "../normalizer/specs.js";

async function resolveBrand(prisma: PrismaClient, brandEn: string): Promise<string> {
  const alias = await prisma.brandAlias.findUnique({ where: { alias: brandEn } });
  return alias?.canonical ?? brandEn;
}

export async function ingestProduct(
  prisma: PrismaClient,
  raw: RawProduct,
  sourceId: string,
  jobId: string,
): Promise<string> {
  const brandEn = await resolveBrand(prisma, raw.brandEn);
  const weight = normalizeWeight(raw.weightRaw ?? "");
  const sizeKr = normalizeSizeKr(raw.sizeEn ?? "");
  const specs = normalizeSpecs(raw.category, raw.specsRaw ?? {});
  const needsReview = raw.needsReviewFlag ?? false;

  const existing = await prisma.product.findFirst({
    where: { brandEn, nameEn: raw.nameEn, colorEn: raw.colorEn ?? "", sizeEn: raw.sizeEn ?? "" },
    select: { productId: true },
  });

  let productId: string;

  if (existing) {
    productId = existing.productId;
    await prisma.product.update({
      where: { productId },
      data: {
        ...(weight && { weight }),
        ...(Object.keys(specs).length && { specs }),
        ...(raw.brandKr && { brandKr: raw.brandKr }),
        ...(raw.nameKr && { nameKr: raw.nameKr }),
        ...(raw.colorKr && { colorKr: raw.colorKr }),
        ...(raw.salesRegion && { salesRegion: raw.salesRegion }),
        ...(needsReview && { needsReview: true }),
      },
    });
  } else {
    productId = await generateProductId(prisma);
    const groupId = `${brandEn}_${raw.nameEn}`.toLowerCase().replace(/[\s-]/g, "_");
    await prisma.product.create({
      data: {
        productId,
        groupId,
        category: raw.category,
        brandEn,
        brandKr: raw.brandKr ?? "",
        nameEn: raw.nameEn,
        nameKr: raw.nameKr ?? "",
        colorEn: raw.colorEn ?? "",
        colorKr: raw.colorKr ?? "",
        sizeEn: raw.sizeEn ?? "",
        sizeKr,
        weight,
        salesRegion: raw.salesRegion ?? "",
        specs,
        needsReview,
      },
    });
  }

  // product_source upsert
  const existingSource = await prisma.productSource.findUnique({
    where: { sourceUrl: raw.sourceUrl },
    select: { id: true, price: true },
  });

  if (!existingSource) {
    await prisma.productSource.create({
      data: {
        productId,
        sourceId,
        crawlJobId: jobId,
        sourceUrl: raw.sourceUrl,
        price: raw.price,
        currency: raw.currency,
        imageUrl: raw.imageUrl,
        lastCrawledAt: new Date(),
      },
    });
  } else {
    const oldPrice = existingSource.price ? Number(existingSource.price) : null;
    if (raw.price !== undefined && raw.price !== oldPrice) {
      await prisma.priceHistory.create({
        data: { productSourceId: existingSource.id, price: raw.price, currency: raw.currency },
      });
    }
    await prisma.productSource.update({
      where: { id: existingSource.id },
      data: { price: raw.price, crawlJobId: jobId, lastCrawledAt: new Date() },
    });
  }

  return productId;
}
