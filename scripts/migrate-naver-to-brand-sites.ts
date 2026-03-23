/**
 * 실행: npx tsx scripts/migrate-naver-to-brand-sites.ts
 *
 * 동작:
 * 1. 기존 naver_api 소스를 is_active=false로 비활성화
 * 2. 해당 소스의 product_sources를 status="discontinued"로 업데이트
 * 3. 초기 브랜드 공식 사이트 ai_agent 소스 레코드 생성
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INITIAL_BRAND_SOURCES = [
  // 아래 목록을 실제 브랜드 사이트 URL로 교체하세요
  {
    name: "MSR",
    entryUrl: "https://www.msrgear.com/tents",
    newArrivalsUrl: undefined,
  },
  {
    name: "Big Agnes",
    entryUrl: "https://www.bigagnes.com/collections/tents",
    newArrivalsUrl: undefined,
  },
] as const;

async function main() {
  await prisma.$transaction(async (tx) => {
    console.log("1. naver_api 소스 비활성화...");

    // Fix 3: single updateMany for deactivating naver sources
    await tx.crawlSource.updateMany({
      where: { adapterType: "naver_api" },
      data: { isActive: false },
    });

    // Mark their product_sources as discontinued
    const naverSources = await tx.crawlSource.findMany({
      where: { adapterType: "naver_api" },
      select: { id: true, name: true },
    });
    for (const source of naverSources) {
      const updated = await tx.productSource.updateMany({
        where: { sourceId: source.id, status: "active" },
        data: { status: "discontinued" },
      });
      console.log(`  - ${source.name}: product_sources ${updated.count}개 discontinued 처리`);
    }

    console.log("2. 브랜드 공식 사이트 소스 생성...");
    for (const brand of INITIAL_BRAND_SOURCES) {
      // Fix 2: tighten idempotency check to also match adapterType
      const existing = await tx.crawlSource.findFirst({
        where: { name: brand.name, adapterType: "ai_agent" },
      });
      if (existing) {
        console.log(`  - ${brand.name}: 이미 존재함, 건너뜀`);
        continue;
      }
      await tx.crawlSource.create({
        data: {
          name: brand.name,
          adapterType: "ai_agent",
          isActive: true,
          config: {
            entry_url: brand.entryUrl,
            ...(brand.newArrivalsUrl ? { new_arrivals_url: brand.newArrivalsUrl } : {}),
          },
        },
      });
      console.log(`  - ${brand.name}: 생성 완료 (${brand.entryUrl})`);
    }

    console.log("완료.");
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
