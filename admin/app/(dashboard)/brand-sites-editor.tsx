"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  saveBrandSourceAction,
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
