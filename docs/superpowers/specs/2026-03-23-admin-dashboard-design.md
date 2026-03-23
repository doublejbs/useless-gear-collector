# Admin Dashboard Design

## Goal

백패킹 장비 크롤러의 내부 관리 도구. 크롤 실행/모니터링과 수집된 제품 데이터 편집을 하나의 웹 페이지에서 처리한다.

## Architecture

같은 레포(`useless-gear-collector`)에 `admin/` 디렉토리를 추가한다. Next.js 15 App Router + TypeScript + shadcn/ui로 구성하며, 기존 `prisma/schema.prisma`와 Supabase DB를 그대로 공유한다. Vercel에 배포 (root directory: `admin/`).

크롤 실행은 별도 서버 없이 GitHub Actions REST API의 `workflow_dispatch` 엔드포인트를 호출하는 방식으로 처리한다.

### Directory Structure

```
useless-gear-collector/
├── src/              # 기존 크롤러 (변경 없음)
├── prisma/           # 기존 Prisma 스키마 (변경 없음)
└── admin/            # 신규
    ├── package.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── middleware.ts         # 인증 가드
    ├── app/
    │   ├── layout.tsx
    │   ├── login/
    │   │   └── page.tsx
    │   └── (dashboard)/
    │       ├── layout.tsx            # 사이드바 레이아웃
    │       ├── page.tsx              # 크롤 현황
    │       ├── products/
    │       │   └── page.tsx          # 제품 목록
    │       └── products/[id]/
    │           └── page.tsx          # 제품 편집
    ├── components/
    │   ├── ui/                       # shadcn 컴포넌트
    │   └── sidebar.tsx
    └── lib/
        ├── auth.ts                   # 세션 쿠키 유틸
        ├── db.ts                     # Prisma client (prisma/schema 재사용)
        └── github.ts                 # GitHub Actions API 호출
```

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **UI:** shadcn/ui + Tailwind CSS
- **DB:** Prisma (`@prisma/client`) — 기존 `prisma/schema.prisma` 재사용
- **Auth:** `iron-session` — HttpOnly 세션 쿠키 암호화
- **Deployment:** Vercel (root directory: `admin/`)

## Pages

### `/login`
- 비밀번호 입력 폼
- 서버 액션에서 `ADMIN_PASSWORD` 환경변수와 bcrypt 없이 직접 비교 (내부 툴)
- 성공 시 `iron-session`으로 7일짜리 HttpOnly 쿠키 발급 → `/`로 리다이렉트
- 실패 시 에러 메시지 표시

### `/` — 크롤 현황
- **실행 버튼 2개:**
  - 주간 크롤 (`crawl-weekly.yml`) 실행
  - 신제품 감지 (`crawl-new.yml`) 실행
  - 클릭 시 GitHub Actions API `POST /repos/{repo}/actions/workflows/{id}/dispatches` 호출
  - 실행 중에는 버튼 비활성화 + 스피너
- **최근 크롤 잡 테이블** (`crawl_jobs` 테이블 조회):
  - 컬럼: 소스명, 상태 (running/done/failed 뱃지), 시작시간, 수집 건수, 에러 메시지
  - 최근 20건, 3초마다 자동 폴링 (running 상태인 잡이 있을 때만)
  - shadcn `Badge`로 상태 표시 (done=green, running=blue, failed=red)

### `/products` — 제품 목록
- **필터 (상단):**
  - 카테고리 드롭다운
  - 브랜드 텍스트 검색
  - `needs_review` 토글 필터
- **테이블 컬럼:** 제품ID, 브랜드(영문), 제품명(영문), 카테고리, 무게, 판매지역, needs_review 뱃지
- 행 클릭 시 `/products/[id]`로 이동
- 페이지네이션: 50개씩, shadcn `Pagination`

### `/products/[id]` — 제품 편집
- **기본 정보 폼:**
  - 브랜드 (한/영), 제품명 (한/영), 컬러 (한/영), 사이즈 (한/영)
  - 무게 (문자열), 판매지역 (select: 국내/해외/국내+해외)
  - `needs_review` 체크박스
- **스펙 편집:**
  - 카테고리에 맞는 스펙 키를 `CATEGORY_SPEC_KEYS`에서 읽어 동적으로 폼 렌더링
  - 각 스펙 키별 텍스트 input
- **저장:** Server Action으로 `prisma.product.update` 호출
- **뒤로가기:** `/products`로 이동

## Authentication

- `middleware.ts`에서 모든 `/(dashboard)` 라우트에 대해 세션 쿠키 검증
- 쿠키 없거나 유효하지 않으면 `/login`으로 리다이렉트
- `iron-session` 사용, `SESSION_SECRET` 환경변수로 암호화 키 설정

## GitHub Actions Integration

`admin/lib/github.ts`:
```typescript
export async function triggerWorkflow(workflowFile: string): Promise<void> {
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  const token = process.env.GITHUB_TOKEN;
  await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
}
```

## Environment Variables

| 변수 | 용도 |
|------|------|
| `DATABASE_URL` | Supabase PgBouncer (포트 6543) |
| `DIRECT_URL` | Supabase Direct (포트 5432) |
| `ADMIN_PASSWORD` | 로그인 비밀번호 |
| `SESSION_SECRET` | iron-session 암호화 키 (32자 이상 랜덤 문자열) |
| `GITHUB_TOKEN` | GitHub PAT (workflow 권한) |
| `GITHUB_REPO` | `owner/repo` 형식 |

## Data Flow

1. 사용자 → `/login` → 쿠키 발급
2. `/` → 크롤 실행 버튼 → GitHub API → Actions 워크플로 트리거
3. Actions 워크플로 실행 → `crawl_jobs` 테이블 업데이트
4. 대시보드 `/` → `crawl_jobs` 폴링 → 상태 표시
5. `/products` → Prisma 쿼리 → 제품 테이블
6. `/products/[id]` → 편집 → Server Action → `prisma.product.update`

## Error Handling

- GitHub API 호출 실패: 버튼 옆에 에러 토스트 (shadcn `Toast`)
- DB 쿼리 실패: 페이지 레벨 에러 메시지
- 저장 실패: 폼 내 인라인 에러

## Testing

- 인증 미들웨어: 유닛 테스트 (쿠키 유무에 따른 리다이렉트)
- GitHub API 호출: 모킹 테스트
- 제품 업데이트 Server Action: 통합 테스트 (TEST_DATABASE_URL 필요)
