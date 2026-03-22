# Gear Crawler Implementation Plan (TypeScript + GitHub Actions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국내외 백패킹 장비 사이트에서 카테고리별 스펙을 수집해 PostgreSQL DB에 저장하는 TypeScript 크롤링 파이프라인을 구축하고, GitHub Actions cron으로 자동 실행한다.

**Architecture:** GitHub Actions가 주 1회 워크플로를 실행 → 소스별 어댑터(Naver API / Playwright / AI Agent)가 제품을 수집 → Spec Normalizer가 정규화 → Prisma를 통해 PostgreSQL에 upsert. 별도 서버/Redis 불필요.

**Tech Stack:** TypeScript, Node.js, Prisma, Supabase (managed PostgreSQL), Playwright, Anthropic SDK, Cheerio, Vitest, GitHub Actions

---

## 파일 구조

```
useless-gear-collector/
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   └── schema.prisma          # DB 스키마 + 마이그레이션
├── .github/
│   └── workflows/
│       ├── crawl-weekly.yml   # 주간 전체 크롤링
│       └── crawl-new.yml      # 일간 신제품 감지
└── src/
    ├── config.ts              # 환경변수
    ├── db.ts                  # Prisma client singleton
    ├── productId.ts           # YYMMDDnn 생성기
    ├── normalizer/
    │   ├── weight.ts          # "1.2 lbs" → "544g"
    │   ├── temperature.ts     # "20°F" → "-7°C"
    │   ├── size.ts            # "Regular" → "레귤러"
    │   └── specs.ts           # 카테고리별 스펙 디스패처 (34개)
    ├── adapters/
    │   ├── types.ts           # RawProduct 타입
    │   ├── naver.ts           # 네이버 쇼핑 API
    │   ├── playwright.ts      # Playwright 기반 크롤러
    │   └── aiAgent.ts         # Claude Haiku AI 추출기
    ├── pipeline/
    │   ├── ingest.ts          # 어댑터 → 정규화 → DB upsert
    │   └── detectNew.ts       # 신규 URL 감지
    ├── alerts/
    │   └── slack.ts           # Slack webhook
    ├── crawl.ts               # 전체 크롤 진입점 (GitHub Actions 실행)
    └── detectNew.ts           # 신제품 감지 진입점
tests/
    ├── productId.test.ts
    ├── normalizer/
    │   ├── weight.test.ts
    │   ├── temperature.test.ts
    │   ├── size.test.ts
    │   └── specs.test.ts
    ├── adapters/
    │   ├── naver.test.ts
    │   └── aiAgent.test.ts
    └── pipeline/
        ├── ingest.test.ts
        └── detectNew.test.ts
```

---

## Task 1: 프로젝트 초기 설정

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/config.ts`

- [ ] **Step 1: `package.json` 생성**

```json
{
  "name": "useless-gear-collector",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "crawl": "node --env-file=.env dist/crawl.js",
    "detect-new": "node --env-file=.env dist/detectNew.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "@prisma/client": "^5.14.0",
    "cheerio": "^1.0.0",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "prisma": "^5.14.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` 생성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: `.env.example` 생성**

```env
# Supabase → Settings → Database → Connection string
# Transaction mode (포트 6543): 앱/GitHub Actions용
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true

# Session mode (포트 5432): Prisma 마이그레이션 전용
DIRECT_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
ANTHROPIC_API_KEY=your_anthropic_api_key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

- [ ] **Step 4: `src/config.ts` 생성**

```typescript
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  naverClientId: process.env.NAVER_CLIENT_ID ?? "",
  naverClientSecret: process.env.NAVER_CLIENT_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
};
```

- [ ] **Step 5: 패키지 설치**

```bash
npm install
npx playwright install chromium
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .env.example src/config.ts
git commit -m "feat: TypeScript project setup"
```

---

## Task 2: Prisma 스키마 + 마이그레이션

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Prisma 초기화**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: `prisma/schema.prisma` 전체 작성**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // PgBouncer (포트 6543) — 앱용
  directUrl = env("DIRECT_URL")     // Direct (포트 5432) — 마이그레이션용
}

model ProductIdSeq {
  dateKey String @id @map("date_key") @db.Char(6)
  lastSeq Int    @default(0) @map("last_seq")

  @@map("product_id_seq")
}

model BrandAlias {
  alias     String @id
  canonical String

  @@map("brand_aliases")
}

model CrawlSource {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name                String   @unique
  adapterType         String   @map("adapter_type")
  baseUrl             String?  @map("base_url")
  crawlFrequencyHours Int      @default(168) @map("crawl_frequency_hours")
  isActive            Boolean  @default(true) @map("is_active")
  config              Json?

  jobs    CrawlJob[]
  sources ProductSource[]

  @@map("crawl_sources")
}

model Product {
  productId     String   @id @map("product_id") @db.Char(8)
  groupId       String   @map("group_id")
  category      String
  brandKr       String   @default("") @map("brand_kr")
  brandEn       String   @default("") @map("brand_en")
  nameKr        String   @default("") @map("name_kr")
  nameEn        String   @default("") @map("name_en")
  colorKr       String   @default("") @map("color_kr")
  colorEn       String   @default("") @map("color_en")
  sizeKr        String   @default("") @map("size_kr")
  sizeEn        String   @default("") @map("size_en")
  weight        String   @default("")
  salesRegion   String   @default("") @map("sales_region")
  naverImageUrl String   @default("") @map("naver_image_url")
  specs         Json     @default("{}")
  needsReview   Boolean  @default(false) @map("needs_review")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  sources ProductSource[]

  @@unique([brandEn, nameEn, colorEn, sizeEn])
  @@index([groupId])
  @@index([category])
  @@index([brandEn])
  @@index([salesRegion])
  @@index([needsReview])
  @@map("products")
}

model CrawlJob {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sourceId     String?   @map("source_id") @db.Uuid
  status       String
  startedAt    DateTime? @map("started_at")
  finishedAt   DateTime? @map("finished_at")
  itemsFound   Int       @default(0) @map("items_found")
  itemsUpdated Int       @default(0) @map("items_updated")
  error        String?
  retryCount   Int       @default(0) @map("retry_count")

  source  CrawlSource?    @relation(fields: [sourceId], references: [id])
  sources ProductSource[]

  @@map("crawl_jobs")
}

model ProductSource {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId     String    @map("product_id") @db.Char(8)
  sourceId      String    @map("source_id") @db.Uuid
  crawlJobId    String?   @map("crawl_job_id") @db.Uuid
  sourceUrl     String    @unique @map("source_url")
  price         Decimal?
  currency      String?   @db.VarChar(3)
  imageUrl      String?   @map("image_url")
  status        String    @default("active")
  lastCrawledAt DateTime? @map("last_crawled_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  product  Product     @relation(fields: [productId], references: [productId])
  source   CrawlSource @relation(fields: [sourceId], references: [id])
  crawlJob CrawlJob?   @relation(fields: [crawlJobId], references: [id])
  prices   PriceHistory[]

  @@index([sourceId])
  @@index([status])
  @@index([lastCrawledAt])
  @@map("product_sources")
}

model PriceHistory {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productSourceId String   @map("product_source_id") @db.Uuid
  price           Decimal?
  currency        String?  @db.VarChar(3)
  recordedAt      DateTime @default(now()) @map("recorded_at")

  productSource ProductSource @relation(fields: [productSourceId], references: [id])

  @@index([productSourceId, recordedAt(sort: Desc)])
  @@map("price_history")
}
```

- [ ] **Step 3: 마이그레이션 생성 및 적용**

> Supabase 프로젝트 생성 후 `.env`에 `DATABASE_URL`과 `DIRECT_URL`을 입력한 뒤 실행한다.

```bash
npx prisma migrate dev --name initial_schema
```

Expected: `prisma/migrations/` 하위에 SQL 파일 생성, Supabase DB에 테이블 생성

- [ ] **Step 4: Prisma client 생성**

```bash
npx prisma generate
```

- [ ] **Step 5: `src/db.ts` 생성**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/db.ts
git commit -m "feat: Prisma schema and initial migration"
```

---

## Task 3: Product ID 생성기

**Files:**
- Create: `src/productId.ts`
- Create: `tests/productId.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/productId.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { generateProductId } from "../src/productId";
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
    expect(id.length).toBe(9);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- productId
```

Expected: FAIL (module not found)

- [ ] **Step 3: `src/productId.ts` 작성**

```typescript
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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- productId
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/productId.ts tests/productId.test.ts
git commit -m "feat: YYMMDDnn product_id generator"
```

---

## Task 4: Normalizer — 무게

**Files:**
- Create: `src/normalizer/weight.ts`
- Create: `tests/normalizer/weight.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/weight.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeWeight } from "../../src/normalizer/weight";

describe("normalizeWeight", () => {
  it.each([
    ["850g", "850g"],
    ["0.85kg", "850g"],
    ["0.85 kg", "850g"],
    ["1.2 lbs", "544g"],
    ["1.2lbs", "544g"],
    ["1.2 lb", "544g"],
    ["544 grams", "544g"],
    ["", ""],
    ["unknown", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeWeight(raw)).toBe(expected);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- weight
```

- [ ] **Step 3: `src/normalizer/weight.ts` 작성**

```typescript
const PATTERN = /([\d.]+)\s*(g|gram|grams|kg|kilogram|lbs?|pound|oz|ounce)/i;
const LBS_TO_G = 453.592;
const OZ_TO_G = 28.3495;
const KG_TO_G = 1000;

export function normalizeWeight(raw: string): string {
  if (!raw) return "";
  const m = raw.match(PATTERN);
  if (!m) return "";
  const value = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  let grams: number;
  if (unit.startsWith("kg") || unit.startsWith("kilo")) {
    grams = value * KG_TO_G;
  } else if (unit.startsWith("lb") || unit.startsWith("pound")) {
    grams = value * LBS_TO_G;
  } else if (unit.startsWith("oz") || unit.startsWith("ounce")) {
    grams = value * OZ_TO_G;
  } else {
    grams = value;
  }
  return `${Math.round(grams)}g`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- weight
```

- [ ] **Step 5: Commit**

```bash
git add src/normalizer/weight.ts tests/normalizer/weight.test.ts
git commit -m "feat: weight normalizer"
```

---

## Task 5: Normalizer — 온도

**Files:**
- Create: `src/normalizer/temperature.ts`
- Create: `tests/normalizer/temperature.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/temperature.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeTemperature } from "../../src/normalizer/temperature";

describe("normalizeTemperature", () => {
  it.each([
    ["-7°C", "-7°C"],
    ["-7 °C", "-7°C"],
    ["20°F", "-7°C"],
    ["32°F", "0°C"],
    ["-40°F", "-40°C"],
    ["0°C", "0°C"],
    ["", ""],
    ["n/a", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeTemperature(raw)).toBe(expected);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- temperature
```

- [ ] **Step 3: `src/normalizer/temperature.ts` 작성**

```typescript
const PATTERN = /(-?[\d.]+)\s*°?\s*(C|F)/i;

export function normalizeTemperature(raw: string): string {
  if (!raw) return "";
  const m = raw.match(PATTERN);
  if (!m) return "";
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const celsius = unit === "F" ? (value - 32) * 5 / 9 : value;
  return `${Math.round(celsius)}°C`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- temperature
```

- [ ] **Step 5: Commit**

```bash
git add src/normalizer/temperature.ts tests/normalizer/temperature.test.ts
git commit -m "feat: temperature normalizer"
```

---

## Task 6: Normalizer — 사이즈 한글 통일

**Files:**
- Create: `src/normalizer/size.ts`
- Create: `tests/normalizer/size.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/size.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeSizeKr } from "../../src/normalizer/size";

describe("normalizeSizeKr", () => {
  it.each([
    ["Regular", "레귤러"],
    ["regular", "레귤러"],
    ["R", "레귤러"],
    ["Long", "롱"],
    ["L", "롱"],
    ["Long Wide", "롱와이드"],
    ["LW", "롱와이드"],
    ["Large", "라지"],
    ["Short", "숏"],
    ["S", "숏"],
    ["Small", "스몰"],
    ["Medium", "미디엄"],
    ["M", "미디엄"],
    ["레귤러", "레귤러"],
    ["", ""],
    ["XL", ""],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeSizeKr(raw)).toBe(expected);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- size
```

- [ ] **Step 3: `src/normalizer/size.ts` 작성**

```typescript
const SIZE_MAP: Record<string, string> = {
  regular: "레귤러", r: "레귤러",
  "long wide": "롱와이드", lw: "롱와이드",
  long: "롱", l: "롱",
  large: "라지",
  short: "숏", s: "숏",
  small: "스몰",
  medium: "미디엄", m: "미디엄",
  레귤러: "레귤러", 롱: "롱", 롱와이드: "롱와이드",
  라지: "라지", 숏: "숏", 스몰: "스몰", 미디엄: "미디엄",
};

export function normalizeSizeKr(raw: string): string {
  return SIZE_MAP[raw.trim().toLowerCase()] ?? "";
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- size
```

- [ ] **Step 5: Commit**

```bash
git add src/normalizer/size.ts tests/normalizer/size.test.ts
git commit -m "feat: size Korean standardization normalizer"
```

---

## Task 7: Normalizer — 카테고리 스펙 디스패처 (34개)

**Files:**
- Create: `src/normalizer/specs.ts`
- Create: `tests/normalizer/specs.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/specs.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeSpecs, CATEGORY_SPEC_KEYS } from "../../src/normalizer/specs";

describe("CATEGORY_SPEC_KEYS", () => {
  it("covers exactly 34 categories", () => {
    expect(Object.keys(CATEGORY_SPEC_KEYS).length).toBe(34);
  });
});

describe("normalizeSpecs", () => {
  it("drops unknown keys", () => {
    const result = normalizeSpecs("텐트", { 수용_인원: "2", unknown_key: "drop" });
    expect("unknown_key" in result).toBe(false);
    expect(result["수용_인원"]).toBe("2");
  });

  it("fills missing keys with empty string", () => {
    const result = normalizeSpecs("침낭", {});
    for (const key of CATEGORY_SPEC_KEYS["침낭"]!) {
      expect(result[key]).toBe("");
    }
  });

  it("returns empty object for unknown category", () => {
    expect(normalizeSpecs("없는카테고리", {})).toEqual({});
  });

  it("normalizes weight in sleeping bag fill weight", () => {
    const result = normalizeSpecs("침낭", { 충전량: "1.2 lbs" });
    expect(result["충전량"]).toBe("544g");
  });

  it("normalizes temperature in sleeping bag", () => {
    const result = normalizeSpecs("침낭", { 온도_comfort: "20°F" });
    expect(result["온도_comfort"]).toBe("-7°C");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- specs
```

- [ ] **Step 3: `src/normalizer/specs.ts` 작성**

```typescript
import { normalizeWeight } from "./weight";
import { normalizeTemperature } from "./temperature";

export const CATEGORY_SPEC_KEYS: Record<string, string[]> = {
  텐트:    ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
  타프:    ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
  쉘터:    ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
  침낭:    ["형태", "충전재", "충전량", "필파워", "온도_comfort", "온도_lower_limit", "지퍼_방향"],
  매트:    ["타입", "형태", "소재", "r_value", "두께", "펼친_크기"],
  배낭:    ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
  "베스트 배낭": ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
  디팩:    ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
  버너:    ["소재", "연료_타입", "화력", "점화_방식", "윈드스크린_내장"],
  토치:    ["소재", "연료_타입", "화력", "점화_방식", "윈드스크린_내장"],
  컵:      ["소재", "용량", "세트_구성"],
  그릇:    ["소재", "용량", "세트_구성"],
  "식기류 기타": ["소재", "용량", "세트_구성"],
  수저:    ["소재", "세트_구성"],
  물통:    ["소재", "용량", "보온보냉", "입구_타입"],
  의류:    ["종류", "소재", "방수", "충전재", "후드"],
  선글라스: ["렌즈_소재", "uv_차단_등급", "편광"],
  장갑:    ["타입", "소재", "방수"],
  스패츠:  ["높이", "소재", "방수"],
  체어:    ["소재", "프레임_소재", "최대_하중", "팩_사이즈"],
  테이블:  ["상판_소재", "프레임_소재", "최대_하중", "팩_사이즈", "높이_조절"],
  조명:    ["타입", "최대_밝기", "배터리_타입", "방수_등급", "최대_사용시간", "적색광_모드"],
  트래킹폴: ["소재", "접이_방식", "잠금_방식", "최소_길이", "최대_길이"],
  "파우치나 수납용 가방": ["소재", "방수", "용량"],
  "배낭 커버": ["소재", "방수", "용량"],
  // 간단 스펙 (소재 + 사이즈) — 9개
  텐트ACC: ["소재", "사이즈"],
  핫팩:    ["소재", "사이즈"],
  삽:      ["소재", "사이즈"],
  망치:    ["소재", "사이즈"],
  수건:    ["소재", "사이즈"],
  식품:    ["소재", "사이즈"],
  아이젠:  ["소재", "사이즈"],
  필로우:  ["소재", "사이즈"],
  "그 외 기타": ["소재", "사이즈"],
};

const WEIGHT_FIELDS = new Set(["충전량"]);
const TEMP_FIELDS = new Set(["온도_comfort", "온도_lower_limit"]);

export function normalizeSpecs(category: string, raw: Record<string, string>): Record<string, string> {
  const keys = CATEGORY_SPEC_KEYS[category];
  if (!keys) return {};

  const result: Record<string, string> = {};
  for (const key of keys) {
    let value = raw[key] ?? "";
    if (WEIGHT_FIELDS.has(key)) value = normalizeWeight(value);
    else if (TEMP_FIELDS.has(key)) value = normalizeTemperature(value);
    result[key] = value;
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- specs
```

Expected: PASS 6

- [ ] **Step 5: 전체 normalizer 테스트**

```bash
npm test -- normalizer
```

- [ ] **Step 6: Commit**

```bash
git add src/normalizer/ tests/normalizer/
git commit -m "feat: spec normalizer for all 34 categories"
```

---

## Task 8: Adapter 타입 + Naver API 어댑터

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/naver.ts`
- Create: `tests/adapters/naver.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/naver.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { NaverAdapter } from "../../src/adapters/naver";

const MOCK_RESPONSE = {
  items: [{
    title: "<b>MSR</b> Hubba Hubba 2",
    link: "https://shopping.naver.com/hubba",
    image: "https://image.naver.com/hubba.jpg",
    lprice: "450000",
    brand: "MSR",
    category3: "텐트",
  }],
};

describe("NaverAdapter", () => {
  it("parses items and strips HTML from title", async () => {
    const adapter = new NaverAdapter("test-id", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));

    const products = await adapter.fetchProducts({ query: "텐트" });

    expect(products).toHaveLength(1);
    expect(products[0].brandEn).toBe("MSR");
    expect(products[0].price).toBe(450000);
    expect(products[0].currency).toBe("KRW");
    expect(products[0].nameEn).not.toContain("<b>");
  });

  it("sets salesRegion to 국내", async () => {
    const adapter = new NaverAdapter("id", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_RESPONSE,
    }));
    const products = await adapter.fetchProducts({ query: "텐트" });
    expect(products[0].salesRegion).toBe("국내");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- naver
```

- [ ] **Step 3: `src/adapters/types.ts` 작성**

```typescript
export interface RawProduct {
  sourceUrl: string;
  brandEn: string;
  nameEn: string;
  category: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  brandKr?: string;
  nameKr?: string;
  colorEn?: string;
  colorKr?: string;
  sizeEn?: string;
  weightRaw?: string;
  salesRegion?: string;
  specsRaw?: Record<string, string>;
  needsReviewFlag?: boolean;
}
```

- [ ] **Step 4: `src/adapters/naver.ts` 작성**

```typescript
import type { RawProduct } from "./types";

const API_URL = "https://openapi.naver.com/v1/search/shop.json";

export class NaverAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  async fetchProducts(config: { query?: string; display?: number }): Promise<RawProduct[]> {
    const params = new URLSearchParams({
      query: config.query ?? "백패킹",
      display: String(config.display ?? 100),
    });
    const res = await fetch(`${API_URL}?${params}`, {
      headers: {
        "X-Naver-Client-Id": this.clientId,
        "X-Naver-Client-Secret": this.clientSecret,
      },
    });
    if (!res.ok) throw new Error(`Naver API error: ${res.status}`);
    const data = await res.json() as { items: Record<string, string>[] };
    return data.items.map((item) => this.parse(item));
  }

  async fetchNewProducts(config: { query?: string }): Promise<RawProduct[]> {
    return this.fetchProducts({ ...config, query: config.query ?? "신상" });
  }

  private parse(item: Record<string, string>): RawProduct {
    return {
      sourceUrl: item["link"] ?? "",
      brandEn: item["brand"] ?? "",
      nameEn: (item["title"] ?? "").replace(/<[^>]+>/g, ""),
      category: item["category3"] ?? item["category2"] ?? "",
      price: item["lprice"] ? parseFloat(item["lprice"]) : undefined,
      currency: "KRW",
      imageUrl: item["image"] ?? "",
      salesRegion: "국내",
    };
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npm test -- naver
```

- [ ] **Step 6: Commit**

```bash
git add src/adapters/ tests/adapters/naver.test.ts
git commit -m "feat: RawProduct type and Naver Shopping API adapter"
```

---

## Task 9: AI Agent 추출기 (Claude Haiku)

**Files:**
- Create: `src/adapters/aiAgent.ts`
- Create: `tests/adapters/aiAgent.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/aiAgent.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { stripHtmlNoise, AIAgentAdapter } from "../../src/adapters/aiAgent";

describe("stripHtmlNoise", () => {
  it("removes script tags", () => {
    const html = "<html><script>alert(1)</script><div>Weight: 850g</div></html>";
    const result = stripHtmlNoise(html);
    expect(result).not.toContain("alert");
    expect(result).toContain("850g");
  });

  it("truncates to 5KB", () => {
    const html = "<html>" + "x".repeat(100_000) + "</html>";
    const result = stripHtmlNoise(html);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(5_000);
  });
});

describe("AIAgentAdapter", () => {
  it("parses valid JSON response", async () => {
    const adapter = new AIAgentAdapter("test-key");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: '{"brand_en":"MSR","name_en":"Hubba","category":"텐트","specs_raw":{"수용_인원":"2"}}' }],
    });
    vi.spyOn(adapter["client"].messages, "create").mockImplementation(mockCreate);

    const products = await adapter.extractFromHtml("<html/>", "https://msr.com");
    expect(products[0].brandEn).toBe("MSR");
    expect(products[0].specsRaw?.["수용_인원"]).toBe("2");
  });

  it("returns needsReviewFlag=true on invalid JSON", async () => {
    const adapter = new AIAgentAdapter("test-key");
    vi.spyOn(adapter["client"].messages, "create").mockResolvedValue({
      content: [{ text: "not json" }],
    });

    const products = await adapter.extractFromHtml("<html/>", "https://x.com/product");
    expect(products[0].needsReviewFlag).toBe(true);
    expect(products[0].specsRaw).toEqual({});
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npm test -- aiAgent
```

- [ ] **Step 3: `src/adapters/aiAgent.ts` 작성**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import type { RawProduct } from "./types";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_HTML_BYTES = 5_000;
const SYSTEM_PROMPT = `당신은 백패킹 장비 제품 페이지에서 정보를 추출하는 전문가입니다.
주어진 HTML에서 제품 정보를 아래 JSON 형식으로 추출하세요:
{"brand_en":"","brand_kr":"","name_en":"","name_kr":"","category":"",
"color_en":"","color_kr":"","size_en":"","weight_raw":"","specs_raw":{}}
JSON 외 다른 텍스트는 출력하지 마세요.`;

export function stripHtmlNoise(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, noscript").remove();
  const cleaned = $.html();
  return Buffer.from(cleaned, "utf8").slice(0, MAX_HTML_BYTES).toString("utf8");
}

export class AIAgentAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractFromHtml(html: string, sourceUrl: string): Promise<RawProduct[]> {
    const cleaned = stripHtmlNoise(html);
    try {
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: cleaned }],
      });
      const text = (message.content[0] as { text: string }).text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return [{
        sourceUrl,
        brandEn: String(data["brand_en"] ?? ""),
        brandKr: String(data["brand_kr"] ?? ""),
        nameEn: String(data["name_en"] ?? ""),
        nameKr: String(data["name_kr"] ?? ""),
        category: String(data["category"] ?? ""),
        colorEn: String(data["color_en"] ?? ""),
        colorKr: String(data["color_kr"] ?? ""),
        sizeEn: String(data["size_en"] ?? ""),
        weightRaw: String(data["weight_raw"] ?? ""),
        specsRaw: (data["specs_raw"] as Record<string, string>) ?? {},
      }];
    } catch {
      return [{ sourceUrl, brandEn: "", nameEn: "", category: "", specsRaw: {}, needsReviewFlag: true }];
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- aiAgent
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/aiAgent.ts tests/adapters/aiAgent.test.ts
git commit -m "feat: Claude Haiku AI agent extractor"
```

---

## Task 10: Playwright 어댑터

**Files:**
- Create: `src/adapters/playwright.ts`

- [ ] **Step 1: `src/adapters/playwright.ts` 작성**

> robots.txt 준수 + 2~5초 랜덤 딜레이 + 최대 3회 재시도.

```typescript
import { chromium } from "playwright";
import { parseRobotsTxt } from "../utils/robots";
import type { RawProduct } from "./types";

const USER_AGENT = "GearCollectorBot/1.0";
const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5_000;
const MAX_RETRIES = 3;

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchPageHtml(
  url: string,
  retries = 0
): Promise<string | null> {
  const allowed = await isAllowedByRobots(url);
  if (!allowed) return null;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await randomDelay();
    return await page.content();
  } catch (err) {
    if (retries < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 2 ** (retries + 1) * 1_000));
      return fetchPageHtml(url, retries + 1);
    }
    return null;
  } finally {
    await browser.close();
  }
}

async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const { origin, pathname } = new URL(url);
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl);
    if (!res.ok) return true;
    const text = await res.text();
    return parseRobotsTxt(text, USER_AGENT, pathname);
  } catch {
    return true;
  }
}
```

- [ ] **Step 2: `src/utils/robots.ts` 작성**

```typescript
/** robots.txt 텍스트를 파싱해 해당 경로의 크롤링 허용 여부를 반환한다. */
export function parseRobotsTxt(
  robotsTxt: string,
  userAgent: string,
  path: string
): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  let applicable = false;
  for (const line of lines) {
    if (line.toLowerCase().startsWith("user-agent:")) {
      const agent = line.split(":")[1]?.trim() ?? "";
      applicable = agent === "*" || agent.toLowerCase() === userAgent.toLowerCase();
    }
    if (!applicable) continue;
    if (line.toLowerCase().startsWith("disallow:")) {
      const disallowed = line.split(":")[1]?.trim() ?? "";
      if (disallowed && path.startsWith(disallowed)) return false;
    }
  }
  return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/adapters/playwright.ts src/utils/robots.ts
git commit -m "feat: Playwright adapter with robots.txt check and rate limiting"
```

---

## Task 11: Ingest 파이프라인

**Files:**
- Create: `src/pipeline/ingest.ts`
- Create: `tests/pipeline/ingest.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/ingest.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ingestProduct } from "../../src/pipeline/ingest";
import type { RawProduct } from "../../src/adapters/types";

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
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- ingest
```

- [ ] **Step 3: `src/pipeline/ingest.ts` 작성**

```typescript
import type { PrismaClient } from "@prisma/client";
import type { RawProduct } from "../adapters/types";
import { generateProductId } from "../productId";
import { normalizeWeight } from "../normalizer/weight";
import { normalizeSizeKr } from "../normalizer/size";
import { normalizeSpecs } from "../normalizer/specs";

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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- ingest
```

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/ingest.ts tests/pipeline/ingest.test.ts
git commit -m "feat: ingest pipeline"
```

---

## Task 12: 신제품 감지 + Slack 알림

**Files:**
- Create: `src/pipeline/detectNew.ts`
- Create: `src/alerts/slack.ts`
- Create: `tests/pipeline/detectNew.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/detectNew.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { filterNewUrls } from "../../src/pipeline/detectNew";

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

beforeEach(async () => {
  await prisma.productSource.deleteMany();
  await prisma.product.deleteMany();
  await prisma.crawlSource.deleteMany();
  // 기존 URL 삽입
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
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- detectNew
```

- [ ] **Step 3: `src/pipeline/detectNew.ts` 작성**

```typescript
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
```

- [ ] **Step 4: `src/alerts/slack.ts` 작성**

```typescript
import { config } from "../config";

export async function sendSlackAlert(message: string): Promise<void> {
  if (!config.slackWebhookUrl) return;
  await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test -- detectNew
```

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/detectNew.ts src/alerts/slack.ts tests/pipeline/detectNew.test.ts
git commit -m "feat: new URL detection and Slack alert"
```

---

## Task 13: 크롤 진입점 스크립트

**Files:**
- Create: `src/crawl.ts`
- Create: `src/detectNew.ts`

- [ ] **Step 1: `src/crawl.ts` 작성**

```typescript
import { prisma } from "./db";
import { NaverAdapter } from "./adapters/naver";
import { AIAgentAdapter } from "./adapters/aiAgent";
import { fetchPageHtml } from "./adapters/playwright";
import { ingestProduct } from "./pipeline/ingest";
import { sendSlackAlert } from "./alerts/slack";
import { config } from "./config";

async function runCrawl(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    const job = await prisma.crawlJob.create({
      data: { sourceId: source.id, status: "running", startedAt: new Date() },
    });

    let itemsFound = 0;
    try {
      let products = [];
      if (source.adapterType === "naver_api") {
        const adapter = new NaverAdapter(config.naverClientId, config.naverClientSecret);
        products = await adapter.fetchProducts((source.config as Record<string, string>) ?? {});
      } else if (source.adapterType === "playwright") {
        const cfg = (source.config as Record<string, string>) ?? {};
        const html = await fetchPageHtml(cfg["entry_url"] ?? "");
        // 구체적 파싱은 소스별 서브클래스에서 구현; 기본은 빈 배열
        products = html ? [] : [];
      } else if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, string>) ?? {};
        const html = await fetchPageHtml(cfg["entry_url"] ?? "");
        if (html) products = await adapter.extractFromHtml(html, cfg["entry_url"] ?? "");
      }

      for (const raw of products) {
        await ingestProduct(prisma, raw, source.id, job.id);
        itemsFound++;
      }

      await prisma.crawlJob.update({
        where: { id: job.id },
        data: { status: "done", finishedAt: new Date(), itemsFound, itemsUpdated: itemsFound },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.crawlJob.update({
        where: { id: job.id },
        data: { status: "failed", finishedAt: new Date(), error: message },
      });
      await sendSlackAlert(`:red_circle: Crawl FAILED: ${source.name}\n\`\`\`${message}\`\`\``);
    }
  }

  await prisma.$disconnect();
}

runCrawl().catch(async (err) => {
  console.error(err);
  await sendSlackAlert(`:red_circle: Crawl script crashed: ${err}`);
  process.exit(1);
});
```

- [ ] **Step 2: `src/detectNew.ts` 작성**

```typescript
import { prisma } from "./db";
import { NaverAdapter } from "./adapters/naver";
import { AIAgentAdapter } from "./adapters/aiAgent";
import { fetchPageHtml } from "./adapters/playwright";
import { filterNewUrls } from "./pipeline/detectNew";
import { ingestProduct } from "./pipeline/ingest";
import { sendSlackAlert } from "./alerts/slack";
import { config } from "./config";

async function runDetectNew(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    try {
      let products = [];
      if (source.adapterType === "naver_api") {
        const adapter = new NaverAdapter(config.naverClientId, config.naverClientSecret);
        products = await adapter.fetchNewProducts((source.config as Record<string, string>) ?? {});
      } else if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, string>) ?? {};
        const url = cfg["new_arrivals_url"] ?? cfg["entry_url"] ?? "";
        const html = await fetchPageHtml(url);
        if (html) products = await adapter.extractFromHtml(html, url);
      }

      const candidateUrls = new Set(products.map((p) => p.sourceUrl).filter(Boolean));
      const newUrls = await filterNewUrls(prisma, candidateUrls);
      const newProducts = products.filter((p) => newUrls.has(p.sourceUrl));

      for (const raw of newProducts) {
        await ingestProduct(prisma, raw, source.id, "detect_new");
      }
    } catch (err) {
      await sendSlackAlert(`:warning: New product detect FAILED: ${source.name}\n\`\`\`${err}\`\`\``);
    }
  }

  await prisma.$disconnect();
}

runDetectNew().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
git add src/crawl.ts src/detectNew.ts
git commit -m "feat: crawl and detect-new entrypoint scripts"
```

---

## Task 14: GitHub Actions 워크플로

**Files:**
- Create: `.github/workflows/crawl-weekly.yml`
- Create: `.github/workflows/crawl-new.yml`

- [ ] **Step 1: `.github/workflows/crawl-weekly.yml` 작성**

```yaml
name: Weekly Gear Crawl

on:
  schedule:
    - cron: "0 2 * * 1"   # 매주 월요일 02:00 UTC
  workflow_dispatch:        # 수동 실행 허용

jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build

      - name: Run crawler
        run: npm run crawl
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
          NAVER_CLIENT_ID: ${{ secrets.NAVER_CLIENT_ID }}
          NAVER_CLIENT_SECRET: ${{ secrets.NAVER_CLIENT_SECRET }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

- [ ] **Step 2: `.github/workflows/crawl-new.yml` 작성**

```yaml
name: Daily New Product Detection

on:
  schedule:
    - cron: "0 3 * * *"   # 매일 03:00 UTC
  workflow_dispatch:

jobs:
  detect-new:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build

      - name: Run new product detection
        run: npm run detect-new
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
          NAVER_CLIENT_ID: ${{ secrets.NAVER_CLIENT_ID }}
          NAVER_CLIENT_SECRET: ${{ secrets.NAVER_CLIENT_SECRET }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

- [ ] **Step 3: GitHub Secrets 등록 안내**

GitHub 레포 → Settings → Secrets and variables → Actions에서 아래 시크릿 등록:
```
DATABASE_URL        (Supabase Transaction mode, 포트 6543)
DIRECT_URL          (Supabase Session mode, 포트 5432 — 마이그레이션 시 필요)
NAVER_CLIENT_ID
NAVER_CLIENT_SECRET
ANTHROPIC_API_KEY
SLACK_WEBHOOK_URL
```

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "feat: GitHub Actions weekly crawl and daily new product detection"
```

---

## Task 15: 전체 테스트 실행 + 빌드 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
TEST_DATABASE_URL=$DATABASE_URL npm test
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npm run build
```

Expected: `dist/` 폴더 생성, 에러 없음

- [ ] **Step 3: 로컬 수동 실행 테스트**

```bash
cp .env.example .env
# .env에 실제 값 입력 후
npm run crawl
```

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete TypeScript gear crawler with GitHub Actions"
```
