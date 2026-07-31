"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { getSolutionRuns } from "@/lib/api/solutions";

type Solution = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: string;
  recommended?: boolean;
  recommendReason?: string;
  href: string;
};

type SolutionRun = {
  id: string;
  solutionTitle: string;
  status: "running" | "waiting" | "done";
  progress: string;
};

// 智能推荐：根据用户角色/行业（正式接入时从用户画像 API 读取）
const RECOMMENDED_SOLUTIONS: Solution[] = [
  {
    id: "1",
    title: "私域获客增长包",
    description: "自动找选题、生成内容、分发到各平台，每周持续获客",
    icon: TrendingUp,
    category: "增长",
    recommended: true,
    recommendReason: "适合你的电商运营场景",
    href: "/solutions/configure?package=private-domain-growth",
  },
  {
    id: "2",
    title: "客户互动自动化",
    description: "自动回复评论和私信，把互动客户沉淀为私域好友",
    icon: Users,
    category: "互动",
    recommended: true,
    recommendReason: "你上周有 120 条未回复互动",
    href: "/solutions/configure?package=engagement-automation",
  },
  {
    id: "3",
    title: "短视频批量创作",
    description: "一个主题批量生成多平台短视频，自动适配尺寸和文案",
    icon: Video,
    category: "内容",
    recommended: true,
    recommendReason: "你的同行本月平均发布 24 条视频",
    href: "/solutions/configure?package=video-batch-creation",
  },
];

const ALL_SOLUTIONS: Solution[] = [
  ...RECOMMENDED_SOLUTIONS,
  {
    id: "4",
    title: "账号矩阵管理",
    description: "多平台多账号统一管理，批量检查和运营",
    icon: Users,
    category: "管理",
    href: "/solutions/configure?package=account-matrix",
  },
  {
    id: "5",
    title: "竞品监控分析",
    description: "自动监控竞品动态，每周生成分析报告",
    icon: TrendingUp,
    category: "情报",
    href: "/solutions/configure?package=competitor-monitor",
  },
  {
    id: "6",
    title: "直播带货助手",
    description: "直播预告、弹幕互动、直播后数据分析",
    icon: Video,
    category: "直播",
    href: "/solutions/configure?package=livestream-assistant",
  },
];

// 真实运行记录（来自 getSolutionRuns）
type RealRun = {
  id: string;
  packageName: string;
  status: string;
  progress: number;
  createdAt?: string;
};

export function SolutionsCenter() {
  const [searchQuery, setSearchQuery] = useState("");
  const [runs, setRuns] = useState<RealRun[]>([]);

  // 真实运行记录
  const fetchRuns = useCallback(async () => {
    try {
      const data = await getSolutionRuns();
      setRuns(data.items || []);
    } catch {
      // 无运行记录时静默
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  // 搜索过滤
  const filteredSolutions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ALL_SOLUTIONS;
    return ALL_SOLUTIONS.filter((s) =>
      [s.title, s.description, s.category].join(" ").toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const waitingCount = runs.filter((r) =>
    ["waiting", "paused", "waiting_for_confirmation"].includes(r.status),
  ).length;

  return (
    <div className="kaypal-v2-engine flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              解决方案
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              选一个场景，系统自动帮你干活
            </p>
          </div>
        </div>
      </section>

      {/* 待确认提醒（上下文引导） */}
      {waitingCount > 0 && (
        <section className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-[var(--kaypal-v3-amber)]" />
              <p className="text-sm font-medium text-[var(--kaypal-v3-amber)]">
                有 {waitingCount} 个方案产出的内容等待你确认
              </p>
            </div>
            <Link
              href="/solutions?filter=waiting"
              className="text-sm font-medium text-[var(--kaypal-v3-amber)] underline"
            >
              去确认 →
            </Link>
          </div>
        </section>
      )}

      {/* 为你推荐 */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            为你推荐
          </h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {RECOMMENDED_SOLUTIONS.map((solution) => {
            const Icon = solution.icon;
            return (
              <div
                key={solution.id}
                className="kaypal-v3-panel flex flex-col p-6 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
              >
                <div className="kaypal-v3-icon-tile">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[var(--kaypal-v3-ink)]">
                  {solution.title}
                </h3>
                <p className="mt-2 flex-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {solution.description}
                </p>
                {solution.recommendReason && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-accent-ink)]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {solution.recommendReason}
                  </p>
                )}
                {/* 单一主行动 */}
                <Link
                  href={solution.href}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
                >
                  立即使用
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* 进行中的方案 */}
      {runs.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              📋 进行中的方案
            </h2>
            <Link
              href="/solutions?tab=runs"
              className="text-sm font-medium text-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              查看全部 →
            </Link>
          </div>

          <div className="space-y-3">
            {runs.slice(0, 5).map((run) => {
              const waiting = ["waiting", "paused", "waiting_for_confirmation"].includes(run.status);
              const running = ["running", "queued"].includes(run.status);
              return (
                <div key={run.id} className="kaypal-v3-panel p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {running ? (
                        <Loader2 className="h-5 w-5 animate-spin text-[var(--kaypal-v3-accent-ink)]" />
                      ) : waiting ? (
                        <Clock className="h-5 w-5 text-[var(--kaypal-v3-amber)]" />
                      ) : run.status === "completed" || run.status === "done" ? (
                        <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
                      ) : (
                        <Clock className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                      )}
                      <div>
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {run.packageName}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                          进度 {run.progress}%
                          {run.createdAt ? ` · ${new Date(run.createdAt).toLocaleDateString("zh-CN")}` : ""}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/solutions/run?id=${run.id}`}
                      className={`rounded-[var(--kaypal-v3-radius-sm)] px-4 py-2 text-sm font-medium transition ${
                        waiting
                          ? "bg-[var(--kaypal-v3-accent)] text-white hover:bg-[var(--kaypal-v3-accent-ink)]"
                          : "border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                      }`}
                    >
                      {waiting ? "去确认" : "查看"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 全部方案 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            全部方案
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
            <input
              className="h-10 w-64 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-9 pr-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder="搜索方案"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredSolutions.map((solution) => {
            const Icon = solution.icon;
            return (
              <Link
                key={solution.id}
                href={solution.href}
                className="kaypal-v3-panel group flex items-center gap-4 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
              >
                <div className="kaypal-v3-icon-tile shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                    {solution.title}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
                    {solution.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
              </Link>
            );
          })}
        </div>

        {filteredSolutions.length === 0 && (
          <div className="kaypal-v3-panel p-12 text-center">
            <p className="text-sm text-[var(--kaypal-v3-muted)]">
              没有找到匹配 "{searchQuery}" 的方案
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
