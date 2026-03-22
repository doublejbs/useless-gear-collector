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

## 데이터 모델

### 행(Row) 단위 정의

**색상·사이즈·무게가 다르면 별도 행으로 저장한다.** 즉, 하나의 행은 하나의 SKU(특정 색상 + 사이즈 + 무게 조합)를 나타낸다.

같은 제품군의 여러 SKU는 동일한 `group_id`로 묶는다.

```
예: NEMO Tensor 20R 매트
  - group_id: nemo_tensor
  - 행 1: 색상=루나, 사이즈=레귤러, 무게=410g
  - 행 2: 색상=루나, 사이즈=롱, 무게=480g
  - 행 3: 색상=루나, 사이즈=롱와이드, 무게=545g
```

### product_id 생성 규칙

`product_id`는 8자리 문자열: `YYMMDDnn`
- `YYMMDD`: 생성 날짜 (예: 260322)
- `nn`: 당일 순번 (01부터 시작, 99 초과 시 100으로 확장)
- 예: `26032201`, `26032202`, ...

순번은 `product_id_seq` 테이블에서 날짜별로 관리한다.

### 중복 제거 전략

- `(brand_en, name_en, color_en, size_en)` 복합 유니크 제약으로 중복 삽입 방지
- 신규 삽입 시 `INSERT ... ON CONFLICT DO UPDATE` upsert 사용
- 소스 간 브랜드·모델명 표기 차이 (e.g., "MSR" vs "Mountain Safety Research"): 브랜드 정규화 매핑 테이블(`brand_aliases`)로 보조

---

## 카테고리 목록 (34개)

```
배낭, 베스트 배낭, 배낭 커버, 텐트, 타프, 쉘터, 텐트ACC,
침낭, 매트, 필로우,
컵, 그릇, 수저, 버너, 토치, 물통, 식기류 기타,
체어, 테이블,
의류, 선글라스, 스패츠, 장갑,
조명, 식품, 수건, 디팩, 파우치나 수납용 가방,
핫팩, 삽, 망치, 아이젠, 트래킹폴, 그 외 기타
```

---

## 카테고리별 스펙 컬럼

### 텐트 / 타프 / 쉘터
`수용_인원, 월_구조, 형태, 이너_소재, 플라이_소재, 폴_소재, 내수압, 설치_유형, 전실_면적`

### 침낭
`형태, 충전재, 충전량, 필파워, 온도_comfort, 온도_lower_limit, 지퍼_방향`

### 매트
`타입, 형태, 소재, r_value, 두께, 펼친_크기`

### 배낭 / 베스트 배낭 / 디팩
`용량, 소재, 프레임_타입, 등판_시스템, 허리벨트_포함, 숄더_물통주머니, 레인커버_포함, 호환_성별`

### 버너 / 토치
`소재, 연료_타입, 화력, 점화_방식, 윈드스크린_내장`

### 컵 / 그릇 / 식기류 기타
`소재, 용량, 세트_구성`

### 수저
`소재, 세트_구성`

### 물통
`소재, 용량, 보온보냉, 입구_타입`

### 의류
`종류, 소재, 방수, 충전재, 후드`

### 선글라스
`렌즈_소재, uv_차단_등급, 편광`

### 장갑
`타입, 소재, 방수`

### 스패츠
`높이, 소재, 방수`

### 체어
`소재, 프레임_소재, 최대_하중, 팩_사이즈`

### 테이블
`상판_소재, 프레임_소재, 최대_하중, 팩_사이즈, 높이_조절`

### 조명
`타입, 최대_밝기, 배터리_타입, 방수_등급, 최대_사용시간, 적색광_모드`

### 트래킹폴
`소재, 접이_방식, 잠금_방식, 최소_길이, 최대_길이`

### 파우치나 수납용 가방 / 배낭 커버
`소재, 방수, 용량`

### 텐트ACC / 핫팩 / 삽 / 망치 / 수건 / 식품 / 아이젠 / 필로우 / 그 외 기타
`소재, 사이즈`

---

## 판매 지역 판단 기준

| 조건 | 판매_지역 값 |
|------|------------|
| 해외 공식 사이트만 있음 | `"해외"` |
| 국내 공식 사이트 있거나 29cm·무신사·보즈만 중 하나라도 판매 중 | `"국내"` |
| 위 둘 다 해당 | `"국내+해외"` |

---

## Spec Normalizer

원천 데이터의 단위·형식 불일치를 정규화한다.

**무게** → `g` 단위 숫자로 저장, 저장 시 "850g" 형식으로 표기
- 입력 예: `"1.2 lbs"` → `"544g"`, `"0.544 kg"` → `"544g"`

**온도** (침낭) → `°C` 정수
- 입력 예: `"20°F"` → `"-7°C"`

**크기** → `cm` (길이), `L` (용량), `m²` (면적)

**R-value** → 소수점 1자리 숫자 문자열 (e.g., `"4.2"`)

**화력** (버너) → `W` 또는 `kcal/h` 중 하나로 통일

**사이즈 한글 표기 통일**
| 원문 | 통일 표기 |
|------|----------|
| Regular, R | 레귤러 |
| Long, L | 롱 |
| Long Wide, LW | 롱와이드 |
| Large | 라지 |
| Short, S | 숏 |
| Small | 스몰 |
| Medium, M | 미디엄 |

**누락 값 처리**
- 스펙을 알 수 없는 항목: `""` (빈 문자열) — `null` 금지
- AI 추출 실패: `needs_review = true` 플래그

---

## DB 스키마

```sql
-- product_id 순번 관리
CREATE TABLE product_id_seq (
    date_key CHAR(6) PRIMARY KEY,  -- YYMMDD
    last_seq INT DEFAULT 0
);

-- 브랜드 별칭 매핑 (소스 간 표기 통일)
CREATE TABLE brand_aliases (
    alias      TEXT PRIMARY KEY,   -- e.g., "Mountain Safety Research"
    canonical  TEXT NOT NULL       -- e.g., "MSR"
);

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

-- 제품 테이블 (SKU 단위 — 색상·사이즈·무게별 별도 행)
CREATE TABLE products (
    product_id      CHAR(8) PRIMARY KEY,       -- YYMMDDnn
    group_id        TEXT NOT NULL,             -- 같은 제품군 묶음 (예: nemo_tensor)
    category        TEXT NOT NULL,             -- 카테고리 목록 34개 중 하나
    brand_kr        TEXT NOT NULL DEFAULT '',
    brand_en        TEXT NOT NULL DEFAULT '',
    name_kr         TEXT NOT NULL DEFAULT '',
    name_en         TEXT NOT NULL DEFAULT '',
    color_kr        TEXT NOT NULL DEFAULT '',
    color_en        TEXT NOT NULL DEFAULT '',
    size_kr         TEXT NOT NULL DEFAULT '',  -- 레귤러/롱/롱와이드/라지/숏/스몰/미디엄 통일
    size_en         TEXT NOT NULL DEFAULT '',
    weight          TEXT NOT NULL DEFAULT '',  -- 단위 포함 문자열 (예: "850g")
    sales_region    TEXT NOT NULL DEFAULT ''
                    CHECK (sales_region IN ('국내', '해외', '국내+해외', '')),
    naver_image_url TEXT NOT NULL DEFAULT '',
    specs           JSONB NOT NULL DEFAULT '{}',
    needs_review    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (brand_en, name_en, color_en, size_en)
);

-- 소스별 제품 URL / 가격
CREATE TABLE product_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      CHAR(8) NOT NULL REFERENCES products(product_id),
    source_id       UUID NOT NULL REFERENCES crawl_sources(id),
    crawl_job_id    UUID,
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
CREATE INDEX ON products(group_id);
CREATE INDEX ON products(category);
CREATE INDEX ON products(brand_en);
CREATE INDEX ON products(sales_region);
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
| 언어 | TypeScript (Node.js) |
| 브라우저 자동화 | Playwright |
| AI 추출 | Claude Haiku (Anthropic TypeScript SDK) |
| 스케줄링 | GitHub Actions (cron) |
| ORM | Prisma |
| DB | Supabase (managed PostgreSQL) |
| HTML 파싱 | Cheerio |
| HTTP 클라이언트 | fetch (native) |
| 테스트 | Vitest |
| 알림 | Slack webhook (crawl 실패 시) |
