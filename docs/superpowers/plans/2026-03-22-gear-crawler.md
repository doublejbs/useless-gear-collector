# Gear Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국내외 백패킹 장비 사이트에서 카테고리별 스펙을 수집해 PostgreSQL DB에 저장하는 크롤링 파이프라인을 구축한다.

**Architecture:** Celery 스케줄러가 소스별 어댑터(Naver API / Playwright / AI Agent)를 실행하고, 수집된 원시 데이터를 Spec Normalizer가 정규화한 뒤 PostgreSQL에 upsert한다. 제품은 SKU 단위(색상·사이즈·무게별 행)로 저장되고 group_id로 제품군을 묶는다.

**Tech Stack:** Python 3.12, SQLAlchemy 2.0, Alembic, Playwright, Anthropic SDK (Claude Haiku), Celery 5, Redis, PostgreSQL 15, pytest

---

## 파일 구조

```
useless-gear-collector/
├── pyproject.toml
├── .env.example
├── alembic.ini
├── alembic/
│   └── versions/
│       └── 001_initial_schema.py
├── src/
│   └── gear_collector/
│       ├── __init__.py
│       ├── config.py                  # 환경변수 로딩 (pydantic-settings)
│       ├── db/
│       │   ├── __init__.py
│       │   ├── connection.py          # SQLAlchemy engine + session factory
│       │   ├── models.py              # ORM 모델 전체 정의
│       │   └── product_id.py          # YYMMDDnn 순번 생성
│       ├── normalizer/
│       │   ├── __init__.py
│       │   ├── weight.py              # "1.2 lbs" → "544g"
│       │   ├── temperature.py         # "20°F" → "-7°C"
│       │   ├── size.py                # "Regular" → "레귤러"
│       │   └── specs.py               # 카테고리별 스펙 정규화 디스패처
│       ├── adapters/
│       │   ├── __init__.py
│       │   ├── base.py                # BaseAdapter 추상 클래스 + RawProduct
│       │   ├── naver.py               # 네이버 쇼핑 API 어댑터
│       │   ├── playwright_base.py     # Playwright 공통 + rate limiter
│       │   └── ai_agent.py            # Claude Haiku AI 추출기
│       ├── pipeline/
│       │   ├── __init__.py
│       │   ├── ingest.py              # 어댑터 → 정규화 → DB upsert 오케스트레이터
│       │   └── detect_new.py          # 신제품 감지 로직
│       ├── scheduler/
│       │   ├── __init__.py
│       │   ├── celery_app.py          # Celery 앱 설정
│       │   └── tasks.py               # Celery 태스크 정의
│       └── alerts/
│           ├── __init__.py
│           └── slack.py               # Slack webhook 알림
└── tests/
    ├── conftest.py                    # pytest fixtures, 테스트 DB 설정
    ├── db/
    │   ├── test_models.py
    │   └── test_product_id.py
    ├── normalizer/
    │   ├── test_weight.py
    │   ├── test_temperature.py
    │   ├── test_size.py
    │   └── test_specs.py
    ├── adapters/
    │   ├── test_base.py
    │   ├── test_naver.py
    │   └── test_ai_agent.py
    └── pipeline/
        ├── test_ingest.py
        └── test_detect_new.py
```

---

## Task 1: 프로젝트 초기 설정

**Files:**
- Create: `pyproject.toml`
- Create: `.env.example`
- Create: `src/gear_collector/__init__.py`
- Create: `src/gear_collector/config.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: `pyproject.toml` 생성**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "gear-collector"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "psycopg2-binary>=2.9",
    "playwright>=1.44",
    "anthropic>=0.28",
    "celery[redis]>=5.3",
    "pydantic-settings>=2.2",
    "httpx>=0.27",
    "beautifulsoup4>=4.12",
    "lxml>=5.2",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2",
    "pytest-asyncio>=0.23",
    "pytest-mock>=3.14",
]

[tool.hatch.build.targets.wheel]
packages = ["src/gear_collector"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: `.env.example` 생성**

```env
DATABASE_URL=postgresql://user:password@localhost:5432/gear_collector
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/gear_collector_test
REDIS_URL=redis://localhost:6379/0
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
ANTHROPIC_API_KEY=your_anthropic_api_key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

- [ ] **Step 3: `src/gear_collector/config.py` 생성**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    test_database_url: str = ""
    redis_url: str = "redis://localhost:6379/0"
    naver_client_id: str = ""
    naver_client_secret: str = ""
    anthropic_api_key: str = ""
    slack_webhook_url: str = ""


settings = Settings()
```

- [ ] **Step 4: `tests/conftest.py` 생성**

> `TEST_DATABASE_URL`을 `.env`에서 읽는다. 실행 전 `alembic upgrade head`를 test DB에 적용해야 한다.
> 각 테스트는 트랜잭션을 열고 종료 시 롤백하므로 DB 상태가 격리된다.

```python
import os
import pytest
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

load_dotenv()

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://user:password@localhost:5432/gear_collector_test",
)


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_DATABASE_URL)
    # 테이블이 없으면 ORM Base로 생성 (alembic 마이그레이션을 미리 적용해도 됨)
    from gear_collector.db.connection import Base
    from gear_collector.db import models  # noqa: F401 — 모델 등록
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db_session(engine):
    """각 테스트마다 트랜잭션을 열고 종료 시 롤백한다."""
    with engine.begin() as connection:
        session = Session(bind=connection)
        yield session
        session.close()
        connection.rollback()
```

- [ ] **Step 5: 패키지 설치**

```bash
pip install -e ".[dev]"
playwright install chromium
```

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml .env.example src/ tests/conftest.py
git commit -m "feat: project scaffolding and config"
```

---

## Task 2: DB 스키마 + Alembic 마이그레이션

**Files:**
- Create: `alembic.ini`
- Create: `alembic/env.py`
- Create: `alembic/versions/001_initial_schema.py`

- [ ] **Step 1: Alembic 초기화**

```bash
alembic init alembic
```

- [ ] **Step 2: `alembic/env.py` 수정 — DATABASE_URL을 환경변수에서 읽도록**

`alembic/env.py`의 `run_migrations_online()` 내 `connectable` 설정 부분을 아래로 교체:

```python
import os
from dotenv import load_dotenv
load_dotenv()

config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
```

- [ ] **Step 3: `alembic/versions/001_initial_schema.py` 작성**

```python
"""initial schema

Revision ID: 001
"""
from alembic import op

revision = "001"
down_revision = None


def upgrade():
    op.execute("""
        CREATE TABLE product_id_seq (
            date_key CHAR(6) PRIMARY KEY,
            last_seq INT DEFAULT 0
        )
    """)

    op.execute("""
        CREATE TABLE brand_aliases (
            alias     TEXT PRIMARY KEY,
            canonical TEXT NOT NULL
        )
    """)

    op.execute("""
        CREATE TABLE crawl_sources (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name                  TEXT UNIQUE NOT NULL,
            adapter_type          TEXT NOT NULL
                                  CHECK (adapter_type IN ('naver_api','playwright','ai_agent')),
            base_url              TEXT,
            crawl_frequency_hours INT DEFAULT 168,
            is_active             BOOLEAN DEFAULT true,
            config                JSONB
        )
    """)

    op.execute("""
        CREATE TABLE products (
            product_id      CHAR(8) PRIMARY KEY,
            group_id        TEXT NOT NULL,
            category        TEXT NOT NULL,
            brand_kr        TEXT NOT NULL DEFAULT '',
            brand_en        TEXT NOT NULL DEFAULT '',
            name_kr         TEXT NOT NULL DEFAULT '',
            name_en         TEXT NOT NULL DEFAULT '',
            color_kr        TEXT NOT NULL DEFAULT '',
            color_en        TEXT NOT NULL DEFAULT '',
            size_kr         TEXT NOT NULL DEFAULT '',
            size_en         TEXT NOT NULL DEFAULT '',
            weight          TEXT NOT NULL DEFAULT '',
            sales_region    TEXT NOT NULL DEFAULT ''
                            CHECK (sales_region IN ('국내','해외','국내+해외','')),
            naver_image_url TEXT NOT NULL DEFAULT '',
            specs           JSONB NOT NULL DEFAULT '{}',
            needs_review    BOOLEAN DEFAULT false,
            created_at      TIMESTAMPTZ DEFAULT now(),
            updated_at      TIMESTAMPTZ DEFAULT now(),
            UNIQUE (brand_en, name_en, color_en, size_en)
        )
    """)

    op.execute("""
        CREATE TABLE crawl_jobs (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_id     UUID REFERENCES crawl_sources(id),
            status        TEXT NOT NULL
                          CHECK (status IN ('running','done','failed','partial')),
            started_at    TIMESTAMPTZ,
            finished_at   TIMESTAMPTZ,
            items_found   INT DEFAULT 0,
            items_updated INT DEFAULT 0,
            error         TEXT,
            retry_count   INT DEFAULT 0
        )
    """)

    op.execute("""
        CREATE TABLE product_sources (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id      CHAR(8) NOT NULL REFERENCES products(product_id),
            source_id       UUID NOT NULL REFERENCES crawl_sources(id),
            crawl_job_id    UUID REFERENCES crawl_jobs(id),
            source_url      TEXT UNIQUE NOT NULL,
            price           NUMERIC,
            currency        VARCHAR(3),
            image_url       TEXT,
            status          TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','unavailable','discontinued')),
            last_crawled_at TIMESTAMPTZ,
            created_at      TIMESTAMPTZ DEFAULT now(),
            updated_at      TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE price_history (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_source_id UUID NOT NULL REFERENCES product_sources(id),
            price             NUMERIC,
            currency          VARCHAR(3),
            recorded_at       TIMESTAMPTZ DEFAULT now()
        )
    """)

    # 트리거
    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = now(); RETURN NEW; END;
        $$ LANGUAGE plpgsql
    """)
    for table in ("products", "product_sources"):
        op.execute(f"""
            CREATE TRIGGER {table}_updated_at
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """)

    # 인덱스
    for col in ("group_id", "category", "brand_en", "sales_region", "needs_review"):
        op.execute(f"CREATE INDEX ON products({col})")
    op.execute("CREATE INDEX ON products USING GIN(specs)")
    op.execute("CREATE INDEX ON product_sources(source_id)")
    op.execute("CREATE INDEX ON product_sources(status)")
    op.execute("CREATE INDEX ON product_sources(last_crawled_at)")
    op.execute("CREATE INDEX ON price_history(product_source_id, recorded_at DESC)")


def downgrade():
    # CASCADE를 사용하므로 FK 순서와 무관하게 안전하게 삭제됨
    for t in ("price_history", "product_sources", "crawl_jobs",
              "products", "crawl_sources", "brand_aliases", "product_id_seq"):
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at CASCADE")
```

- [ ] **Step 4: 마이그레이션 실행 확인**

```bash
alembic upgrade head
```

Expected: 테이블 7개 생성, 에러 없음

- [ ] **Step 5: Commit**

```bash
git add alembic.ini alembic/
git commit -m "feat: initial DB schema migration"
```

---

## Task 3: ORM 모델

**Files:**
- Create: `src/gear_collector/db/connection.py`
- Create: `src/gear_collector/db/models.py`
- Create: `tests/db/test_models.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/test_models.py`:
```python
import pytest
from sqlalchemy.exc import IntegrityError
from gear_collector.db.models import Product, ProductSource, CrawlSource, CrawlJob


def test_product_fields_have_empty_string_defaults(db_session):
    p = Product(
        product_id="26032201",
        group_id="msr_hubba",
        category="텐트",
        brand_en="MSR",
        name_en="Hubba Hubba 2",
        color_en="",
        size_en="",
    )
    db_session.add(p)
    db_session.flush()
    assert p.brand_kr == ""
    assert p.sales_region == ""
    assert p.specs == {}


def test_product_unique_constraint_on_sku(db_session):
    p1 = Product(product_id="26032201", group_id="g", category="텐트",
                 brand_en="MSR", name_en="Hubba", color_en="Red", size_en="2P")
    p2 = Product(product_id="26032202", group_id="g", category="텐트",
                 brand_en="MSR", name_en="Hubba", color_en="Red", size_en="2P")
    db_session.add(p1)
    db_session.flush()
    db_session.add(p2)
    with pytest.raises(IntegrityError):
        db_session.flush()
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/db/test_models.py -v
```

Expected: FAIL (ImportError)

- [ ] **Step 3: `src/gear_collector/db/connection.py` 작성**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from gear_collector.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
```

- [ ] **Step 4: `src/gear_collector/db/models.py` 작성**

```python
from datetime import datetime
from sqlalchemy import String, Text, Numeric, Boolean, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
import uuid
from gear_collector.db.connection import Base


class ProductIdSeq(Base):
    __tablename__ = "product_id_seq"
    date_key: Mapped[str] = mapped_column(String(6), primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0)


class BrandAlias(Base):
    __tablename__ = "brand_aliases"
    alias: Mapped[str] = mapped_column(Text, primary_key=True)
    canonical: Mapped[str] = mapped_column(Text, nullable=False)


class CrawlSource(Base):
    __tablename__ = "crawl_sources"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    adapter_type: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text)
    crawl_frequency_hours: Mapped[int] = mapped_column(Integer, default=168)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict | None] = mapped_column(JSONB)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("brand_en", "name_en", "color_en", "size_en"),)

    product_id: Mapped[str] = mapped_column(String(8), primary_key=True)
    group_id: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    brand_kr: Mapped[str] = mapped_column(Text, nullable=False, default="")
    brand_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name_kr: Mapped[str] = mapped_column(Text, nullable=False, default="")
    name_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color_kr: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    size_kr: Mapped[str] = mapped_column(Text, nullable=False, default="")
    size_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    weight: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sales_region: Mapped[str] = mapped_column(Text, nullable=False, default="")
    naver_image_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    specs: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sources: Mapped[list["ProductSource"]] = relationship(back_populates="product")


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("crawl_sources.id"))
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    items_found: Mapped[int] = mapped_column(Integer, default=0)
    items_updated: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)


class ProductSource(Base):
    __tablename__ = "product_sources"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.product_id"), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crawl_sources.id"), nullable=False)
    crawl_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("crawl_jobs.id"))
    source_url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    price: Mapped[float | None] = mapped_column(Numeric)
    currency: Mapped[str | None] = mapped_column(String(3))
    image_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    product: Mapped["Product"] = relationship(back_populates="sources")


class PriceHistory(Base):
    __tablename__ = "price_history"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_sources.id"), nullable=False)
    price: Mapped[float | None] = mapped_column(Numeric)
    currency: Mapped[str | None] = mapped_column(String(3))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
pytest tests/db/test_models.py -v
```

Expected: PASS 2

- [ ] **Step 6: Commit**

```bash
git add src/gear_collector/db/ tests/db/test_models.py
git commit -m "feat: ORM models for all DB tables"
```

---

## Task 4: Product ID 생성기

**Files:**
- Create: `src/gear_collector/db/product_id.py`
- Create: `tests/db/test_product_id.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/test_product_id.py`:
```python
from datetime import date
from gear_collector.db.product_id import generate_product_id


def test_format_is_yymmddnn(db_session):
    pid = generate_product_id(db_session, date(2026, 3, 22))
    assert pid == "26032201"


def test_sequential_same_day(db_session):
    pid1 = generate_product_id(db_session, date(2026, 3, 22))
    pid2 = generate_product_id(db_session, date(2026, 3, 22))
    assert pid1 == "26032201"
    assert pid2 == "26032202"


def test_resets_next_day(db_session):
    generate_product_id(db_session, date(2026, 3, 22))
    pid = generate_product_id(db_session, date(2026, 3, 23))
    assert pid == "26032301"


def test_exceeds_99_uses_three_digit_seq(db_session):
    """100번째 항목은 세 자리 순번으로 확장된다 (spec: 99 초과 시 100으로 확장)."""
    for _ in range(100):
        generate_product_id(db_session, date(2026, 3, 22))
    pid = generate_product_id(db_session, date(2026, 3, 22))
    assert pid == "260322101"  # 101번째 → 세 자리
    assert len(pid) == 9
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/db/test_product_id.py -v
```

Expected: FAIL (ImportError)

- [ ] **Step 3: `src/gear_collector/db/product_id.py` 작성**

```python
from datetime import date
from sqlalchemy.orm import Session
from gear_collector.db.models import ProductIdSeq


def generate_product_id(session: Session, today: date | None = None) -> str:
    """YYMMDDnn 형식의 product_id를 생성한다. 99 초과 시 세 자리 순번으로 확장."""
    if today is None:
        today = date.today()
    date_key = today.strftime("%y%m%d")

    row = session.get(ProductIdSeq, date_key, with_for_update=True)
    if row is None:
        row = ProductIdSeq(date_key=date_key, last_seq=0)
        session.add(row)

    row.last_seq += 1
    session.flush()

    seq_str = f"{row.last_seq:02d}" if row.last_seq <= 99 else str(row.last_seq)
    return f"{date_key}{seq_str}"
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/db/test_product_id.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/db/product_id.py tests/db/test_product_id.py
git commit -m "feat: YYMMDDnn product_id generator"
```

---

## Task 5: Spec Normalizer — 무게

**Files:**
- Create: `src/gear_collector/normalizer/weight.py`
- Create: `tests/normalizer/test_weight.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/test_weight.py`:
```python
import pytest
from gear_collector.normalizer.weight import normalize_weight


@pytest.mark.parametrize("raw, expected", [
    ("850g", "850g"),
    ("0.85kg", "850g"),
    ("0.85 kg", "850g"),
    ("1.2 lbs", "544g"),
    ("1.2lbs", "544g"),
    ("1.2 lb", "544g"),
    ("544 grams", "544g"),
    ("544 gram", "544g"),
    ("", ""),
    ("unknown", ""),
])
def test_normalize_weight(raw, expected):
    assert normalize_weight(raw) == expected
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/normalizer/test_weight.py -v
```

- [ ] **Step 3: `src/gear_collector/normalizer/weight.py` 작성**

```python
import re

_PATTERN = re.compile(
    r"([\d.]+)\s*(g|gram|grams|kg|kilogram|lbs?|pound|oz|ounce)",
    re.IGNORECASE,
)
_LBS_TO_G = 453.592
_OZ_TO_G = 28.3495
_KG_TO_G = 1000.0


def normalize_weight(raw: str) -> str:
    """무게 문자열을 'Ng' 형식으로 정규화한다. 파싱 불가 시 '' 반환."""
    if not raw:
        return ""
    m = _PATTERN.search(raw)
    if not m:
        return ""
    value, unit = float(m.group(1)), m.group(2).lower()
    if unit.startswith("kg") or unit.startswith("kilo"):
        grams = value * _KG_TO_G
    elif unit.startswith("lb") or unit.startswith("pound"):
        grams = value * _LBS_TO_G
    elif unit.startswith("oz") or unit.startswith("ounce"):
        grams = value * _OZ_TO_G
    else:
        grams = value
    return f"{round(grams)}g"
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/normalizer/test_weight.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/normalizer/weight.py tests/normalizer/test_weight.py
git commit -m "feat: weight normalizer (g/kg/lbs → Ng)"
```

---

## Task 6: Spec Normalizer — 온도

**Files:**
- Create: `src/gear_collector/normalizer/temperature.py`
- Create: `tests/normalizer/test_temperature.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/test_temperature.py`:
```python
import pytest
from gear_collector.normalizer.temperature import normalize_temperature


@pytest.mark.parametrize("raw, expected", [
    ("-7°C", "-7°C"),
    ("-7 °C", "-7°C"),
    ("20°F", "-7°C"),
    ("32°F", "0°C"),
    ("-40°F", "-40°C"),
    ("0°C", "0°C"),
    ("", ""),
    ("n/a", ""),
])
def test_normalize_temperature(raw, expected):
    assert normalize_temperature(raw) == expected
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/normalizer/test_temperature.py -v
```

- [ ] **Step 3: `src/gear_collector/normalizer/temperature.py` 작성**

```python
import re

_PATTERN = re.compile(r"(-?[\d.]+)\s*°?\s*(C|F)", re.IGNORECASE)


def normalize_temperature(raw: str) -> str:
    """온도 문자열을 '°C' 형식으로 정규화한다. 파싱 불가 시 '' 반환."""
    if not raw:
        return ""
    m = _PATTERN.search(raw)
    if not m:
        return ""
    value, unit = float(m.group(1)), m.group(2).upper()
    if unit == "F":
        celsius = (value - 32) * 5 / 9
    else:
        celsius = value
    return f"{round(celsius)}°C"
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/normalizer/test_temperature.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/normalizer/temperature.py tests/normalizer/test_temperature.py
git commit -m "feat: temperature normalizer (°F → °C)"
```

---

## Task 7: Spec Normalizer — 사이즈 한글 통일

**Files:**
- Create: `src/gear_collector/normalizer/size.py`
- Create: `tests/normalizer/test_size.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/test_size.py`:
```python
import pytest
from gear_collector.normalizer.size import normalize_size_kr


@pytest.mark.parametrize("raw, expected", [
    ("Regular", "레귤러"),
    ("regular", "레귤러"),
    ("R", "레귤러"),
    ("Long", "롱"),
    ("L", "롱"),
    ("Long Wide", "롱와이드"),
    ("LW", "롱와이드"),
    ("Large", "라지"),
    ("Short", "숏"),
    ("S", "숏"),
    ("Small", "스몰"),
    ("Medium", "미디엄"),
    ("M", "미디엄"),
    ("레귤러", "레귤러"),
    ("", ""),
    ("XL", ""),
])
def test_normalize_size_kr(raw, expected):
    assert normalize_size_kr(raw) == expected
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/normalizer/test_size.py -v
```

- [ ] **Step 3: `src/gear_collector/normalizer/size.py` 작성**

```python
_SIZE_MAP: dict[str, str] = {
    "regular": "레귤러", "r": "레귤러",
    "long wide": "롱와이드", "lw": "롱와이드",
    "long": "롱", "l": "롱",
    "large": "라지",
    "short": "숏", "s": "숏",
    "small": "스몰",
    "medium": "미디엄", "m": "미디엄",
    "레귤러": "레귤러", "롱": "롱", "롱와이드": "롱와이드",
    "라지": "라지", "숏": "숏", "스몰": "스몰", "미디엄": "미디엄",
}


def normalize_size_kr(raw: str) -> str:
    """사이즈 표기를 한글 통일 표기로 변환한다. 매핑 없으면 '' 반환."""
    return _SIZE_MAP.get(raw.strip().lower(), "")
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/normalizer/test_size.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/normalizer/size.py tests/normalizer/test_size.py
git commit -m "feat: size Korean standardization normalizer"
```

---

## Task 8: Spec Normalizer — 카테고리 스펙 디스패처

**Files:**
- Create: `src/gear_collector/normalizer/specs.py`
- Create: `tests/normalizer/test_specs.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/normalizer/test_specs.py`:
```python
from gear_collector.normalizer.specs import normalize_specs, CATEGORY_SPEC_KEYS


def test_category_spec_keys_cover_all_34_categories():
    """스펙에 정의된 34개 카테고리가 모두 포함되어야 한다."""
    assert len(CATEGORY_SPEC_KEYS) == 34


def test_tent_spec_keys():
    raw = {
        "수용_인원": "2", "월_구조": "더블월", "형태": "돔",
        "이너_소재": "나일론", "플라이_소재": "나일론", "폴_소재": "알루미늄",
        "내수압": "1500mm", "설치_유형": "자립", "전실_면적": "0.9m²",
        "unknown_key": "should be dropped",
    }
    result = normalize_specs("텐트", raw)
    assert "unknown_key" not in result
    assert result["수용_인원"] == "2"
    assert result["폴_소재"] == "알루미늄"


def test_missing_keys_become_empty_string():
    result = normalize_specs("침낭", {})
    for key in CATEGORY_SPEC_KEYS["침낭"]:
        assert result[key] == ""


def test_unknown_category_returns_empty_dict():
    result = normalize_specs("존재하지않는카테고리", {"foo": "bar"})
    assert result == {}


def test_sleeping_bag_weight_normalized():
    raw = {"형태": "머미", "충전재": "다운", "충전량": "1.2 lbs",
           "필파워": "850", "온도_comfort": "20°F", "온도_lower_limit": "-7°C",
           "지퍼_방향": "오른쪽"}
    result = normalize_specs("침낭", raw)
    assert result["충전량"] == "544g"
    assert result["온도_comfort"] == "-7°C"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/normalizer/test_specs.py -v
```

- [ ] **Step 3: `src/gear_collector/normalizer/specs.py` 작성**

```python
from gear_collector.normalizer.weight import normalize_weight
from gear_collector.normalizer.temperature import normalize_temperature

CATEGORY_SPEC_KEYS: dict[str, list[str]] = {
    "텐트":    ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
    "타프":    ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
    "쉘터":   ["수용_인원", "월_구조", "형태", "이너_소재", "플라이_소재", "폴_소재", "내수압", "설치_유형", "전실_면적"],
    "침낭":    ["형태", "충전재", "충전량", "필파워", "온도_comfort", "온도_lower_limit", "지퍼_방향"],
    "매트":    ["타입", "형태", "소재", "r_value", "두께", "펼친_크기"],
    "배낭":    ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
    "베스트 배낭": ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
    "디팩":   ["용량", "소재", "프레임_타입", "등판_시스템", "허리벨트_포함", "숄더_물통주머니", "레인커버_포함", "호환_성별"],
    "버너":    ["소재", "연료_타입", "화력", "점화_방식", "윈드스크린_내장"],
    "토치":    ["소재", "연료_타입", "화력", "점화_방식", "윈드스크린_내장"],
    "컵":      ["소재", "용량", "세트_구성"],
    "그릇":    ["소재", "용량", "세트_구성"],
    "식기류 기타": ["소재", "용량", "세트_구성"],
    "수저":    ["소재", "세트_구성"],
    "물통":    ["소재", "용량", "보온보냉", "입구_타입"],
    "의류":    ["종류", "소재", "방수", "충전재", "후드"],
    "선글라스": ["렌즈_소재", "uv_차단_등급", "편광"],
    "장갑":    ["타입", "소재", "방수"],
    "스패츠":  ["높이", "소재", "방수"],
    "체어":    ["소재", "프레임_소재", "최대_하중", "팩_사이즈"],
    "테이블":  ["상판_소재", "프레임_소재", "최대_하중", "팩_사이즈", "높이_조절"],
    "조명":    ["타입", "최대_밝기", "배터리_타입", "방수_등급", "최대_사용시간", "적색광_모드"],
    "트래킹폴": ["소재", "접이_방식", "잠금_방식", "최소_길이", "최대_길이"],
    "파우치나 수납용 가방": ["소재", "방수", "용량"],
    "배낭 커버": ["소재", "방수", "용량"],
}
# 간단 스펙 카테고리 (소재 + 사이즈) — 9개
for _cat in ["텐트ACC", "핫팩", "삽", "망치", "수건", "식품", "아이젠", "필로우", "그 외 기타"]:
    CATEGORY_SPEC_KEYS[_cat] = ["소재", "사이즈"]

# 총 34개 검증: 25 (explicit) + 9 (loop) = 34
assert len(CATEGORY_SPEC_KEYS) == 34, f"카테고리 수 불일치: {len(CATEGORY_SPEC_KEYS)}"

_WEIGHT_FIELDS = {"충전량"}
_TEMP_FIELDS = {"온도_comfort", "온도_lower_limit"}


def normalize_specs(category: str, raw: dict) -> dict:
    """카테고리별 정의된 키만 남기고 단위를 정규화한다. 누락 키는 '' 로 채운다."""
    keys = CATEGORY_SPEC_KEYS.get(category)
    if keys is None:
        return {}

    result: dict[str, str] = {}
    for key in keys:
        value = str(raw.get(key, ""))
        if key in _WEIGHT_FIELDS:
            value = normalize_weight(value)
        elif key in _TEMP_FIELDS:
            value = normalize_temperature(value)
        result[key] = value
    return result
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/normalizer/test_specs.py -v
```

Expected: PASS 5

- [ ] **Step 5: 전체 normalizer 테스트**

```bash
pytest tests/normalizer/ -v
```

- [ ] **Step 6: Commit**

```bash
git add src/gear_collector/normalizer/ tests/normalizer/
git commit -m "feat: category spec normalizer (34 categories, weight/temperature dispatch)"
```

---

## Task 9: BaseAdapter 인터페이스 + RawProduct

**Files:**
- Create: `src/gear_collector/adapters/base.py`
- Create: `tests/adapters/test_base.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/test_base.py`:
```python
import pytest
from gear_collector.adapters.base import BaseAdapter, RawProduct


def test_raw_product_defaults_are_empty_strings():
    p = RawProduct(source_url="https://x.com", brand_en="MSR",
                   name_en="Hubba", category="텐트")
    assert p.color_en == ""
    assert p.size_en == ""
    assert p.sales_region == ""
    assert p.specs_raw == {}


def test_base_adapter_is_abstract():
    with pytest.raises(TypeError):
        BaseAdapter()


class ConcreteAdapter(BaseAdapter):
    async def fetch_products(self, source_config): return []
    async def fetch_new_products(self, source_config): return []


def test_concrete_adapter_instantiates():
    adapter = ConcreteAdapter()
    assert adapter is not None
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/adapters/test_base.py -v
```

- [ ] **Step 3: `src/gear_collector/adapters/base.py` 작성**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class RawProduct:
    """어댑터가 반환하는 원시 제품 데이터."""
    source_url: str
    brand_en: str
    name_en: str
    category: str
    price: float | None = None
    currency: str = ""
    image_url: str = ""
    brand_kr: str = ""
    name_kr: str = ""
    color_en: str = ""
    color_kr: str = ""
    size_en: str = ""
    weight_raw: str = ""
    sales_region: str = ""          # "국내" / "해외" / "국내+해외" / ""
    specs_raw: dict = field(default_factory=dict)


class BaseAdapter(ABC):
    @abstractmethod
    async def fetch_products(self, source_config: dict) -> list[RawProduct]: ...

    @abstractmethod
    async def fetch_new_products(self, source_config: dict) -> list[RawProduct]: ...
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/adapters/test_base.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/adapters/base.py tests/adapters/test_base.py
git commit -m "feat: BaseAdapter interface and RawProduct dataclass"
```

---

## Task 10: Naver Shopping API 어댑터

**Files:**
- Create: `src/gear_collector/adapters/naver.py`
- Create: `tests/adapters/test_naver.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/test_naver.py`:
```python
import pytest
from unittest.mock import AsyncMock, patch
from gear_collector.adapters.naver import NaverAdapter
from gear_collector.adapters.base import RawProduct

MOCK_RESPONSE = {
    "items": [
        {
            "title": "<b>MSR</b> Hubba Hubba 2",
            "link": "https://shopping.naver.com/...",
            "image": "https://image.naver.com/...",
            "lprice": "450000",
            "brand": "MSR",
            "category3": "텐트",
        }
    ]
}


@pytest.mark.asyncio
async def test_fetch_products_parses_items():
    adapter = NaverAdapter(client_id="test", client_secret="test")
    config = {"category_id": "50000167", "query": "텐트"}

    with patch.object(adapter._client, "get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.json.return_value = MOCK_RESPONSE
        mock_get.return_value.raise_for_status = lambda: None
        products = await adapter.fetch_products(config)

    assert len(products) == 1
    p = products[0]
    assert isinstance(p, RawProduct)
    assert p.brand_en == "MSR"
    assert p.price == 450000.0
    assert p.currency == "KRW"


@pytest.mark.asyncio
async def test_html_tags_stripped_from_title():
    adapter = NaverAdapter(client_id="test", client_secret="test")

    with patch.object(adapter._client, "get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.json.return_value = MOCK_RESPONSE
        mock_get.return_value.raise_for_status = lambda: None
        products = await adapter.fetch_products({"query": "텐트"})

    assert "<b>" not in products[0].name_en
    assert "MSR" in products[0].name_en
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/adapters/test_naver.py -v
```

- [ ] **Step 3: `src/gear_collector/adapters/naver.py` 작성**

```python
import re
import httpx
from gear_collector.adapters.base import BaseAdapter, RawProduct

_NAVER_API_URL = "https://openapi.naver.com/v1/search/shop.json"
_STRIP_TAGS = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _STRIP_TAGS.sub("", text)


class NaverAdapter(BaseAdapter):
    def __init__(self, client_id: str, client_secret: str):
        self._client = httpx.AsyncClient(
            headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret},
            timeout=10,
        )

    async def fetch_products(self, source_config: dict) -> list[RawProduct]:
        params = {
            "query": source_config.get("query", "백패킹"),
            "display": source_config.get("display", 100),
            "start": source_config.get("start", 1),
        }
        if category_id := source_config.get("category_id"):
            params["category"] = category_id

        resp = await self._client.get(_NAVER_API_URL, params=params)
        resp.raise_for_status()
        items = resp.json().get("items", [])
        return [self._parse(item) for item in items]

    async def fetch_new_products(self, source_config: dict) -> list[RawProduct]:
        return await self.fetch_products({**source_config, "sort": "date"})

    def _parse(self, item: dict) -> RawProduct:
        return RawProduct(
            source_url=item.get("link", ""),
            brand_en=item.get("brand", ""),
            name_en=_strip_html(item.get("title", "")),
            category=item.get("category3", "") or item.get("category2", ""),
            price=float(item["lprice"]) if item.get("lprice") else None,
            currency="KRW",
            image_url=item.get("image", ""),
            sales_region="국내",  # 네이버 쇼핑 = 국내 판매 확인
        )
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/adapters/test_naver.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/adapters/naver.py tests/adapters/test_naver.py
git commit -m "feat: Naver Shopping API adapter"
```

---

## Task 11: Playwright 기반 + Rate Limiter

**Files:**
- Create: `src/gear_collector/adapters/playwright_base.py`

> **robots.txt 참고:** `urllib.robotparser`로 각 도메인의 robots.txt를 확인한다.
> 크롤링이 허용되지 않은 경로는 건너뛴다.

- [ ] **Step 1: `src/gear_collector/adapters/playwright_base.py` 작성**

```python
import asyncio
import random
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
import httpx
from playwright.async_api import async_playwright, Page, Browser
from gear_collector.adapters.base import BaseAdapter, RawProduct

_USER_AGENT = "GearCollectorBot/1.0"


def _is_allowed_by_robots(url: str) -> bool:
    """robots.txt를 확인해 크롤링 허용 여부를 반환한다."""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
    except Exception:
        return True  # robots.txt 없으면 허용으로 간주
    return rp.can_fetch(_USER_AGENT, url)


class PlaywrightAdapter(BaseAdapter):
    """robots.txt 준수 + rate limiting이 내장된 Playwright 기반 어댑터."""

    MIN_DELAY = 2.0
    MAX_DELAY = 5.0
    MAX_RETRIES = 3

    async def _get_page_html(self, page: Page, url: str, retries: int = 0) -> str | None:
        if not _is_allowed_by_robots(url):
            return None
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await asyncio.sleep(random.uniform(self.MIN_DELAY, self.MAX_DELAY))
            return await page.content()
        except Exception as exc:
            if retries < self.MAX_RETRIES:
                await asyncio.sleep(2 ** (retries + 1))
                return await self._get_page_html(page, url, retries + 1)
            return None

    async def fetch_products(self, source_config: dict) -> list[RawProduct]:
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            html = await self._get_page_html(page, source_config["entry_url"])
            await browser.close()
        if html is None:
            return []
        return self._parse_listing(html, source_config)

    async def fetch_new_products(self, source_config: dict) -> list[RawProduct]:
        url = source_config.get("new_arrivals_url", source_config["entry_url"])
        return await self.fetch_products({**source_config, "entry_url": url})

    def _parse_listing(self, html: str, config: dict) -> list[RawProduct]:
        """서브클래스에서 오버라이드. 기본 구현은 빈 리스트."""
        return []
```

- [ ] **Step 2: Commit**

```bash
git add src/gear_collector/adapters/playwright_base.py
git commit -m "feat: Playwright base adapter with robots.txt check and rate limiter"
```

---

## Task 12: AI Agent 추출기 (Claude Haiku)

**Files:**
- Create: `src/gear_collector/adapters/ai_agent.py`
- Create: `tests/adapters/test_ai_agent.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/test_ai_agent.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from gear_collector.adapters.ai_agent import AIAgentAdapter, _strip_html_noise


def test_strip_html_noise_removes_scripts():
    html = "<html><script>alert(1)</script><div class='spec'>Weight: 850g</div></html>"
    result = _strip_html_noise(html)
    assert "alert" not in result
    assert "850g" in result


def test_strip_html_noise_within_5kb():
    """스펙: 목표 입력 크기 5KB 이내."""
    large_html = "<html>" + "x" * 100_000 + "</html>"
    result = _strip_html_noise(large_html)
    assert len(result.encode()) <= 5_000


@pytest.mark.asyncio
async def test_extract_returns_raw_product():
    adapter = AIAgentAdapter(api_key="test")
    mock_message = MagicMock()
    mock_message.content = [MagicMock(
        text='{"brand_en": "MSR", "name_en": "Hubba 2", "category": "텐트", "specs_raw": {"수용_인원": "2"}}'
    )]

    with patch.object(adapter._client.messages, "create", new_callable=AsyncMock) as mock_create:
        mock_create.return_value = mock_message
        products = await adapter.extract_from_html(html="<html>...</html>", source_url="https://msr.com/hubba")

    assert len(products) == 1
    assert products[0].brand_en == "MSR"
    assert products[0].specs_raw["수용_인원"] == "2"


@pytest.mark.asyncio
async def test_extract_sets_needs_review_on_invalid_json():
    """JSON 파싱 실패 시 needs_review_flag=True인 빈 RawProduct를 반환한다."""
    adapter = AIAgentAdapter(api_key="test")
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text="not valid json")]

    with patch.object(adapter._client.messages, "create", new_callable=AsyncMock) as mock_create:
        mock_create.return_value = mock_message
        products = await adapter.extract_from_html(html="<html/>", source_url="https://x.com/product")

    assert len(products) == 1
    assert products[0].needs_review_flag is True
    assert products[0].specs_raw == {}
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/adapters/test_ai_agent.py -v
```

- [ ] **Step 3: `src/gear_collector/adapters/base.py` 수정 — `needs_review_flag` 필드 추가**

`RawProduct` dataclass에 필드 추가:
```python
needs_review_flag: bool = False   # AI 추출 실패 시 True
```

- [ ] **Step 4: `src/gear_collector/adapters/ai_agent.py` 작성**

```python
import json
import re
from bs4 import BeautifulSoup
import anthropic
from gear_collector.adapters.base import BaseAdapter, RawProduct

_MODEL = "claude-haiku-4-5-20251001"
_MAX_HTML_BYTES = 5_000  # 스펙: 목표 5KB 이내
_SYSTEM_PROMPT = """당신은 백패킹 장비 제품 페이지에서 정보를 추출하는 전문가입니다.
주어진 HTML에서 제품 정보를 아래 JSON 형식으로 추출하세요:
{
  "brand_en": "영문 브랜드명",
  "brand_kr": "한글 브랜드명 (없으면 빈 문자열)",
  "name_en": "영문 제품명",
  "name_kr": "한글 제품명 (없으면 빈 문자열)",
  "category": "카테고리",
  "color_en": "색상 (영문)",
  "color_kr": "색상 (한글)",
  "size_en": "사이즈 (영문)",
  "weight_raw": "무게 원문 (예: '850g', '1.2 lbs')",
  "specs_raw": { "스펙키": "값", ... }
}
JSON 외 다른 텍스트는 출력하지 마세요."""

_JSON_PATTERN = re.compile(r"\{.*\}", re.DOTALL)


def _strip_html_noise(html: str) -> str:
    """불필요한 태그를 제거하고 5KB 이내로 자른다."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header", "iframe", "noscript"]):
        tag.decompose()
    cleaned = str(soup)
    # 5KB 이내로 자르되 UTF-8 기준
    return cleaned.encode()[:_MAX_HTML_BYTES].decode(errors="ignore")


class AIAgentAdapter(BaseAdapter):
    def __init__(self, api_key: str):
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def fetch_products(self, source_config: dict) -> list[RawProduct]:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(source_config["entry_url"], wait_until="domcontentloaded")
            html = await page.content()
            await browser.close()
        return await self.extract_from_html(html, source_config["entry_url"])

    async def fetch_new_products(self, source_config: dict) -> list[RawProduct]:
        url = source_config.get("new_arrivals_url", source_config["entry_url"])
        return await self.fetch_products({**source_config, "entry_url": url})

    async def extract_from_html(self, html: str, source_url: str) -> list[RawProduct]:
        cleaned = _strip_html_noise(html)
        try:
            message = await self._client.messages.create(
                model=_MODEL,
                max_tokens=1024,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": cleaned}],
            )
            text = message.content[0].text
            m = _JSON_PATTERN.search(text)
            if not m:
                raise ValueError("No JSON found in response")
            data = json.loads(m.group())
        except Exception:
            # 파싱 실패 → needs_review_flag=True인 빈 제품 반환
            return [RawProduct(
                source_url=source_url,
                brand_en="", name_en="", category="",
                needs_review_flag=True,
            )]

        return [RawProduct(
            source_url=source_url,
            brand_en=data.get("brand_en", ""),
            brand_kr=data.get("brand_kr", ""),
            name_en=data.get("name_en", ""),
            name_kr=data.get("name_kr", ""),
            category=data.get("category", ""),
            color_en=data.get("color_en", ""),
            color_kr=data.get("color_kr", ""),
            size_en=data.get("size_en", ""),
            weight_raw=data.get("weight_raw", ""),
            specs_raw=data.get("specs_raw", {}),
        )]
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pytest tests/adapters/test_ai_agent.py -v
```

- [ ] **Step 6: Commit**

```bash
git add src/gear_collector/adapters/ tests/adapters/
git commit -m "feat: Claude Haiku AI agent extractor with 5KB HTML limit and needs_review fallback"
```

---

## Task 13: Ingest 파이프라인

**Files:**
- Create: `src/gear_collector/pipeline/ingest.py`
- Create: `tests/pipeline/test_ingest.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/test_ingest.py`:
```python
import pytest
from unittest.mock import MagicMock
from gear_collector.pipeline.ingest import ingest_product
from gear_collector.adapters.base import RawProduct
from gear_collector.db.models import Product, ProductSource


def make_raw(**kwargs):
    defaults = dict(
        source_url="https://rei.com/hubba",
        brand_en="MSR", name_en="Hubba Hubba 2",
        category="텐트", price=450.0, currency="USD",
        color_en="Green", size_en="2P",
        weight_raw="1.87 lbs",
        sales_region="해외",
        specs_raw={"수용_인원": "2", "폴_소재": "알루미늄"},
    )
    return RawProduct(**{**defaults, **kwargs})


def make_source(db_session):
    from gear_collector.db.models import CrawlSource
    import uuid
    source = CrawlSource(
        id=uuid.uuid4(), name="rei", adapter_type="playwright",
        is_active=True,
    )
    db_session.add(source)
    db_session.flush()
    return source


def test_ingest_creates_product_row(db_session):
    source = make_source(db_session)
    product_id = ingest_product(db_session, make_raw(), source, "job-1")
    p = db_session.get(Product, product_id)
    assert p is not None
    assert p.brand_en == "MSR"
    assert p.weight == "848g"
    assert p.specs["수용_인원"] == "2"
    assert p.sales_region == "해외"


def test_ingest_upserts_on_conflict(db_session):
    source = make_source(db_session)
    raw = make_raw()
    id1 = ingest_product(db_session, raw, source, "job1")
    id2 = ingest_product(db_session, make_raw(source_url="https://rei.com/hubba-v2"), source, "job2")
    assert id1 == id2  # 동일 brand_en+name_en+color_en+size_en → 같은 product_id


def test_ingest_creates_product_source(db_session):
    source = make_source(db_session)
    product_id = ingest_product(db_session, make_raw(), source, "job1")
    ps = db_session.query(ProductSource).filter_by(product_id=product_id).first()
    assert ps is not None
    assert ps.price == 450.0
    assert ps.currency == "USD"


def test_ingest_sets_needs_review_for_flagged_products(db_session):
    source = make_source(db_session)
    raw = make_raw(needs_review_flag=True, brand_en="", name_en="unknown", category="그 외 기타")
    product_id = ingest_product(db_session, raw, source, "job1")
    p = db_session.get(Product, product_id)
    assert p.needs_review is True
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/pipeline/test_ingest.py -v
```

- [ ] **Step 3: `src/gear_collector/pipeline/ingest.py` 작성**

```python
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from gear_collector.adapters.base import RawProduct
from gear_collector.db.models import Product, ProductSource, PriceHistory, CrawlSource, BrandAlias
from gear_collector.db.product_id import generate_product_id
from gear_collector.normalizer.weight import normalize_weight
from gear_collector.normalizer.size import normalize_size_kr
from gear_collector.normalizer.specs import normalize_specs


def _resolve_brand(session: Session, brand_en: str) -> str:
    alias = session.get(BrandAlias, brand_en)
    return alias.canonical if alias else brand_en


def ingest_product(
    session: Session,
    raw: RawProduct,
    source: CrawlSource,
    job_id: str,
) -> str:
    """RawProduct를 정규화하고 DB에 upsert한다. product_id를 반환한다."""
    brand_en = _resolve_brand(session, raw.brand_en)
    weight = normalize_weight(raw.weight_raw)
    size_kr = normalize_size_kr(raw.size_en)
    specs = normalize_specs(raw.category, raw.specs_raw)
    needs_review = getattr(raw, "needs_review_flag", False)

    existing = (
        session.query(Product)
        .filter_by(brand_en=brand_en, name_en=raw.name_en,
                   color_en=raw.color_en, size_en=raw.size_en)
        .first()
    )

    if existing:
        product_id = existing.product_id
        if weight:
            existing.weight = weight
        if specs:
            existing.specs = specs
        existing.brand_kr = raw.brand_kr or existing.brand_kr
        existing.name_kr = raw.name_kr or existing.name_kr
        existing.color_kr = raw.color_kr or existing.color_kr
        existing.sales_region = raw.sales_region or existing.sales_region
        if needs_review:
            existing.needs_review = True
    else:
        product_id = generate_product_id(session)
        group_id = f"{brand_en}_{raw.name_en}".lower().replace(" ", "_").replace("-", "_")
        product = Product(
            product_id=product_id,
            group_id=group_id,
            category=raw.category,
            brand_en=brand_en,
            brand_kr=raw.brand_kr,
            name_en=raw.name_en,
            name_kr=raw.name_kr,
            color_en=raw.color_en,
            color_kr=raw.color_kr,
            size_en=raw.size_en,
            size_kr=size_kr,
            weight=weight,
            sales_region=raw.sales_region,
            specs=specs,
            needs_review=needs_review,
        )
        session.add(product)
        session.flush()

    now = datetime.now(timezone.utc)
    ps = session.query(ProductSource).filter_by(source_url=raw.source_url).first()
    if ps is None:
        ps = ProductSource(
            product_id=product_id,
            source_id=source.id,
            crawl_job_id=job_id,
            source_url=raw.source_url,
            price=raw.price,
            currency=raw.currency,
            image_url=raw.image_url,
            last_crawled_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(ps)
        session.flush()
    else:
        if ps.price != raw.price and raw.price is not None:
            session.add(PriceHistory(
                product_source_id=ps.id,
                price=raw.price,
                currency=raw.currency,
                recorded_at=now,
            ))
        ps.price = raw.price
        ps.crawl_job_id = job_id
        ps.last_crawled_at = now

    return product_id
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/pipeline/test_ingest.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/pipeline/ingest.py tests/pipeline/test_ingest.py
git commit -m "feat: ingest pipeline with sales_region and needs_review support"
```

---

## Task 14: 신제품 감지

**Files:**
- Create: `src/gear_collector/pipeline/detect_new.py`
- Create: `tests/pipeline/test_detect_new.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/test_detect_new.py`:
```python
import uuid
from datetime import datetime, timezone
from gear_collector.pipeline.detect_new import filter_new_urls
from gear_collector.db.models import Product, ProductSource, CrawlSource


def _seed_existing_url(db_session, url: str) -> None:
    """테스트용 product + product_source 행을 삽입한다."""
    source = CrawlSource(id=uuid.uuid4(), name=f"src-{uuid.uuid4().hex[:4]}",
                         adapter_type="playwright", is_active=True)
    db_session.add(source)
    db_session.flush()

    product = Product(
        product_id=f"2603{uuid.uuid4().hex[:4]}", group_id="g",
        category="텐트", brand_en="X", name_en="Y",
        color_en="", size_en="",
    )
    db_session.add(product)
    db_session.flush()

    ps = ProductSource(
        product_id=product.product_id,
        source_id=source.id,
        source_url=url,
        status="active",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(ps)
    db_session.flush()


def test_returns_only_unseen_urls(db_session):
    _seed_existing_url(db_session, "https://rei.com/old-product")
    candidate_urls = {"https://rei.com/old-product", "https://rei.com/new-product"}
    new_urls = filter_new_urls(db_session, candidate_urls)
    assert new_urls == {"https://rei.com/new-product"}


def test_empty_candidates_returns_empty(db_session):
    assert filter_new_urls(db_session, set()) == set()
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pytest tests/pipeline/test_detect_new.py -v
```

- [ ] **Step 3: `src/gear_collector/pipeline/detect_new.py` 작성**

```python
from sqlalchemy.orm import Session
from gear_collector.db.models import ProductSource


def filter_new_urls(session: Session, candidate_urls: set[str]) -> set[str]:
    """후보 URL 중 DB에 없는 신규 URL만 반환한다."""
    if not candidate_urls:
        return set()
    existing = {
        row[0]
        for row in session.query(ProductSource.source_url)
        .filter(ProductSource.source_url.in_(candidate_urls))
        .all()
    }
    return candidate_urls - existing
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pytest tests/pipeline/test_detect_new.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/gear_collector/pipeline/detect_new.py tests/pipeline/test_detect_new.py
git commit -m "feat: new product URL detection"
```

---

## Task 15: Slack 알림

**Files:**
- Create: `src/gear_collector/alerts/slack.py`

- [ ] **Step 1: `src/gear_collector/alerts/slack.py` 작성**

```python
import httpx
from gear_collector.config import settings


async def send_slack_alert(message: str) -> None:
    """Slack webhook으로 알림을 발송한다. webhook URL이 없으면 무시한다."""
    if not settings.slack_webhook_url:
        return
    async with httpx.AsyncClient() as client:
        await client.post(settings.slack_webhook_url, json={"text": message})
```

- [ ] **Step 2: Commit**

```bash
git add src/gear_collector/alerts/slack.py
git commit -m "feat: Slack webhook alert"
```

---

## Task 16: Celery 스케줄러 + 태스크

**Files:**
- Create: `src/gear_collector/scheduler/celery_app.py`
- Create: `src/gear_collector/scheduler/tasks.py`

> **비동기 주의:** Celery 태스크 내에서 `asyncio.run()`은 새 이벤트 루프를 생성한다.
> gevent/eventlet 동시성 모드와는 호환되지 않는다. 기본 prefork 모드에서만 사용할 것.

- [ ] **Step 1: `src/gear_collector/scheduler/celery_app.py` 작성**

```python
from celery import Celery
from gear_collector.config import settings

app = Celery("gear_collector", broker=settings.redis_url, backend=settings.redis_url)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_concurrency=1,  # 도메인별 동시 요청 1 제한 (spec)
)

app.conf.beat_schedule = {
    "weekly-crawl": {
        "task": "gear_collector.scheduler.tasks.run_periodic_crawl",
        "schedule": 3600 * 24 * 7,
    },
    "daily-new-product-detect": {
        "task": "gear_collector.scheduler.tasks.run_new_product_detect",
        "schedule": 3600 * 24,
    },
}
```

- [ ] **Step 2: `src/gear_collector/scheduler/tasks.py` 작성**

```python
import asyncio
from datetime import datetime, timezone
from celery.utils.log import get_task_logger
from gear_collector.scheduler.celery_app import app
from gear_collector.db.connection import SessionLocal
from gear_collector.db.models import CrawlSource, CrawlJob
from gear_collector.pipeline.ingest import ingest_product
from gear_collector.alerts.slack import send_slack_alert

logger = get_task_logger(__name__)


def _get_adapter(adapter_type: str):
    from gear_collector.config import settings
    if adapter_type == "naver_api":
        from gear_collector.adapters.naver import NaverAdapter
        return NaverAdapter(settings.naver_client_id, settings.naver_client_secret)
    if adapter_type == "playwright":
        from gear_collector.adapters.playwright_base import PlaywrightAdapter
        return PlaywrightAdapter()
    if adapter_type == "ai_agent":
        from gear_collector.adapters.ai_agent import AIAgentAdapter
        return AIAgentAdapter(settings.anthropic_api_key)
    raise ValueError(f"Unknown adapter_type: {adapter_type}")


def _run_async(coro):
    """Celery prefork 워커에서 async 코루틴을 실행한다."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_periodic_crawl(self, source_name: str | None = None):
    session = SessionLocal()
    try:
        query = session.query(CrawlSource).filter_by(is_active=True)
        if source_name:
            query = query.filter_by(name=source_name)
        sources = query.all()

        for source in sources:
            job = CrawlJob(source_id=source.id, status="running",
                           started_at=datetime.now(timezone.utc))
            session.add(job)
            session.flush()
            try:
                adapter = _get_adapter(source.adapter_type)
                products = _run_async(adapter.fetch_products(source.config or {}))
                for raw in products:
                    ingest_product(session, raw, source, str(job.id))
                job.status = "done"
                job.items_found = len(products)
                job.items_updated = len(products)
            except Exception as exc:
                job.status = "failed"
                job.error = str(exc)
                session.commit()
                _run_async(send_slack_alert(f":red_circle: Crawl FAILED: {source.name}\n```{exc}```"))
                raise self.retry(exc=exc)
            finally:
                job.finished_at = datetime.now(timezone.utc)

        session.commit()
    finally:
        session.close()


@app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_new_product_detect(self, source_name: str | None = None):
    session = SessionLocal()
    try:
        query = session.query(CrawlSource).filter_by(is_active=True)
        if source_name:
            query = query.filter_by(name=source_name)
        sources = query.all()

        for source in sources:
            try:
                adapter = _get_adapter(source.adapter_type)
                new_products = _run_async(adapter.fetch_new_products(source.config or {}))
                for raw in new_products:
                    ingest_product(session, raw, source, "detect_new")
            except Exception as exc:
                _run_async(send_slack_alert(
                    f":warning: New product detect FAILED: {source.name}\n```{exc}```"
                ))
                raise self.retry(exc=exc)

        session.commit()
    finally:
        session.close()
```

- [ ] **Step 3: Commit**

```bash
git add src/gear_collector/scheduler/
git commit -m "feat: Celery scheduler with weekly crawl and daily new-product detection"
```

---

## Task 17: 전체 테스트 실행 및 최종 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
pytest tests/ -v --tb=short
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: 문법 오류 확인**

```bash
python -m py_compile $(find src -name "*.py")
```

- [ ] **Step 3: 실행 환경 준비**

```bash
cp .env.example .env
# .env 편집: DATABASE_URL, TEST_DATABASE_URL, NAVER_CLIENT_ID, ANTHROPIC_API_KEY 입력
```

- [ ] **Step 4: 테스트 DB 마이그레이션**

```bash
DATABASE_URL=$TEST_DATABASE_URL alembic upgrade head
```

- [ ] **Step 5: Celery worker + beat 실행 확인**

```bash
# 별도 터미널 2개
celery -A gear_collector.scheduler.celery_app worker --loglevel=info --pool=prefork
celery -A gear_collector.scheduler.celery_app beat --loglevel=info
```

Expected: worker 태스크 등록 메시지 출력, 에러 없음

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete gear crawler pipeline"
```
