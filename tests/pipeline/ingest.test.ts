import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ingestProduct } from "../../src/pipeline/ingest.js";
import type { RawProduct } from "../../src/adapters/types.js";

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

const SOURCE_ID = "00000000-0000-0000-0000-000000000001";
const JOB_ID = "00000000-0000-0000-0000-000000000002";

beforeEach(async () => {
  await prisma.priceHistory.deleteMany();
  await prisma.productSource.deleteMany();
  await prisma.crawlJob.deleteMany();
  await prisma.product.deleteMany();
  await prisma.crawlSource.deleteMany();
  await prisma.productIdSeq.deleteMany();
  await prisma.crawlSource.create({
    data: { id: SOURCE_ID, name: "rei", adapterType: "playwright" },
  });
});

function makeRaw(overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    sourceUrl: "https://rei.com/hubba",
    brandEn: "MSR", nameEn: "Hubba Hubba 2",
    category: "텐트", price: 450, currency: "USD",
    colorEn: "Green", sizeEn: "2P",
    weightRaw: "1.87 lbs",
    salesRegion: "해외",
    specsRaw: { 수용_인원: "2", 폴_소재: "알루미늄" },
    ...overrides,
  };
}

describe("ingestProduct", () => {
  it("creates a product row with normalized fields", async () => {
    const productId = await ingestProduct(prisma, makeRaw(), SOURCE_ID, JOB_ID);
    const p = await prisma.product.findUnique({ where: { productId } });
    expect(p).not.toBeNull();
    expect(p!.brandEn).toBe("MSR");
    expect(p!.weight).toBe("848g");
    expect((p!.specs as Record<string, string>)["수용_인원"]).toBe("2");
    expect(p!.salesRegion).toBe("해외");
  });

  it("upserts on same SKU — returns same product_id", async () => {
    const id1 = await ingestProduct(prisma, makeRaw(), SOURCE_ID, JOB_ID);
    const id2 = await ingestProduct(
      prisma,
      makeRaw({ sourceUrl: "https://rei.com/hubba-v2" }),
      SOURCE_ID, JOB_ID
    );
    expect(id1).toBe(id2);
  });

  it("creates product_source row", async () => {
    const productId = await ingestProduct(prisma, makeRaw(), SOURCE_ID, JOB_ID);
    const ps = await prisma.productSource.findFirst({ where: { productId } });
    expect(ps).not.toBeNull();
    expect(Number(ps!.price)).toBe(450);
  });

  it("sets needsReview=true for flagged products", async () => {
    const productId = await ingestProduct(
      prisma,
      makeRaw({ needsReviewFlag: true, brandEn: "", nameEn: "unknown", category: "그 외 기타" }),
      SOURCE_ID, JOB_ID
    );
    const p = await prisma.product.findUnique({ where: { productId } });
    expect(p!.needsReview).toBe(true);
  });
});
