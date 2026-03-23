# Brand Site Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naver Shopping API를 제거하고 브랜드 공식 사이트를 Playwright + Claude Haiku로 직접 크롤링하도록 전환한다.

**Architecture:** `AIAgentAdapter`에 제품 목록 페이지를 순회하는 `fetchProductsFromSite` 메서드를 추가한다. 각 페이지에서 Haiku가 제품 목록과 다음 페이지 URL을 추출하며, 방문 URL을 Set으로 추적해 순환 링크를 방지한다. `crawl.ts`와 `detectNew.ts`에서 `naver_api` 분기를 제거하고 `ai_agent` 분기를 새 메서드로 교체한다.

**Tech Stack:** TypeScript, Playwright, Anthropic SDK (claude-haiku-4-5-20251001), Cheerio, Prisma, Next.js (admin), Vitest

---

## File Map

| 파일 | 작업 |
|------|------|
| `src/adapters/aiAgent.ts` | `fetchProductsFromSite` 메서드 추가, 목록 페이지용 프롬프트 추가 |
| `tests/adapters/aiAgent.test.ts` | `fetchProductsFromSite` 테스트 추가 |
| `src/adapters/naver.ts` | **삭제** |
| `tests/adapters/naver.test.ts` | **삭제** |
| `src/crawl.ts` | `naver_api` 분기 제거, `ai_agent` 분기 업데이트, import 정리, 타입 어노테이션 수정 |
| `src/detectNew.ts` | `naver_api` 분기 제거, `ai_agent` 분기 업데이트, import 정리, 타입 어노테이션 수정 |
| `src/config.ts` | `naverClientId`, `naverClientSecret` 필드 제거 |
| `admin/app/(dashboard)/actions.ts` | Naver 액션 제거, 브랜드 소스 관리 액션 추가 |
| `admin/app/(dashboard)/query-editor.tsx` | **삭제** |
| `admin/app/(dashboard)/brand-sites-editor.tsx` | **신규 생성** |
| `admin/app/(dashboard)/page.tsx` | `naver_api` 쿼리 → `ai_agent` 소스 목록 조회로 교체 |
| `scripts/migrate-naver-to-brand-sites.ts` | **신규 생성** — DB 전환 스크립트 |

---

## Task 1: `fetchProductsFromSite` — 테스트 작성 및 구현

**Files:**
- Modify: `src/adapters/aiAgent.ts`
- Modify: `tests/adapters/aiAgent.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/adapters/aiAgent.test.ts` 파일 맨 아래에 다음 import 한 줄과 describe 블록을 추가한다. (기존 import나 describe 블록은 건드리지 않는다.)

```ts
import * as playwright from "../../src/adapters/playwright.js";

describe("AIAgentAdapter.fetchProductsFromSite", () => {
  let adapter: AIAgentAdapter;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new AIAgentAdapter("test-key");
    mockCreate = vi.fn();
    vi.spyOn(adapter["client"].messages, "create").mockImplementation(mockCreate);
  });

  it("단일 페이지: 제품 목록을 반환하고 nextPageUrl이 null이면 종료", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "Tent", category: "", price: 500, currency: "USD", imageUrl: "" }],
          nextPageUrl: null,
        }),
      }],
    });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(1);
    expect(results[0].brandEn).toBe("MSR");
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(1);
  });

  it("다음 페이지 링크를 따라 여러 페이지 순회", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "P1", category: "", price: 100, currency: "USD", imageUrl: "" }],
            nextPageUrl: "https://brand.com/products?page=2",
          }),
        }],
      })
      .mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            products: [{ sourceUrl: "https://brand.com/p2", brandEn: "MSR", nameEn: "P2", category: "", price: 200, currency: "USD", imageUrl: "" }],
            nextPageUrl: null,
          }),
        }],
      });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(2);
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(2);
  });

  it("이미 방문한 URL은 다시 방문하지 않음 (순환 링크 방지)", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: "https://brand.com/p1", brandEn: "MSR", nameEn: "P1", category: "", price: 100, currency: "USD", imageUrl: "" }],
          nextPageUrl: "https://brand.com/products", // 첫 페이지로 돌아오는 순환
        }),
      }],
    });

    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toHaveLength(1); // 한 번만 방문
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(1);
  });

  it("maxPages를 초과하면 순회를 중단", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    // 항상 다음 페이지를 반환하는 목
    let pageNum = 1;
    mockCreate.mockImplementation(async () => ({
      content: [{
        text: JSON.stringify({
          products: [{ sourceUrl: `https://brand.com/p${pageNum}`, brandEn: "X", nameEn: `P${pageNum++}`, category: "", price: 100, currency: "USD", imageUrl: "" }],
          nextPageUrl: `https://brand.com/products?page=${pageNum}`,
        }),
      }],
    }));

    const results = await adapter.fetchProductsFromSite("https://brand.com/products", 3);
    expect(results).toHaveLength(3);
    expect(playwright.fetchPageHtml).toHaveBeenCalledTimes(3);
  });

  it("fetchPageHtml이 null을 반환하면 빈 배열 반환", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue(null);
    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toEqual([]);
  });

  it("Haiku 응답이 JSON이 아닌 경우 해당 페이지 건너뜀", async () => {
    vi.spyOn(playwright, "fetchPageHtml").mockResolvedValue("<html>mock</html>");
    mockCreate.mockResolvedValue({ content: [{ text: "not json" }] });
    const results = await adapter.fetchProductsFromSite("https://brand.com/products");
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/user/Documents/oss/useless-gear-collector
npm test -- tests/adapters/aiAgent.test.ts
```

예상 결과: `fetchProductsFromSite is not a function` 또는 유사한 오류로 FAIL

- [ ] **Step 3: `fetchProductsFromSite` 구현**

`src/adapters/aiAgent.ts`에 상수와 메서드를 추가한다:

```ts
const LISTING_SYSTEM_PROMPT = `당신은 백패킹 장비 쇼핑몰의 제품 목록 페이지에서 정보를 추출하는 전문가입니다.
주어진 HTML에서 모든 제품과 다음 페이지 URL을 아래 JSON 형식으로 추출하세요:
{
  "products": [
    {
      "sourceUrl": "제품 상세 페이지 URL",
      "brandEn": "브랜드명(영문)",
      "nameEn": "제품명(영문)",
      "price": 숫자 또는 null,
      "currency": "USD 또는 KRW 등",
      "imageUrl": "이미지 URL"
    }
  ],
  "nextPageUrl": "다음 페이지 URL 또는 null"
}
JSON 외 다른 텍스트는 출력하지 마세요.`;
```

그리고 `AIAgentAdapter` 클래스 안에 메서드 추가:

```ts
async fetchProductsFromSite(
  entryUrl: string,
  maxPages = 20,
): Promise<RawProduct[]> {
  const visitedUrls = new Set<string>();
  const allProducts: RawProduct[] = [];

  let currentUrl: string | null = entryUrl;
  let pageCount = 0;

  while (currentUrl && !visitedUrls.has(currentUrl) && pageCount < maxPages) {
    const html = await fetchPageHtml(currentUrl);
    if (!html) break;

    visitedUrls.add(currentUrl);
    pageCount++;

    try {
      const cleaned = stripHtmlNoise(html);
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: LISTING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: cleaned }],
      });
      const text = (message.content[0] as { text: string }).text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        currentUrl = null;
        continue;
      }
      const data = JSON.parse(jsonMatch[0]) as {
        products: Array<Record<string, unknown>>;
        nextPageUrl: string | null;
      };

      const pageProducts: RawProduct[] = (data.products ?? []).map((p) => ({
        sourceUrl: String(p["sourceUrl"] ?? ""),
        brandEn: String(p["brandEn"] ?? ""),
        nameEn: String(p["nameEn"] ?? ""),
        price: typeof p["price"] === "number" ? p["price"] : undefined,
        currency: String(p["currency"] ?? "USD"),
        imageUrl: String(p["imageUrl"] ?? ""),
        category: "",
        specsRaw: {},
      }));

      allProducts.push(...pageProducts);
      currentUrl = data.nextPageUrl ?? null;
    } catch {
      currentUrl = null;
    }
  }

  return allProducts;
}
```

`fetchPageHtml`을 파일 상단에 import해야 한다:

```ts
import { fetchPageHtml } from "./playwright.js";
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npm test -- tests/adapters/aiAgent.test.ts
```

예상 결과: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/adapters/aiAgent.ts tests/adapters/aiAgent.test.ts
git commit -m "feat: add AIAgentAdapter.fetchProductsFromSite with pagination"
```

---

## Task 2: `crawl.ts` — Naver 분기 제거 및 ai_agent 분기 업데이트

**Files:**
- Modify: `src/crawl.ts`

> **TDD 참고:** `crawl.ts`와 `detectNew.ts`는 DB와 외부 서비스를 직접 호출하는 top-level entry point 스크립트이다. 핵심 로직(`fetchProductsFromSite`)은 Task 1에서 이미 테스트했으므로, 여기서는 타입 체크와 전체 테스트 통과 여부로 검증한다.

현재 `src/crawl.ts` 전체 교체 내용:

- [ ] **Step 1: `crawl.ts` 수정**

아래 내용으로 파일을 교체한다:

```ts
import { prisma } from "./db.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";
import type { RawProduct } from "./adapters/types.js";

async function runCrawl(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    const job = await prisma.crawlJob.create({
      data: { sourceId: source.id, status: "running", startedAt: new Date() },
    });

    let itemsFound = 0;
    try {
      let products: RawProduct[] = [];

      if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, unknown>) ?? {};
        const entryUrl = (cfg["entry_url"] as string) ?? "";
        const maxPages = (cfg["max_pages"] as number) ?? 20;
        if (entryUrl) {
          products = await adapter.fetchProductsFromSite(entryUrl, maxPages);
        }
      } else if (source.adapterType === "playwright") {
        // TODO: playwright-only sources (REI, Backcountry 등) — 별도 구현 예정
        products = [];
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

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

예상 결과: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/crawl.ts
git commit -m "feat: remove naver_api from crawl.ts, use fetchProductsFromSite"
```

---

## Task 3: `detectNew.ts` — Naver 분기 제거 및 ai_agent 분기 업데이트

**Files:**
- Modify: `src/detectNew.ts`

- [ ] **Step 1: `detectNew.ts` 수정**

아래 내용으로 파일을 교체한다:

```ts
import { prisma } from "./db.js";
import { AIAgentAdapter } from "./adapters/aiAgent.js";
import { filterNewUrls } from "./pipeline/detectNew.js";
import { ingestProduct } from "./pipeline/ingest.js";
import { sendSlackAlert } from "./alerts/slack.js";
import { config } from "./config.js";
import type { RawProduct } from "./adapters/types.js";

async function runDetectNew(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });

  for (const source of sources) {
    try {
      let products: RawProduct[] = [];

      if (source.adapterType === "ai_agent") {
        const adapter = new AIAgentAdapter(config.anthropicApiKey);
        const cfg = (source.config as Record<string, unknown>) ?? {};
        const url =
          (cfg["new_arrivals_url"] as string) ??
          (cfg["entry_url"] as string) ??
          "";
        if (url) {
          products = await adapter.fetchProductsFromSite(url, 3);
        }
      }

      const candidateUrls = new Set(products.map((p) => p.sourceUrl).filter(Boolean));
      const newUrls = await filterNewUrls(prisma, candidateUrls);
      const newProducts = products.filter((p) => newUrls.has(p.sourceUrl));

      for (const raw of newProducts) {
        await ingestProduct(prisma, raw, source.id, undefined);
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

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

예상 결과: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/detectNew.ts
git commit -m "feat: remove naver_api from detectNew.ts, use fetchProductsFromSite"
```

---

## Task 4: Naver 어댑터 삭제 및 config.ts 정리

**Files:**
- Delete: `src/adapters/naver.ts`
- Delete: `tests/adapters/naver.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: 파일 삭제**

```bash
rm /Users/user/Documents/oss/useless-gear-collector/src/adapters/naver.ts
rm /Users/user/Documents/oss/useless-gear-collector/tests/adapters/naver.test.ts
```

- [ ] **Step 2: `src/config.ts` 수정**

파일을 아래 내용으로 교체한다:

```ts
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
};
```

- [ ] **Step 3: 타입 체크 및 전체 테스트 실행**

```bash
npx tsc --noEmit && npm test
```

예상 결과: 타입 에러 없음, 삭제된 naver 테스트 제외 전체 PASS

- [ ] **Step 4: 환경 변수 제거 (수동 작업)**

GitHub Actions 시크릿에서 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`을 제거한다:
- GitHub 저장소 → Settings → Secrets and variables → Actions → 해당 시크릿 삭제

Vercel에서도 동일하게 제거한다:
- Vercel 프로젝트 → Settings → Environment Variables → `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 삭제

- [ ] **Step 5: 커밋**

```bash
git add src/config.ts
git rm src/adapters/naver.ts tests/adapters/naver.test.ts
git commit -m "chore: remove NaverAdapter and naver env vars"
```

---

## Task 5: 어드민 대시보드 — 브랜드 소스 에디터로 교체

**Files:**
- Modify: `admin/app/(dashboard)/actions.ts`
- Delete: `admin/app/(dashboard)/query-editor.tsx`
- Create: `admin/app/(dashboard)/brand-sites-editor.tsx`
- Modify: `admin/app/(dashboard)/page.tsx`

- [ ] **Step 1: `actions.ts` 수정**

`getQueriesAction`, `saveQueriesAction`을 제거하고 브랜드 소스 관리 액션을 추가한다. 파일 전체 내용:

```ts
"use server";

import { triggerWorkflow } from "@/lib/github";
import { prisma } from "@/lib/db";

export async function triggerCrawlAction(
  workflow: "crawl-weekly.yml" | "crawl-new.yml"
): Promise<{ ok: boolean; error?: string }> {
  try {
    await triggerWorkflow(workflow);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getJobsAction() {
  return prisma.crawlJob.findMany({
    take: 20,
    orderBy: { startedAt: "desc" },
    include: { source: { select: { name: true } } },
  });
}

export async function getBrandSourcesAction() {
  return prisma.crawlSource.findMany({
    where: { adapterType: "ai_agent" },
    orderBy: { name: "asc" },
  });
}

export async function saveBrandSourceAction(params: {
  id?: string;
  name: string;
  entryUrl: string;
  newArrivalsUrl?: string;
  maxPages?: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = {
      entry_url: params.entryUrl,
      ...(params.newArrivalsUrl ? { new_arrivals_url: params.newArrivalsUrl } : {}),
      ...(params.maxPages ? { max_pages: params.maxPages } : {}),
    };

    if (params.id) {
      await prisma.crawlSource.update({
        where: { id: params.id },
        data: { name: params.name, config },
      });
    } else {
      await prisma.crawlSource.create({
        data: {
          name: params.name,
          adapterType: "ai_agent",
          config,
          isActive: true,
        },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deleteBrandSourceAction(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.crawlSource.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function toggleBrandSourceAction(
  id: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.crawlSource.update({
      where: { id },
      data: { isActive },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

- [ ] **Step 2: `brand-sites-editor.tsx` 생성**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  saveBrandSourceAction,
  deleteBrandSourceAction,
  toggleBrandSourceAction,
  getBrandSourcesAction,
} from "./actions";

interface BrandSource {
  id: string;
  name: string;
  isActive: boolean;
  config: { entry_url: string; new_arrivals_url?: string; max_pages?: number } | null;
}

export function BrandSitesEditor({
  initialSources,
}: {
  initialSources: BrandSource[];
}) {
  const [sources, setSources] = useState<BrandSource[]>(initialSources);
  const [name, setName] = useState("");
  const [entryUrl, setEntryUrl] = useState("");
  const [newArrivalsUrl, setNewArrivalsUrl] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const updated = await getBrandSourcesAction();
    setSources(
      updated.map((s) => ({
        ...s,
        config: s.config as BrandSource["config"],
      }))
    );
  }

  function handleAdd() {
    if (!name.trim() || !entryUrl.trim()) return;
    startTransition(async () => {
      const result = await saveBrandSourceAction({
        name: name.trim(),
        entryUrl: entryUrl.trim(),
        newArrivalsUrl: newArrivalsUrl.trim() || undefined,
      });
      if (result.ok) {
        toast.success("브랜드 소스 추가 완료");
        setName("");
        setEntryUrl("");
        setNewArrivalsUrl("");
        await refresh();
      } else {
        toast.error(`추가 실패: ${result.error}`);
      }
    });
  }

  function handleToggle(id: string, currentActive: boolean) {
    startTransition(async () => {
      const result = await toggleBrandSourceAction(id, !currentActive);
      if (result.ok) {
        toast.success(currentActive ? "비활성화 완료" : "활성화 완료");
        await refresh();
      } else {
        toast.error(`변경 실패: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
        브랜드 공식 사이트
      </h2>
      <div className="space-y-2">
        {sources.map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between rounded border px-3 py-2 ${s.isActive ? "border-slate-200" : "border-slate-100 opacity-50"}`}
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <Badge className="bg-slate-100 text-slate-600 text-xs">
                  {s.config?.entry_url ?? "—"}
                </Badge>
                {!s.isActive && (
                  <Badge className="bg-red-50 text-red-400 text-xs">비활성</Badge>
                )}
              </div>
              {s.config?.new_arrivals_url && (
                <p className="text-xs text-slate-400">
                  신상: {s.config.new_arrivals_url}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggle(s.id, s.isActive)}
              disabled={isPending}
              className={s.isActive ? "text-slate-400 hover:text-red-500" : "text-slate-400 hover:text-green-600"}
            >
              {s.isActive ? "비활성화" : "활성화"}
            </Button>
          </div>
        ))}
        {sources.length === 0 && (
          <p className="text-sm text-slate-400">등록된 브랜드 없음</p>
        )}
      </div>
      <div className="space-y-2 rounded border border-dashed border-slate-200 p-3">
        <p className="text-xs text-slate-500 font-medium">새 브랜드 추가</p>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="브랜드명 (예: MSR)"
            className="w-40"
          />
          <Input
            value={entryUrl}
            onChange={(e) => setEntryUrl(e.target.value)}
            placeholder="제품 목록 URL"
            className="flex-1"
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={newArrivalsUrl}
            onChange={(e) => setNewArrivalsUrl(e.target.value)}
            placeholder="신제품 페이지 URL (선택)"
            className="flex-1"
          />
          <Button
            onClick={handleAdd}
            disabled={isPending || !name.trim() || !entryUrl.trim()}
          >
            {isPending ? "추가중..." : "추가"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        총 {sources.length}개 등록 · {sources.filter((s) => s.isActive).length}개 활성
      </p>
    </div>
  );
}
```

- [ ] **Step 3: `page.tsx` 수정**

파일 전체 내용을 아래로 교체한다:

```tsx
import { prisma } from "@/lib/db";
import { CrawlPanel } from "./crawl-panel";
import { BrandSitesEditor } from "./brand-sites-editor";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const [jobs, brandSources] = await Promise.all([
    prisma.crawlJob.findMany({
      take: 20,
      orderBy: { startedAt: "desc" },
      include: { source: { select: { name: true } } },
    }),
    prisma.crawlSource.findMany({
      where: { adapterType: "ai_agent" },
      orderBy: { name: "asc" },
    }),
  ]);

  const sources = brandSources.map((s) => ({
    id: s.id,
    name: s.name,
    isActive: s.isActive,
    config: s.config as { entry_url: string; new_arrivals_url?: string; max_pages?: number } | null,
  }));

  return (
    <div className="space-y-8">
      <CrawlPanel initialJobs={jobs} />
      <BrandSitesEditor initialSources={sources} />
    </div>
  );
}
```

- [ ] **Step 4: 기존 `query-editor.tsx` 삭제**

```bash
rm /Users/user/Documents/oss/useless-gear-collector/admin/app/\(dashboard\)/query-editor.tsx
```

- [ ] **Step 5: 어드민 타입 체크**

```bash
npx tsc --noEmit --project /Users/user/Documents/oss/useless-gear-collector/admin/tsconfig.json
```

예상 결과: 에러 없음

- [ ] **Step 6: 커밋**

```bash
cd /Users/user/Documents/oss/useless-gear-collector && git add admin/app/\(dashboard\)/actions.ts admin/app/\(dashboard\)/page.tsx admin/app/\(dashboard\)/brand-sites-editor.tsx && git rm admin/app/\(dashboard\)/query-editor.tsx && git commit -m "feat: replace Naver query editor with brand sites editor in admin"
```

---

## Task 6: DB 마이그레이션 스크립트 작성

**Files:**
- Create: `scripts/migrate-naver-to-brand-sites.ts`

- [ ] **Step 1: 스크립트 생성**

```ts
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
  console.log("1. naver_api 소스 비활성화...");
  const naverSources = await prisma.crawlSource.findMany({
    where: { adapterType: "naver_api" },
  });

  for (const source of naverSources) {
    await prisma.crawlSource.update({
      where: { id: source.id },
      data: { isActive: false },
    });

    const updated = await prisma.productSource.updateMany({
      where: { sourceId: source.id, status: "active" },
      data: { status: "discontinued" },
    });
    console.log(`  - ${source.name}: product_sources ${updated.count}개 discontinued 처리`);
  }

  console.log("2. 브랜드 공식 사이트 소스 생성...");
  for (const brand of INITIAL_BRAND_SOURCES) {
    const existing = await prisma.crawlSource.findFirst({ where: { name: brand.name } });
    if (existing) {
      console.log(`  - ${brand.name}: 이미 존재함, 건너뜀`);
      continue;
    }
    await prisma.crawlSource.create({
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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/migrate-naver-to-brand-sites.ts
git commit -m "chore: add DB migration script for naver → brand sites"
```

- [ ] **Step 3: (선택) 스크립트 실행**

실제 운영 DB 전환 시 실행. `DATABASE_URL` 환경변수가 필요하다.

```bash
DATABASE_URL="..." npx tsx scripts/migrate-naver-to-brand-sites.ts
```

---

## Task 7: 전체 확인

- [ ] **Step 1: 전체 테스트 실행**

```bash
cd /Users/user/Documents/oss/useless-gear-collector && npm test
```

예상 결과: 전체 PASS (naver 관련 테스트 제외)

- [ ] **Step 2: 전체 타입 체크**

```bash
npx tsc --noEmit
```

예상 결과: 에러 없음

- [ ] **Step 3: 최종 커밋**

모든 변경이 이미 개별 커밋으로 완료되었으므로 필요한 경우에만 실행:

```bash
git log --oneline -7
```
