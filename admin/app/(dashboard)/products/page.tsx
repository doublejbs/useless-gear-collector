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

  const where = {
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
            {categories.map((c: { category: string }) => (
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

        <Link href="/products">
          <Button type="button" variant="ghost" size="sm">
            초기화
          </Button>
        </Link>
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
            {products.map((p: typeof products[0]) => (
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
            <Link href={buildUrl({ page: String(page - 1) })}>
              <Button variant="outline" size="sm">
                이전
              </Button>
            </Link>
          )}
          <span className="flex items-center text-sm text-slate-600 px-2">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildUrl({ page: String(page + 1) })}>
              <Button variant="outline" size="sm">
                다음
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
