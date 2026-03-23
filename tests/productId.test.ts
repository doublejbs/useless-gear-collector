import { describe, it, expect, beforeEach } from "vitest";
import { generateProductId } from "../src/productId.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

beforeEach(async () => {
  await prisma.productIdSeq.deleteMany();
});

describe("generateProductId", () => {
  it("formats as YYMMDDnn", async () => {
    const id = await generateProductId(prisma, new Date("2026-03-22"));
    expect(id).toBe("26032201");
  });

  it("increments sequentially on same day", async () => {
    const id1 = await generateProductId(prisma, new Date("2026-03-22"));
    const id2 = await generateProductId(prisma, new Date("2026-03-22"));
    expect(id1).toBe("26032201");
    expect(id2).toBe("26032202");
  });

  it("resets on next day", async () => {
    await generateProductId(prisma, new Date("2026-03-22"));
    const id = await generateProductId(prisma, new Date("2026-03-23"));
    expect(id).toBe("26032301");
  });

  it("uses 3 digits when seq exceeds 99", async () => {
    for (let i = 0; i < 100; i++) {
      await generateProductId(prisma, new Date("2026-03-22"));
    }
    const id = await generateProductId(prisma, new Date("2026-03-22"));
    expect(id).toBe("260322101");
    expect(id.length).toBeGreaterThan(8);
  });
});
