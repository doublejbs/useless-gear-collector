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

  const boundSave = saveProductAction.bind(null, id);
  async function save(formData: FormData): Promise<void> {
    "use server";
    await boundSave(formData);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/products" className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted h-7">← 목록</Link>
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
          <Link href="/products" className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted h-8">취소</Link>
        </div>
      </form>
    </div>
  );
}
