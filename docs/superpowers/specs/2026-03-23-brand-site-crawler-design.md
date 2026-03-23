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
- `src/crawl.ts`의 `naver_api` 분기
- `admin/app/(dashboard)/actions.ts`의 `getQueriesAction`, `saveQueriesAction`
- `admin/app/(dashboard)/query-editor.tsx`

### 변경
- `src/adapters/aiAgent.ts` — 제품 목록 페이지 순회 메서드 추가
- `src/crawl.ts` — ai_agent 분기에서 새 메서드 호출
- `src/pipeline/detectNew.ts` — Naver 의존성 제거, brand site 기반으로 전환
- `admin/app/(dashboard)/actions.ts` — 브랜드 소스 관리 액션으로 교체
- `admin/app/(dashboard)/` — query-editor → brand-sites-editor 컴포넌트 교체

### 유지
- `src/pipeline/ingest.ts`, `src/normalizer/*` — 변경 없음
- `src/adapters/playwright.ts` — 변경 없음
- `crawl_sources` DB 스키마 — 변경 없음
- GitHub Actions 워크플로우 — 변경 없음

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
1. `fetchPageHtml(entryUrl)` → HTML 취득
2. Haiku에 요청: 제품 목록 추출 + 다음 페이지 URL 추출
   - 응답 형식: `{ products: RawProduct[], nextPageUrl: string | null }`
3. `nextPageUrl`이 있고 현재 페이지 수 < `maxPages`이면 재귀 호출
4. 전체 수집된 `products` 반환

**Haiku 프롬프트 (목록 페이지용):**
- 제품명, 브랜드, 가격, 이미지 URL, 제품 상세 페이지 URL 추출
- 현재 페이지의 "다음 페이지" 링크 추출 (없으면 null)
- HTML 전처리: `<script>`, `<style>`, nav/footer 제거 후 전송 (~5KB 목표)

**기본값:** `maxPages = 20`

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
// 기존 naver_api 분기 제거
// ai_agent 분기 변경:
} else if (source.adapterType === "ai_agent") {
  const adapter = new AIAgentAdapter(config.anthropicApiKey);
  const cfg = (source.config as Record<string, unknown>) ?? {};
  const entryUrl = cfg["entry_url"] as string ?? "";
  const maxPages = (cfg["max_pages"] as number) ?? 20;
  if (entryUrl) {
    products = await adapter.fetchProductsFromSite(entryUrl, maxPages);
  }
}
```

---

## detectNew.ts 변경

**기존:** `NaverAdapter.fetchNewProducts()` 호출

**변경:** `ai_agent` 타입의 활성 소스 중 `new_arrivals_url` 또는 `entry_url`로 `fetchProductsFromSite(url, maxPages: 3)` 호출 → 기존 `filterNewUrls()`로 신규 URL 필터링.

---

## 어드민 대시보드 변경

### actions.ts

```ts
// 제거
getQueriesAction()
saveQueriesAction()

// 추가
getBrandSourcesAction()   // ai_agent 소스 목록 반환
saveBrandSourceAction()   // 소스 생성/업데이트
deleteBrandSourceAction() // 소스 삭제
```

### brand-sites-editor.tsx

기존 `query-editor.tsx` 교체. UI 구성:
- 등록된 브랜드 소스 목록 (이름, entry_url, 활성화 여부)
- 소스 추가 폼: 브랜드명, entry_url, new_arrivals_url(선택)
- 소스별 삭제 버튼 + 활성화 토글

---

## DB 전환

기존 `naver_api` 타입 crawl_source 레코드를 삭제하고 브랜드별 `ai_agent` 레코드로 교체.

마이그레이션 스크립트: `scripts/migrate-naver-to-brand-sites.ts`

**역할:**
1. 기존 `naver_api` 소스 비활성화 (삭제 대신 `is_active = false`)
2. 브랜드별 `ai_agent` 소스 레코드 생성 (초기 브랜드 목록은 스크립트에 하드코딩)

---

## 비용 고려사항

- Haiku API 호출: 페이지당 1회 → 브랜드 수 × 페이지 수만큼 증가
- HTML 전처리로 입력 크기 ~5KB 유지
- `max_pages` 설정으로 과도한 크롤링 방지

---

## 테스트 전략

- `AIAgentAdapter.fetchProductsFromSite` 유닛 테스트: mock Haiku 응답으로 페이지네이션 로직 검증
- 기존 `naver.test.ts` 삭제
- `crawl.ts` 통합 테스트: naver_api 분기 제거 반영
