# Brand Site Crawler — Design Spec

**Date:** 2026-03-23
**Project:** useless.my — 백패킹 장비 관리 서비스
**Scope:** Naver Shopping API 제거 및 브랜드 공식 사이트 크롤링으로 전환

---

## 목표

현재 `naver_api` 어댑터를 통해 수집하던 제품 데이터를 브랜드 공식 사이트 직접 크롤링으로 교체한다. Playwright + Claude Haiku(`ai_agent` 어댑터)를 사용해 제품 목록 페이지를 순회하며 제품 정보를 추출하고, 페이지네이션은 AI가 자동으로 다음 페이지 링크를 추출해 처리한다.

---

## 변경 범위

### 제거
- `src/adapters/naver.ts` — NaverAdapter 전체 삭제
- `src/crawl.ts` — `naver_api` 분기 및 NaverAdapter import, `products` 타입 어노테이션(`NaverAdapter["fetchProducts"]` → `RawProduct[]`)
- `src/detectNew.ts` — `naver_api` 분기 및 NaverAdapter import, `products` 타입 어노테이션 동일하게 변경
- `src/config.ts` — `naverClientId`, `naverClientSecret` 필드 제거
- GitHub Actions 시크릿 / Vercel 환경변수: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 제거
- `admin/app/(dashboard)/actions.ts` — `getQueriesAction`, `saveQueriesAction` 제거
- `admin/app/(dashboard)/query-editor.tsx` — 파일 삭제

### 변경
- `src/adapters/aiAgent.ts` — 제품 목록 페이지 순회 메서드 추가
- `src/crawl.ts` — `ai_agent` 분기에서 새 `fetchProductsFromSite` 메서드 호출
- `src/detectNew.ts` — `ai_agent` 분기에서 `fetchProductsFromSite` 호출 (기존 단일 페이지 `extractFromHtml` 대체)
- `admin/app/(dashboard)/actions.ts` — 브랜드 소스 관리 액션 추가
- `admin/app/(dashboard)/page.tsx` — `naver_api` 하드코딩 제거, `ai_agent` 소스 목록 조회로 변경, `QueryEditor` → `BrandSitesEditor` 교체
- `admin/app/(dashboard)/query-editor.tsx` → `brand-sites-editor.tsx`로 교체

### 유지
- `src/pipeline/ingest.ts`, `src/normalizer/*` — 변경 없음
- `src/adapters/playwright.ts` — 변경 없음 (`fetchPageHtml`은 `AIAgentAdapter` 내부에서 계속 사용)
- `src/pipeline/detectNew.ts` (`filterNewUrls`) — 변경 없음
- `crawl_sources` DB 스키마 — 변경 없음
- GitHub Actions 워크플로우 파일 — 변경 없음

**추가 제거 (ai_agent 분기 내부 코드 + dead import):**
- `src/crawl.ts` — `ai_agent` 분기 내부의 `fetchPageHtml(url)` 호출과 `extractFromHtml` 호출을 `fetchProductsFromSite` 호출로 교체 (아래 crawl.ts 변경 섹션 참조). 이후 `import { fetchPageHtml }` import 라인 제거.
- `src/detectNew.ts` — `ai_agent` 분기 내부의 `fetchPageHtml(url)` 호출과 `extractFromHtml` 호출을 `fetchProductsFromSite` 호출로 교체 (아래 detectNew.ts 변경 섹션 참조). 이후 `import { fetchPageHtml }` import 라인 제거.
- `src/crawl.ts` — `playwright` 분기(`products = html ? [] : []`)는 현재 dead code이므로 이번 작업에서는 그대로 유지 (별도 작업으로 정리)

**기술 부채 (이번 범위 외):**
- `products.naver_image_url` 컬럼명이 Naver 제거 후에도 잔존함. 브랜드 사이트 크롤 시 KRW 제품의 이미지도 이 컬럼에 저장됨 (`ingest.ts` 동작 유지). 컬럼 리네임은 향후 별도 마이그레이션으로 처리.

---

## AIAgentAdapter 확장

### 기존 메서드 (유지)
```ts
extractFromHtml(html: string, url: string): Promise<RawProduct[]>
```
단일 제품 상세 페이지에서 스펙 추출. 동작 변경 없음.

### 새 메서드 추가
```ts
fetchProductsFromSite(entryUrl: string, maxPages?: number): Promise<RawProduct[]>
```

**동작 흐름:**
1. `visitedUrls = new Set<string>()` 로 방문 URL 추적 (순환 링크 방지)
2. `fetchPageHtml(currentUrl)` → HTML 취득
3. Haiku에 요청: 제품 목록 추출 + 다음 페이지 URL 추출
   - 응답 형식: `{ products: RawProduct[], nextPageUrl: string | null }`
4. `visitedUrls`에 현재 URL 추가
5. `nextPageUrl`이 있고, `visitedUrls`에 없고, 현재 페이지 수 < `maxPages`이면 재귀 호출
6. 전체 수집된 `products` 반환

**기본값:** `maxPages = 20`

**Haiku 프롬프트 (목록 페이지용):**
- 각 제품의 이름, 브랜드, 가격, 이미지 URL, 제품 상세 페이지 URL 추출
- 현재 페이지의 "다음 페이지" 링크 추출 (없으면 null)
- HTML 전처리: `<script>`, `<style>`, nav/footer 제거 후 전송 (~5KB 목표)

**목록 페이지 수집 데이터 범위:**
목록 페이지에서는 상세 스펙(무게, 소재, 색상, 사이즈 등)을 구할 수 없다. 수집 가능한 필드는 다음으로 제한:
- `sourceUrl`, `brandEn`, `nameEn`, `price`, `currency`, `imageUrl`
- `weightRaw`, `specsRaw`, `colorEn`, `sizeEn` 등은 빈 문자열로 저장

`ingestProduct`는 기존과 동일하게 upsert로 동작한다. `ingest.ts`의 update 분기는 `weight`, `specs` 등을 조건부 spread로 처리하므로 (`...(weight && { weight })`), 목록 페이지에서 빈 값이 넘어오면 해당 필드는 기존 DB 값을 유지한다. 의도적인 보호 로직이 아니라 빈 값이 falsy 조건을 만족하지 못해 발생하는 동작이다 (향후 상세 페이지 크롤 기능 추가 시 확장 가능).

---

## crawl_source 설정 구조

`adapterType: "ai_agent"` 소스의 `config` JSONB:

```json
{
  "entry_url": "https://www.blackdiamondequipment.com/collections/all",
  "max_pages": 20,
  "new_arrivals_url": "https://www.blackdiamondequipment.com/collections/new"
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `entry_url` | ✅ | 제품 목록 시작 페이지 URL |
| `max_pages` | ❌ | 최대 순회 페이지 수 (기본 20) |
| `new_arrivals_url` | ❌ | 신제품 목록 페이지 URL (없으면 entry_url 사용) |

---

## crawl.ts 변경

```ts
// 변경 전 (제거):
// - import { NaverAdapter }
// - let products: Awaited<ReturnType<NaverAdapter["fetchProducts"]>> = [];
// - naver_api 분기 전체

// 변경 후:
let products: RawProduct[] = [];

// ai_agent 분기:
} else if (source.adapterType === "ai_agent") {
  const adapter = new AIAgentAdapter(config.anthropicApiKey);
  const cfg = (source.config as Record<string, unknown>) ?? {};
  const entryUrl = (cfg["entry_url"] as string) ?? "";
  const maxPages = (cfg["max_pages"] as number) ?? 20;
  if (entryUrl) {
    products = await adapter.fetchProductsFromSite(entryUrl, maxPages);
  }
}
```

---

## detectNew.ts 변경

```ts
// 변경 전 (제거):
// - import { NaverAdapter }
// - let products: Awaited<ReturnType<NaverAdapter["fetchProducts"]>> = [];
// - naver_api 분기 전체
// - ai_agent 분기의 extractFromHtml 단일 페이지 호출

// 변경 후:
let products: RawProduct[] = [];

// ai_agent 분기:
} else if (source.adapterType === "ai_agent") {
  const adapter = new AIAgentAdapter(config.anthropicApiKey);
  const cfg = (source.config as Record<string, unknown>) ?? {};
  const url = (cfg["new_arrivals_url"] as string) ?? (cfg["entry_url"] as string) ?? "";
  if (url) {
    products = await adapter.fetchProductsFromSite(url, 3); // 신제품은 최대 3페이지
  }
}
```

---

## 어드민 대시보드 변경

### page.tsx 변경

```ts
// 변경 전: naver_api 하드코딩 쿼리
// 변경 후: ai_agent 소스 목록 조회
const [jobs, brandSources] = await Promise.all([
  prisma.crawlJob.findMany({ ... }),
  prisma.crawlSource.findMany({ where: { adapterType: "ai_agent", isActive: true } }),
]);
// BrandSitesEditor에 brandSources 전달
```

### actions.ts 추가 액션

```ts
// 브랜드 소스 목록 조회 (클라이언트 컴포넌트에서 새로고침 시 사용)
// page.tsx 서버 컴포넌트는 Prisma를 직접 호출하며 이 액션을 사용하지 않음
getBrandSourcesAction(): Promise<CrawlSource[]>

// 브랜드 소스 생성 또는 업데이트
// id가 있으면 update, 없으면 create
saveBrandSourceAction(params: {
  id?: string;           // 업데이트 시 기존 소스 ID
  name: string;          // crawl_sources.name (유니크)
  entryUrl: string;
  newArrivalsUrl?: string;
  maxPages?: number;
}): Promise<{ ok: boolean; error?: string }>

// 브랜드 소스 삭제 (is_active = false)
deleteBrandSourceAction(id: string): Promise<{ ok: boolean; error?: string }>
```

### brand-sites-editor.tsx (query-editor.tsx 교체)

Props:
```ts
interface BrandSitesEditorProps {
  initialSources: Array<{
    id: string;
    name: string;
    isActive: boolean;
    config: { entry_url: string; new_arrivals_url?: string; max_pages?: number } | null;
  }>;
}
```

UI 구성:
- 등록된 브랜드 소스 목록 (이름, entry_url, 활성화 여부)
- 소스 추가 폼: 브랜드명, entry_url, new_arrivals_url (선택)
- 소스별 삭제 버튼 + 활성화 토글

---

## DB 전환 — 마이그레이션 스크립트

**파일:** `scripts/migrate-naver-to-brand-sites.ts`

**동작:**
1. 기존 `naver_api` crawl_source 레코드를 `is_active = false`로 비활성화 (참조 무결성 유지, 삭제 안 함)
2. 기존 `naver_api` 소스에 연결된 `product_sources` 레코드는 `status = "discontinued"`로 일괄 업데이트 (재크롤 대상 제외, 가격 이력 보존)
3. 초기 브랜드 공식 사이트 `ai_agent` 소스 레코드 생성 (브랜드 목록은 스크립트에 하드코딩)

**데이터 보존 정책:**
- `naver_api` 기반 `product_sources` 및 `price_history` 레코드는 삭제하지 않고 유지
- `product_sources.status = "discontinued"` 처리로 재크롤에서 제외
- 동일 제품이 새 브랜드 사이트 크롤로 재수집되면 새 `product_sources` 행이 추가됨

---

## config.ts 변경

```ts
// 제거:
// naverClientId: process.env.NAVER_CLIENT_ID ?? "",
// naverClientSecret: process.env.NAVER_CLIENT_SECRET ?? "",

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
};
```

---

## 비용 고려사항

- Haiku API 호출: 페이지당 1회 → 브랜드 수 × 페이지 수만큼 증가
- HTML 전처리로 입력 크기 ~5KB 유지
- `max_pages` 설정으로 과도한 크롤링 방지

---

## 테스트 전략

- `AIAgentAdapter.fetchProductsFromSite` 유닛 테스트: mock Haiku 응답으로 페이지네이션 로직 및 순환 링크 방지 검증
- 기존 `tests/adapters/naver.test.ts` 삭제
- `crawl.ts`, `detectNew.ts` — `naver_api` 분기 제거 반영
