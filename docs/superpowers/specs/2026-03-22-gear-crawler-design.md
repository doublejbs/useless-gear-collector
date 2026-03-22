# Gear Crawler Design

**Date:** 2026-03-22
**Project:** useless.my — 백패킹 장비 관리 서비스
**Scope:** 백패킹 장비 정보 수집 및 DB 구축 시스템

---

## 목표

useless.my 서비스의 장비 DB를 구축하기 위해, 국내외 쇼핑몰·브랜드 사이트에서 카테고리별 상세 스펙을 수집하고 주기적으로 업데이트하는 크롤링 시스템을 만든다.

---

## 수집 대상

- 국내 쇼핑몰: 네이버 쇼핑, 쿠팡 등
- 해외 백패킹 전문몰: REI, Backcountry 등
- 브랜드 공식 사이트: MSR, Big Agnes 등

수집 데이터: 제품명, 브랜드, 가격, 카테고리별 상세 스펙 (무게, 소재, 사이즈 등)

---

## 아키텍처

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  Scheduler   │────▶│           Source Adapters                 │
│  (Celery)    │     │  ┌──────────────┐  ┌──────────────────┐  │
└─────────────┘     │  │ Naver API    │  │ Playwright       │  │
                    │  │ Adapter      │  │ Crawler          │  │
                    │  └──────────────┘  └──────────────────┘  │
                    │  ┌──────────────────────────────────────┐  │
                    │  │   AI Agent Extractor (Claude API)    │  │
                    │  └──────────────────────────────────────┘  │
                    └────────────────────┬─────────────────────┘
                                         │ Raw Product Data
                                         ▼
                              ┌─────────────────────┐
                              │   Spec Normalizer    │
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
| Naver Shopping API Adapter | 네이버 쇼핑, 쿠팡 | REST API 호출 |
| Playwright Crawler | REI, Backcountry 등 안정적 HTML 구조 사이트 | 브라우저 렌더링 + HTML 파싱 |
| AI Agent Extractor | 브랜드 공식 사이트 등 비정형 페이지 | Claude Haiku API — HTML 전달 → JSON 추출 |

---

## 카테고리별 스펙 스키마 (JSONB)

공통 필드 + 카테고리별 `specs` JSONB 컬럼으로 관리.

| 카테고리 | 핵심 스펙 |
|---------|----------|
| 침낭 (sleeping_bag) | fill_power, fill_weight, temp_rating(comfort/lower/extreme), shape, shell_material, weight |
| 텐트 (tent) | capacity, seasons, weight, packed_size, floor_area, height, pole_material |
| 배낭 (backpack) | volume, weight, back_length, hip_belt, frame_type, material |
| 스토브 (stove) | weight, boil_time, fuel_type, output_btu |
| 매트 (sleeping_pad) | r_value, thickness, type, weight, packed_size |
| 레인웨어 (rain_jacket) | weight, waterproof_rating_mm, breathability, seam_type |

---

## DB 스키마

```sql
CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    brand       TEXT,
    category    TEXT NOT NULL,
    price       NUMERIC,
    currency    VARCHAR(3),
    source_site TEXT,
    source_url  TEXT UNIQUE,
    image_url   TEXT,
    specs       JSONB,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID REFERENCES products(id),
    price       NUMERIC,
    currency    VARCHAR(3),
    recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crawl_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_site TEXT,
    status      TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    items_found INT,
    error       TEXT
);

CREATE INDEX ON products(category);
CREATE INDEX ON products(brand);
CREATE INDEX ON products USING GIN(specs);
```

---

## 업데이트 전략

**주기 크롤링 (매주)**
- 가격 변동 감지 → price_history 기록
- 단종 감지 → is_active = false

**신제품 감지**
- 각 소스의 신착 페이지 모니터링
- DB에 없는 source_url 발견 시 전체 스펙 수집 트리거

---

## 기술 스택

| 역할 | 기술 |
|------|------|
| 언어 | Python |
| 브라우저 자동화 | Playwright |
| AI 추출 | Claude Haiku (Anthropic API) |
| 스케줄링 | Celery + Redis |
| DB | PostgreSQL |
