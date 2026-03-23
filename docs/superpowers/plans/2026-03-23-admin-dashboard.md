# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 크롤 실행/모니터링과 제품 데이터 편집을 위한 내부 관리 대시보드를 `admin/` 디렉토리에 Next.js 15 + shadcn/ui로 구축하고 Vercel에 배포한다.

**Architecture:** `useless-gear-collector/admin/`에 독립적인 Next.js 15 프로젝트를 추가한다. 기존 `prisma/schema.prisma`와 Supabase DB를 공유하며, 크롤 실행은 GitHub Actions workflow_dispatch API로 트리거한다. 인증은 iron-session의 HttpOnly 쿠키로 처리한다.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, shadcn/ui, Tailwind CSS, Prisma, iron-session, Vercel

---

## 파일 구조

```
admin/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── components.json          # shadcn 설정
├── middleware.ts            # 인증 가드
├── .env.example
├── app/
│   ├── globals.css
│   ├── layout.tsx           # 루트 레이아웃 (Toaster 포함)
│   ├── login/
│   │   ├── page.tsx         # 로그인 폼
│   │   └── actions.ts       # 로그인 서버 액션
│   └── (dashboard)/
│       ├── layout.tsx       # 사이드바 레이아웃
│       ├── page.tsx         # 크롤 현황 (서버 컴포넌트)
│       ├── crawl-panel.tsx  # 크롤 버튼 + 폴링 (클라이언트 컴포넌트)
│       ├── actions.ts       # triggerCrawl, getJobs 서버 액션
│       ├── products/
│       │   └── page.tsx     # 제품 목록 (서버 컴포넌트)
│       └── products/[id]/
│           ├── page.tsx     # 제품 편집 (서버 컴포넌트)
│           └── actions.ts   # saveProduct 서버 액션
├── components/
│   ├── ui/                  # shadcn 자동 생성
│   └── sidebar.tsx          # 사이드바 네비게이션 (클라이언트)
└── lib/
    ├── auth.ts              # iron-session 설정 + getSession
    ├── db.ts                # Prisma 클라이언트 싱글톤
    ├── github.ts            # triggerWorkflow
    ├── specs.ts             # CATEGORY_SPEC_KEYS (34 카테고리)
    └── utils.ts             # shadcn 자동 생성 (cn helper)
```

---

## Task 1: 프로젝트 초기 설정

**Files:**
- Create: `admin/package.json`
- Create: `admin/tsconfig.json`
- Create: `admin/next.config.ts`
- Create: `admin/tailwind.config.ts`
- Create: `admin/app/globals.css`
- Create: `admin/app/layout.tsx`
- Create: `admin/.env.example`

- [ ] **Step 1: `admin/package.json` 생성**

```json
{
  "name": "gear-admin",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start"
  },
  "prisma": {
    "schema": "../prisma/schema.prisma"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0",
    "iron-session": "^8.0.1",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "prisma": "^5.14.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: `admin/tsconfig.json` 생성**

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: `admin/next.config.ts` 생성**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: `admin/tailwind.config.ts` 생성**

shadcn init이 덮어쓸 것이므로 빈 파일로 생성:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: `admin/app/globals.css` 생성 (shadcn init 전 플레이스홀더)**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: `admin/app/layout.tsx` 생성**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gear Admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: `admin/.env.example` 생성**

```env
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=your-32-char-or-longer-random-secret-key
GITHUB_TOKEN=ghp_your_personal_access_token
GITHUB_REPO=owner/repo-name
```

- [ ] **Step 8: 의존성 설치 및 Prisma 클라이언트 생성**

```bash
cd admin
npm install
npx prisma generate
```

Expected: `node_modules` 설치 완료, `@prisma/client` 생성됨

- [ ] **Step 9: Commit**

```bash
git add admin/package.json admin/tsconfig.json admin/next.config.ts admin/tailwind.config.ts admin/app/globals.css admin/app/layout.tsx admin/.env.example
git commit -m "feat: admin Next.js project setup"
```

---

## Task 2: shadcn 초기화 + 컴포넌트 설치

**Files:**
- Create: `admin/components.json` (shadcn init 자동 생성)
- Create: `admin/lib/utils.ts` (shadcn init 자동 생성)
- Create: `admin/components/ui/` (shadcn add 자동 생성)

- [ ] **Step 1: shadcn 초기화**

```bash
cd admin
npx shadcn@latest init -d
```

`-d` 플래그는 기본값(New York style, CSS variables, slate base color)을 사용한다. 인터랙티브 프롬프트가 나오면:
- Style: New York
- Base color: Slate
- CSS variables: Yes

- [ ] **Step 2: 필요한 컴포넌트 일괄 설치**

```bash
npx shadcn@latest add button badge table input label select checkbox card pagination sonner
```

Expected: `components/ui/` 아래 각 컴포넌트 파일 생성

- [ ] **Step 3: `app/layout.tsx`에 Toaster 추가**

기존 `app/layout.tsx`를 다음으로 교체:

```tsx
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gear Admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add admin/components.json admin/lib/utils.ts admin/components/ui/ admin/app/layout.tsx admin/app/globals.css admin/tailwind.config.ts
git commit -m "feat: shadcn/ui setup with core components"
```

---

## Task 3: 공유 라이브러리 (auth, db, github, specs)

**Files:**
- Create: `admin/lib/auth.ts`
- Create: `admin/lib/db.ts`
- Create: `admin/lib/github.ts`
- Create: `admin/lib/specs.ts`

- [ ] **Step 1: `admin/lib/auth.ts` 생성**

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  user?: { isLoggedIn: boolean };
}

export const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET!,
  cookieName: "gear-admin-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7일
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}
```

- [ ] **Step 2: `admin/lib/db.ts` 생성**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: `admin/lib/github.ts` 생성**

```typescript
export async function triggerWorkflow(workflowFile: string): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    throw new Error("GITHUB_REPO 또는 GITHUB_TOKEN 환경변수가 설정되지 않았습니다.");
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API error: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 4: `admin/lib/specs.ts` 생성**

`src/normalizer/specs.ts`와 동기화된 복사본. 카테고리 변경 시 함께 업데이트한다.

```typescript
// 34 카테고리 스펙 키 목록. src/normalizer/specs.ts의 CATEGORY_SPEC_KEYS와 동기화 유지.
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
```

- [ ] **Step 5: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add admin/lib/
git commit -m "feat: admin shared libs (auth, db, github, specs)"
```

---

## Task 4: 인증 (로그인 페이지 + 미들웨어)

**Files:**
- Create: `admin/app/login/page.tsx`
- Create: `admin/app/login/actions.ts`
- Create: `admin/middleware.ts`

- [ ] **Step 1: `admin/app/login/actions.ts` 생성**

```typescript
"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export async function loginAction(formData: FormData): Promise<never> {
  const password = formData.get("password") as string;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    redirect("/login?error=1");
  }

  const session = await getSession();
  session.user = { isLoggedIn: true };
  await session.save();

  redirect("/");
}
```

- [ ] **Step 2: `admin/app/login/page.tsx` 생성**

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Gear Admin</CardTitle>
        </CardHeader>
        <CardContent>
          {params.error && (
            <p className="text-sm text-red-500 text-center mb-4">
              비밀번호가 올바르지 않습니다.
            </p>
          )}
          <form action={loginAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
                placeholder="관리자 비밀번호 입력"
              />
            </div>
            <Button type="submit" className="w-full">
              로그인
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: `admin/middleware.ts` 생성**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/auth";

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET ?? "fallback-secret-do-not-use-in-prod",
  cookieName: "gear-admin-session",
};

export async function middleware(request: NextRequest) {
  const session = await getIronSession<SessionData>(
    request.cookies,
    SESSION_OPTIONS
  );

  if (!session.user?.isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add admin/app/login/ admin/middleware.ts
git commit -m "feat: admin login page and auth middleware"
```

---

## Task 5: 사이드바 + 대시보드 레이아웃

**Files:**
- Create: `admin/components/sidebar.tsx`
- Create: `admin/app/(dashboard)/layout.tsx`

- [ ] **Step 1: `admin/components/sidebar.tsx` 생성**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "크롤 현황", icon: "🏠" },
  { href: "/products", label: "제품 목록", icon: "📦" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen bg-slate-900 text-slate-100 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-800">
        <span className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Gear Admin
        </span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
              pathname === item.href
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: `admin/app/(dashboard)/layout.tsx` 생성**

```tsx
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 bg-slate-50 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add admin/components/sidebar.tsx admin/app/'(dashboard)'/layout.tsx
git commit -m "feat: sidebar and dashboard layout"
```

---

## Task 6: 크롤 현황 페이지 (서버 컴포넌트 + 잡 테이블)

**Files:**
- Create: `admin/app/(dashboard)/page.tsx`
- Create: `admin/app/(dashboard)/actions.ts`
- Create: `admin/app/(dashboard)/crawl-panel.tsx`

- [ ] **Step 1: `admin/app/(dashboard)/actions.ts` 생성**

```typescript
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
```

- [ ] **Step 2: `admin/app/(dashboard)/crawl-panel.tsx` 생성**

```tsx
"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { triggerCrawlAction, getJobsAction } from "./actions";

type Job = Awaited<ReturnType<typeof getJobsAction>>[number];

function statusBadge(status: string) {
  if (status === "done")
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">완료</Badge>;
  if (status === "running")
    return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">실행중</Badge>;
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">실패</Badge>;
}

function formatDate(d: Date | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function CrawlPanel({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [triggering, setTriggering] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasRunning = jobs.some((j) => j.status === "running");
  const isDisabled = triggering || hasRunning || isPending;

  const refreshJobs = useCallback(async () => {
    const fresh = await getJobsAction();
    setJobs(fresh);
  }, []);

  // 폴링: running 잡이 있을 때만 3초마다
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(refreshJobs, 3000);
    return () => clearInterval(id);
  }, [hasRunning, refreshJobs]);

  async function handleTrigger(workflow: "crawl-weekly.yml" | "crawl-new.yml") {
    setTriggering(true);
    // 10초 후 낙관적 비활성화 해제 (폴링이 먼저 반응하면 자동으로 해제됨)
    const timer = setTimeout(() => setTriggering(false), 10_000);

    startTransition(async () => {
      const result = await triggerCrawlAction(workflow);
      if (!result.ok) {
        clearTimeout(timer);
        setTriggering(false);
        toast.error(`실행 실패: ${result.error}`);
      } else {
        toast.success("워크플로 트리거 완료. 잠시 후 시작됩니다.");
        // 3초 후 한 번 새로고침
        setTimeout(refreshJobs, 3000);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-4">크롤 현황</h1>
        <div className="flex gap-3">
          <Button
            disabled={isDisabled}
            onClick={() => handleTrigger("crawl-weekly.yml")}
          >
            {isDisabled ? "⏳ " : "▶ "}주간 크롤 실행
          </Button>
          <Button
            variant="outline"
            disabled={isDisabled}
            onClick={() => handleTrigger("crawl-new.yml")}
          >
            {isDisabled ? "⏳ " : "▶ "}신제품 감지 실행
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">
          최근 크롤 잡
        </h2>
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>소스</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>시작시간</TableHead>
                <TableHead className="text-right">수집</TableHead>
                <TableHead className="text-right">업데이트</TableHead>
                <TableHead>에러</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                    크롤 잡 없음
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    {job.source?.name ?? "-"}
                  </TableCell>
                  <TableCell>{statusBadge(job.status)}</TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {formatDate(job.startedAt)}
                  </TableCell>
                  <TableCell className="text-right">{job.itemsFound}</TableCell>
                  <TableCell className="text-right">{job.itemsUpdated}</TableCell>
                  <TableCell className="text-sm text-red-500 max-w-xs truncate">
                    {job.error ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `admin/app/(dashboard)/page.tsx` 생성**

```tsx
import { prisma } from "@/lib/db";
import { CrawlPanel } from "./crawl-panel";

export const dynamic = "force-dynamic";

export default async function CrawlPage() {
  const jobs = await prisma.crawlJob.findMany({
    take: 20,
    orderBy: { startedAt: "desc" },
    include: { source: { select: { name: true } } },
  });

  return <CrawlPanel initialJobs={jobs} />;
}
```

- [ ] **Step 4: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add admin/app/'(dashboard)'/
git commit -m "feat: crawl status page with job table and trigger buttons"
```

---

## Task 7: 제품 목록 페이지

**Files:**
- Create: `admin/app/(dashboard)/products/page.tsx`

- [ ] **Step 1: `admin/app/(dashboard)/products/page.tsx` 생성**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    category?: string;
    brand?: string;
    needsReview?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const category = params.category && params.category !== "all" ? params.category : undefined;
  const brand = params.brand?.trim() || undefined;
  const needsReview = params.needsReview === "true" ? true : undefined;

  const where: Prisma.ProductWhereInput = {
    ...(category && { category }),
    ...(brand && { brandEn: { contains: brand, mode: "insensitive" } }),
    ...(needsReview !== undefined && { needsReview }),
  };

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      orderBy: { createdAt: "desc" },
      select: {
        productId: true,
        brandEn: true,
        nameEn: true,
        category: true,
        weight: true,
        salesRegion: true,
        needsReview: true,
      },
    }),
    prisma.product.count({ where }),
    prisma.product.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams({
      ...(params.page && { page: params.page }),
      ...(params.category && { category: params.category }),
      ...(params.brand && { brand: params.brand }),
      ...(params.needsReview && { needsReview: params.needsReview }),
      ...overrides,
    });
    return `/products?${p.toString()}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">제품 목록</h1>

      {/* 필터 */}
      <form method="get" action="/products" className="flex gap-3 flex-wrap">
        <Select name="category" defaultValue={params.category ?? "all"}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="카테고리" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 카테고리</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.category} value={c.category}>
                {c.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          name="brand"
          placeholder="브랜드 검색"
          defaultValue={params.brand ?? ""}
          className="w-48"
        />

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="needsReview"
            value="true"
            defaultChecked={params.needsReview === "true"}
          />
          검토 필요만
        </label>

        <Button type="submit" variant="secondary" size="sm">
          필터 적용
        </Button>

        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/products">초기화</Link>
        </Button>
      </form>

      <p className="text-sm text-slate-500">
        총 {total}개 제품 · {page}/{totalPages} 페이지
      </p>

      {/* 테이블 */}
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>제품명</TableHead>
              <TableHead>카테고리</TableHead>
              <TableHead>무게</TableHead>
              <TableHead>판매지역</TableHead>
              <TableHead>검토</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-400 py-8">
                  제품 없음
                </TableCell>
              </TableRow>
            )}
            {products.map((p) => (
              <TableRow
                key={p.productId}
                className="cursor-pointer hover:bg-slate-50"
              >
                <TableCell>
                  <Link
                    href={`/products/${p.productId}`}
                    className="block w-full h-full font-mono text-xs text-blue-600 hover:underline"
                  >
                    {p.productId}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/products/${p.productId}`} className="block">
                    {p.brandEn}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/products/${p.productId}`} className="block">
                    {p.nameEn}
                  </Link>
                </TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell>{p.weight || "-"}</TableCell>
                <TableCell>{p.salesRegion || "-"}</TableCell>
                <TableCell>
                  {p.needsReview && (
                    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                      검토필요
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={buildUrl({ page: String(page - 1) })}>이전</Link>
            </Button>
          )}
          <span className="flex items-center text-sm text-slate-600 px-2">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={buildUrl({ page: String(page + 1) })}>다음</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add admin/app/'(dashboard)'/products/
git commit -m "feat: products list page with filters and pagination"
```

---

## Task 8: 제품 편집 페이지 + 저장 액션

**Files:**
- Create: `admin/app/(dashboard)/products/[id]/page.tsx`
- Create: `admin/app/(dashboard)/products/[id]/actions.ts`

- [ ] **Step 1: `admin/app/(dashboard)/products/[id]/actions.ts` 생성**

```typescript
"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveProductAction(
  productId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const specs: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("spec_")) {
        specs[key.slice(5)] = String(value);
      }
    }

    await prisma.product.update({
      where: { productId },
      data: {
        brandKr: String(formData.get("brandKr") ?? ""),
        brandEn: String(formData.get("brandEn") ?? ""),
        nameKr: String(formData.get("nameKr") ?? ""),
        nameEn: String(formData.get("nameEn") ?? ""),
        colorKr: String(formData.get("colorKr") ?? ""),
        colorEn: String(formData.get("colorEn") ?? ""),
        sizeKr: String(formData.get("sizeKr") ?? ""),
        sizeEn: String(formData.get("sizeEn") ?? ""),
        weight: String(formData.get("weight") ?? ""),
        salesRegion: String(formData.get("salesRegion") ?? ""),
        needsReview: formData.get("needsReview") === "true",
        ...(Object.keys(specs).length > 0 && { specs }),
      },
    });

    revalidatePath(`/products/${productId}`);
    revalidatePath("/products");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

- [ ] **Step 2: `admin/app/(dashboard)/products/[id]/page.tsx` 생성**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { CATEGORY_SPEC_KEYS } from "@/lib/specs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveProductAction } from "./actions";

const SALES_REGION_OPTIONS = ["국내", "해외", "국내+해외"];

export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { productId: id },
  });

  if (!product) notFound();

  const specKeys = CATEGORY_SPEC_KEYS[product.category] ?? [];
  const currentSpecs = (product.specs as Record<string, string>) ?? {};

  const save = saveProductAction.bind(null, id);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/products">← 목록</Link>
        </Button>
        <h1 className="text-xl font-semibold">
          {product.brandEn} {product.nameEn}
        </h1>
        <span className="text-xs font-mono text-slate-400">{product.productId}</span>
      </div>

      <form action={save} className="space-y-6">
        {/* 기본 정보 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">기본 정보</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>브랜드 (한)</Label>
              <Input name="brandKr" defaultValue={product.brandKr} />
            </div>
            <div className="space-y-2">
              <Label>브랜드 (영)</Label>
              <Input name="brandEn" defaultValue={product.brandEn} />
            </div>
            <div className="space-y-2">
              <Label>제품명 (한)</Label>
              <Input name="nameKr" defaultValue={product.nameKr} />
            </div>
            <div className="space-y-2">
              <Label>제품명 (영)</Label>
              <Input name="nameEn" defaultValue={product.nameEn} />
            </div>
            <div className="space-y-2">
              <Label>컬러 (한)</Label>
              <Input name="colorKr" defaultValue={product.colorKr} />
            </div>
            <div className="space-y-2">
              <Label>컬러 (영)</Label>
              <Input name="colorEn" defaultValue={product.colorEn} />
            </div>
            <div className="space-y-2">
              <Label>사이즈 (한)</Label>
              <Input name="sizeKr" defaultValue={product.sizeKr} />
            </div>
            <div className="space-y-2">
              <Label>사이즈 (영)</Label>
              <Input name="sizeEn" defaultValue={product.sizeEn} />
            </div>
            <div className="space-y-2">
              <Label>무게</Label>
              <Input name="weight" defaultValue={product.weight} placeholder="예: 850g" />
            </div>
            <div className="space-y-2">
              <Label>판매지역</Label>
              <Select
                name="salesRegion"
                defaultValue={
                  SALES_REGION_OPTIONS.includes(product.salesRegion)
                    ? product.salesRegion
                    : ""
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {product.salesRegion &&
                    !SALES_REGION_OPTIONS.includes(product.salesRegion) && (
                      <SelectItem value="">(현재: {product.salesRegion})</SelectItem>
                    )}
                  {SALES_REGION_OPTIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id="needsReview"
                name="needsReview"
                value="true"
                defaultChecked={product.needsReview}
              />
              <Label htmlFor="needsReview" className="cursor-pointer">
                검토 필요
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* 카테고리 스펙 */}
        {specKeys.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                스펙 — {product.category}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              {specKeys.map((key) => (
                <div key={key} className="space-y-2">
                  <Label>{key}</Label>
                  <Input
                    name={`spec_${key}`}
                    defaultValue={currentSpecs[key] ?? ""}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button type="submit">저장</Button>
          <Button variant="outline" type="button" asChild>
            <Link href="/products">취소</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add admin/app/'(dashboard)'/products/
git commit -m "feat: product edit page with spec fields and save action"
```

---

## Task 9: 빌드 확인 + 최종 설정

- [ ] **Step 1: 전체 TypeScript 확인**

```bash
cd admin
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 2: Next.js 빌드 확인**

`.env` 파일 없이 빌드하려면 더미 환경변수 필요:

```bash
cd admin
DATABASE_URL=postgresql://x:x@localhost:5432/x \
DIRECT_URL=postgresql://x:x@localhost:5432/x \
SESSION_SECRET=00000000000000000000000000000000 \
ADMIN_PASSWORD=test \
GITHUB_TOKEN=test \
GITHUB_REPO=owner/repo \
npx next build
```

Expected: 빌드 성공, `force-dynamic` 페이지들은 정상 처리됨

- [ ] **Step 3: `admin/.env.example` 최종 확인**

Vercel 배포 시 설정할 환경변수 목록이 모두 있는지 확인:
- `DATABASE_URL` ✓
- `DIRECT_URL` ✓
- `ADMIN_PASSWORD` ✓
- `SESSION_SECRET` ✓
- `GITHUB_TOKEN` ✓
- `GITHUB_REPO` ✓

- [ ] **Step 4: Vercel 배포 설정 메모 (`admin/README.md`)**

```markdown
# Gear Admin

내부 관리 대시보드.

## Vercel 배포

1. Vercel에서 이 레포 연결
2. **Root Directory**: `admin`
3. **Framework**: Next.js (자동 감지)
4. Environment Variables에 `.env.example`의 모든 변수 입력

## GitHub Actions 트리거 설정

`GITHUB_TOKEN`: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Repository access: 이 레포
- Permissions: Actions (Read and Write)

`GITHUB_REPO`: `your-username/useless-gear-collector`

## 로컬 개발

\`\`\`bash
cd admin
cp .env.example .env  # 값 입력 후
npx prisma generate
npm run dev           # http://localhost:3001
\`\`\`
```

- [ ] **Step 5: Final commit**

```bash
git add admin/
git commit -m "feat: complete admin dashboard"
```
