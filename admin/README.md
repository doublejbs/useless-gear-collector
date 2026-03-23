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

```bash
cd admin
cp .env.example .env  # 값 입력 후
npx prisma generate
npm run dev           # http://localhost:3001
```
