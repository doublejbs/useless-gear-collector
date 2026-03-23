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
