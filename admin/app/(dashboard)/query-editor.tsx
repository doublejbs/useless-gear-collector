"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { saveQueriesAction } from "./actions";

export function QueryEditor({ initialQueries }: { initialQueries: string[] }) {
  const [queries, setQueries] = useState<string[]>(initialQueries);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function addQuery() {
    const q = input.trim();
    if (!q || queries.includes(q)) return;
    setQueries([...queries, q]);
    setInput("");
  }

  function removeQuery(q: string) {
    setQueries(queries.filter((x) => x !== q));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveQueriesAction(queries);
      if (result.ok) {
        toast.success("검색어 저장 완료");
      } else {
        toast.error(`저장 실패: ${result.error}`);
      }
    });
  }

  const hasChanges =
    JSON.stringify(queries) !== JSON.stringify(initialQueries);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
        크롤 검색어
      </h2>
      <div className="flex flex-wrap gap-2">
        {queries.map((q) => (
          <Badge
            key={q}
            className="bg-slate-100 text-slate-700 hover:bg-slate-200 gap-1 cursor-default"
          >
            {q}
            <button
              onClick={() => removeQuery(q)}
              className="ml-1 text-slate-400 hover:text-red-500"
            >
              ×
            </button>
          </Badge>
        ))}
        {queries.length === 0 && (
          <span className="text-sm text-slate-400">검색어 없음</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addQuery())}
          placeholder="검색어 입력 후 Enter"
          className="w-64"
        />
        <Button variant="outline" onClick={addQuery} disabled={!input.trim()}>
          추가
        </Button>
        {hasChanges && (
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "저장중..." : "저장"}
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-400">
        검색어당 최대 1,000개 제품 수집 · 총 {queries.length}개 검색어
      </p>
    </div>
  );
}
