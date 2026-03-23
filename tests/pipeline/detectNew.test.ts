import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { filterNewUrls } from "../../src/pipeline/detectNew.js";

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

beforeEach(async () => {
  await prisma.productSource.deleteMany();
  await prisma.product.deleteMany();
  await prisma.crawlSource.deleteMany();
  const source = await prisma.crawlSource.create({
    data: { name: "test-src", adapterType: "playwright" },
  });
  const product = await prisma.product.create({
    data: {
      productId: "26032201", groupId: "g", category: "텐트",
      brandEn: "X", nameEn: "Y", colorEn: "", sizeEn: "",
    },
  });
  await prisma.productSource.create({
    data: {
      productId: product.productId,
      sourceId: source.id,
      sourceUrl: "https://rei.com/old-product",
      status: "active",
    },
  });
});

describe("filterNewUrls", () => {
  it("returns only URLs not in DB", async () => {
    const candidates = new Set([
      "https://rei.com/old-product",
      "https://rei.com/new-product",
    ]);
    const newUrls = await filterNewUrls(prisma, candidates);
    expect(newUrls).toEqual(new Set(["https://rei.com/new-product"]));
  });

  it("returns empty set for empty input", async () => {
    expect(await filterNewUrls(prisma, new Set())).toEqual(new Set());
  });
});
