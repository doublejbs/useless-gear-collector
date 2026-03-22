# Gear Crawler Design

**Date:** 2026-03-22
**Project:** useless.my — 백패킹 장비 관리 서비스
**Scope:** 백패킹 장비 정보 수집 및 DB 구축 시스템

---

## 목표

useless.my 서비스의 장비 DB를 구축하기 위해, 국내외 쇼핑몰·브랜드 사이트에서 카테고리별 상세 스펙을 수집하고 주기적으로 업데이트하는 크롤링 시스템을 만든다.

---

## 수집 대상

- 국내: 네이버 쇼핑 (API), 쿠팡 (Playwright — 공개 API 없음)
- 해외 전문몰: REI, Backcountry (Playwright)
- 브랜드 공식 사이트: MSR, Big Agnes 등 (AI Agent Extractor)

수집 데이터: 제품명, 브랜드, 가격, 카테고리별 상세 스펙 (무게, 소재, 사이즈 등)

> **쿠팡 참고:** 공개 Product API 없음. Playwright로 접근하되 강력한 anti-bot 환경임을 감안해 1단계에서는 범위 조정 가능.

> **Naver API ToS:** 네이버 쇼핑 API는 데이터 출처 표기, 캐싱 기간 제한 등 이용 약관을 준수해야 한다. API 어댑터 구현 전 약관 검토 필요.

---

## 아키텍처

```
┌──────────────────┐     ┌──────────────────────────────────────────┐
│  Scheduler        │────▶│           Source Adapters                 │
│  (Celery + Redis) │     │  ┌──────────────┐  ┌──────────────────┐  │
└──────────────────┘     │  │ Naver API    │  │ Playwright       │  │
                         │  │ Adapter      │  │ Crawler          │  │
                         │  └──────────────┘  └──────────────────┘  │
                         │  ┌──────────────────────────────────────┐  │
                         │  │   AI Agent Extractor (Claude Haiku)  │  │
                         │  └──────────────────────────────────────┘  │
                         └────────────────────┬─────────────────────┘
                                              │ Raw Product Data
                                              ▼
                                   ┌─────────────────────┐
                                   │   Spec Normalizer    │
                                   │  (단위 정규화 + 필드 │
                                   │   매핑)              │
                                   └──────────┬──────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │   PostgreSQL DB      │
                                   └─────────────────────┘
```

---

## Source Adapters

| 어댑터 | 대상 | 방식 |
|--------|------|------|
| Naver Shopping API Adapter | 네이버 쇼핑 | REST API 호출 |
| Playwright Crawler | REI, Backcountry, 쿠팡(조건부) | 브라우저 렌더링 + HTML 파싱 |
| AI Agent Extractor | 브랜드 공식 사이트 등 비정형 페이지 | Claude Haiku — HTML 전처리 후 JSON 추출 |

### Rate Limiting 정책
- 모든 Playwright 크롤러는 robots.txt를 준수한다
- 기본 요청 간격: 2~5초 랜덤 딜레이
- 도메인별 최대 동시 요청: 1
- 429/503 응답 시: 지수 백오프 (최대 3회 재시도)
- 지속 실패 시: crawl_job 상태를 `failed`로 기록, Slack webhook으로 알림 발송

### AI Extractor 비용 전략
- HTML을 전송 전 전처리: `<script>`, `<style>`, 광고 등 불필요 태그 제거, 제품 스펙 관련 DOM 노드만 추출
- 목표 입력 크기: 페이지당 ~5KB 이내
- 모델: Claude Haiku (저비용)
- JSON 파싱 실패 시 fallback: 빈 specs로 저장 후 `needs_review = true` 플래그 설정

---

## 제품 식별 모델

동일 제품이 여러 소스에 존재할 수 있으므로, **정규 제품 테이블 + 소스별 테이블** 구조를 사용한다.

```
products (정규 제품) ← UNIQUE(brand, name)
    ↑ 1:N
product_sources (소스별 URL, 가격)
```

**중복 제거 전략:**
- `products` 테이블은 `(brand, name)` 복합 유니크 제약으로 중복 삽입을 방지한다
- 신규 제품 삽입 시 `INSERT ... ON CONFLICT (brand, name) DO UPDATE` upsert 사용
- 브랜드 또는 모델명이 다른 소스 간에 표기가 다를 경우 (e.g., "MSR" vs "Mountain Safety Research"): 초기에는 수동 매핑 테이블로 보조

**orphaned product_sources 처리:**
- `product_sources.product_id`는 `NOT NULL` — 링크 없이 소스 행을 삽입할 수 없다
- 즉, 소스 수집 → 정규 제품 upsert → product_sources 삽입 순서를 반드시 지킨다

---

## Spec Normalizer

원천 데이터의 단위·형식 불일치를 정규화한다.

**무게**
- 입력: `"1.2 lbs"`, `"544g"`, `"0.544 kg"` 등
- 정규화 단위: **g (그램)**

**온도 등급** (침낭)
- 입력: `"-7°C"`, `"20°F"` 등
- 정규화 단위: **°C**

**크기**
- 정규화 단위: **cm**, **L (리터)**

**열 전달 저항** (매트)
- 정규화 단위: **R-value (무단위)**

**통기성** (레인웨어)
- 정규화 단위: **g/m²/24h (MVTR)**

**화력** (스토브)
- 정규화 단위: **BTU/hr**

**누락 값 처리**
- 파싱 불가 필드: `null`로 저장
- AI 추출 실패: `needs_review = true` 플래그

---

## 카테고리별 스펙 스키마 (JSONB)

| 카테고리 | 핵심 스펙 (정규화 단위) |
|---------|----------------------|
| 침낭 (sleeping_bag) | fill_power(fp), fill_weight(g), temp_comfort(°C), temp_lower(°C), temp_extreme(°C), shape, shell_material, weight(g) |
| 텐트 (tent) | capacity(인), seasons, weight(g), packed_size(cm), floor_area(m²), height(cm), pole_material |
| 배낭 (backpack) | volume(L), weight(g), back_length(cm), hip_belt(bool), frame_type, material |
| 스토브 (stove) | weight(g), boil_time(min), fuel_type, output(BTU/hr) |
| 매트 (sleeping_pad) | r_value, thickness(cm), type, weight(g), packed_size(cm) |
| 레인웨어 (rain_jacket) | weight(g), waterproof_rating(mm), breathability(g/m²/24h), seam_type |

---

## DB 스키마

```sql
-- 소스 설정 테이블
CREATE TABLE crawl_sources (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  TEXT UNIQUE NOT NULL,
    adapter_type          TEXT NOT NULL CHECK (adapter_type IN ('naver_api', 'playwright', 'ai_agent')),
    base_url              TEXT,
    crawl_frequency_hours INT DEFAULT 168,
    is_active             BOOLEAN DEFAULT true,
    config                JSONB
    -- config JSONB 형태 (adapter_type별):
    --   naver_api:  {"api_key": "...", "category_id": "50000167"}
    --   playwright: {"entry_url": "...", "max_pages": 20, "new_arrivals_url": "..."}
    --   ai_agent:   {"entry_url": "...", "product_list_selector": "ul.products"}
);

-- 정규 제품 테이블
CREATE TABLE products (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    brand        TEXT,
    category     TEXT NOT NULL,
    specs        JSONB,
    needs_review BOOLEAN DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (brand, name)
);

-- 소스별 제품 URL / 가격
CREATE TABLE product_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id),
    source_id       UUID NOT NULL REFERENCES crawl_sources(id),
    crawl_job_id    UUID,              -- 마지막으로 이 행을 처리한 job
    source_url      TEXT UNIQUE NOT NULL,
    price           NUMERIC,
    currency        VARCHAR(3),
    image_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unavailable', 'discontinued')),
    last_crawled_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 가격 이력
CREATE TABLE price_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_source_id UUID NOT NULL REFERENCES product_sources(id),
    price             NUMERIC,
    currency          VARCHAR(3),
    recorded_at       TIMESTAMPTZ DEFAULT now()
);

-- 크롤링 작업 로그
CREATE TABLE crawl_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     UUID REFERENCES crawl_sources(id),
    status        TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'partial')),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    items_found   INT DEFAULT 0,
    items_updated INT DEFAULT 0,
    error         TEXT,
    retry_count   INT DEFAULT 0
);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER product_sources_updated_at
    BEFORE UPDATE ON product_sources
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**인덱스**
```sql
CREATE INDEX ON products(category);
CREATE INDEX ON products(brand);
CREATE INDEX ON products(needs_review);
CREATE INDEX ON products USING GIN(specs);
CREATE INDEX ON product_sources(source_id);
CREATE INDEX ON product_sources(status);
CREATE INDEX ON product_sources(last_crawled_at);
CREATE INDEX ON price_history(product_source_id, recorded_at DESC);
```

---

## 업데이트 전략

**주기 크롤링 (기본 매주, `crawl_sources.crawl_frequency_hours` 설정)**
- 가격 변동 감지 → `price_history` 기록
- 단종/품절 감지 → `product_sources.status` 업데이트

**신제품 감지**
- 우선순위: 소스의 신착/신제품 페이지 모니터링 (`config.new_arrivals_url`)
- fallback (신착 페이지 없는 사이트): 전체 제품 목록 URL과 기존 DB 비교 → 신규 URL 발견 시 수집 트리거

**Celery 작업 안정성**
- 최대 재시도: 3회 (지수 백오프)
- 3회 실패 시: `crawl_jobs.status = 'failed'`, Slack webhook 알림
- 일부 성공 시: `status = 'partial'`
- `product_sources.crawl_job_id` = 해당 행을 마지막으로 처리한 job ID (incident 추적용)

---

## 통화 처리

- 가격은 원천 통화로 저장 (`currency` 필드: KRW, USD 등)
- 환율 변환은 앱 레이어에서 처리 (DB에는 원본 통화만 보관)

---

## 기술 스택

| 역할 | 기술 |
|------|------|
| 언어 | Python |
| 브라우저 자동화 | Playwright |
| AI 추출 | Claude Haiku (Anthropic API) |
| 스케줄링 | Celery + Redis |
| DB | PostgreSQL |
| 알림 | Slack webhook (crawl 실패 시) |
