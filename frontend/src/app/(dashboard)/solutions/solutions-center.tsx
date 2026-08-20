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
import {
  getSolutionPackages,
  getSolutionRuns,
  type SolutionPackageDefinition,
} from "@/lib/api/solutions";
import { useIsMobile } from "@/lib/hooks/use-media-query";

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

// 根据方案名/code 关键词匹配图标
function pickIcon(p: SolutionPackageDefinition): LucideIcon {
  if (/热点|爆款|选题|趋势|出海/.test(p.name)) return TrendingUp;
  if (/评论|互动|获客|线索|达人/.test(p.name)) return Users;
  if (/视频|直播|剪辑/.test(p.name)) return Video;
  if (/素材|AIGC|工厂|文案|内容/.test(p.name)) return Sparkles;
  return Sparkles;
}

// 后端方案包 → 前端展示项
function toSolution(p: SolutionPackageDefinition): Solution {
  return {
    id: p.code,
    title: p.name,
    description: p.summary,
    icon: pickIcon(p),
    category: p.category === "core" ? "核心" : "RedFox 池",
    href: `/solutions/configure?package=${p.code}`,
  };
}

// 真实运行记录（来自 getSolutionRuns）
type RealRun = {
  id: string;
  packageName: string;
  status: string;
  progress: number;
  createdAt?: string;
};

export function SolutionsCenter() {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [runs, setRuns] = useState<RealRun[]>([]);
  const [packages, setPackages] = useState<SolutionPackageDefinition[]>([]);

  // 真实运行记录
  const fetchRuns = useCallback(async () => {
    try {
      const data = await getSolutionRuns();
      setRuns(data.items || []);
    } catch {
      // 无运行记录时静默
    }
  }, []);

  // 方案包（后端目录，28 个真实方案）
  const fetchPackages = useCallback(async () => {
    try {
      const data = await getSolutionPackages();
      setPackages(data.items || []);
    } catch {
      // 后端不可用时保持空列表
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
    void fetchPackages();
  }, [fetchRuns, fetchPackages]);

  // 方案列表（后端驱动）；已接入的作为「为你推荐」，其余进全部方案
  const allSolutions = useMemo(() => packages.map(toSolution), [packages]);
  const connectedCodes = packages
    .filter((p) => p.implementationState === "connected")
    .map((p) => p.code);
  const recommendedSolutions =
    connectedCodes.length > 0
      ? allSolutions.filter((s) => connectedCodes.includes(s.id))
      : allSolutions
          .filter((s) => packages.find((p) => p.code === s.id)?.category === "core")
          .slice(0, 2);

  // 搜索过滤（推荐项 + 全部方案都参与搜索）
  const filteredSolutions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSolutions;
    return allSolutions.filter((s) =>
      [s.title, s.description, s.category].join(" ").toLowerCase().includes(q),
    );
  }, [searchQuery, allSolutions]);

  const waitingCount = runs.filter((r) =>
    ["waiting", "paused", "waiting_for_confirmation"].includes(r.status),
  ).length;

  /* 移动端原生视图（mx-* 明德 VP 风格）——转 2 页（solutions + solutions-v2） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">解决方案</div>
            <div className="mx-page-sub">选一个场景，系统自动帮你干活</div>
          </div>

          {waitingCount > 0 && (
            <div className="mx-card" style={{ marginTop: 12, padding: 12, borderColor: "rgba(222,150,57,.45)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#b45309", fontWeight: 600 }}>
                <Clock width={15} height={15} />
                {waitingCount} 个方案内容待你确认
              </span>
              <Link href="/solutions?filter=waiting" style={{ fontSize: 12, fontWeight: 700, color: "#d98a2d" }}>去确认 ›</Link>
            </div>
          )}

          {/* 为你推荐 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>为你推荐</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recommendedSolutions.map((solution) => {
              const Icon = solution.icon;
              return (
                <div key={solution.id} className="mx-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span style={{ width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.15)", color: "#d98a2d", flexShrink: 0 }}>
                      <Icon width={19} height={19} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)" }}>{solution.title}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 2, lineHeight: 1.45 }}>{solution.description}</span>
                    </span>
                  </div>
                  {solution.recommendReason && (
                    <p style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#d98a2d", marginTop: 8 }}>
                      <CheckCircle2 width={12} height={12} />
                      {solution.recommendReason}
                    </p>
                  )}
                  <Link href={solution.href} className="mx-btn-gold" style={{ marginTop: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    立即使用 <ArrowRight width={14} height={14} />
                  </Link>
                </div>
              );
            })}
          </div>

          {/* 进行中 */}
          {runs.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>进行中的方案</span>
                <Link href="/solutions?tab=runs" style={{ fontSize: 11.5, fontWeight: 600, color: "#d98a2d" }}>查看全部 ›</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {runs.slice(0, 5).map((run) => {
                  const waiting = ["waiting", "paused", "waiting_for_confirmation"].includes(run.status);
                  const running = ["running", "queued"].includes(run.status);
                  return (
                    <div key={run.id} className="mx-card" style={{ padding: 13 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          {running ? (
                            <Loader2 width={16} height={16} className="animate-spin" style={{ color: "#d98a2d", flexShrink: 0 }} />
                          ) : waiting ? (
                            <Clock width={16} height={16} style={{ color: "#b45309", flexShrink: 0 }} />
                          ) : run.status === "completed" || run.status === "done" ? (
                            <CheckCircle2 width={16} height={16} style={{ color: "#059669", flexShrink: 0 }} />
                          ) : (
                            <Clock width={16} height={16} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.packageName}</span>
                            <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1 }}>
                              进度 {run.progress}%{run.createdAt ? ` · ${new Date(run.createdAt).toLocaleDateString("zh-CN")}` : ""}
                            </span>
                          </span>
                        </span>
                        <Link
                          href={`/solutions/run?id=${run.id}`}
                          style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 9, fontSize: 11.5, fontWeight: 600, background: waiting ? "#d98a2d" : "rgba(120,148,179,.12)", color: waiting ? "#fff" : "var(--mx-ink)", border: waiting ? "1px solid #d98a2d" : "1px solid rgba(142,165,190,.3)" }}
                        >
                          {waiting ? "去确认" : "查看"}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 全部方案 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>全部方案</div>
          <div style={{ position: "relative", marginTop: 8 }}>
            <Search width={15} height={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--mx-muted)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索方案"
              style={{ width: "100%", padding: "9px 11px 9px 34px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
            {filteredSolutions.map((solution) => {
              const Icon = solution.icon;
              return (
                <Link key={solution.id} href={solution.href} className="mx-card" style={{ padding: 13, display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "#d98a2d", flexShrink: 0 }}>
                    <Icon width={17} height={17} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{solution.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{solution.description}</span>
                  </span>
                  <ArrowRight width={15} height={15} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                </Link>
              );
            })}
          </div>
          {filteredSolutions.length === 0 && (
            <div className="mx-card mx-empty" style={{ marginTop: 10, padding: 24, textAlign: "center" }}>
              <p style={{ fontSize: 12.5, color: "var(--mx-muted)" }}>没有找到匹配 "{searchQuery}" 的方案</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kx-view kaypal-v2-engine flex flex-col gap-6">
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
          {recommendedSolutions.map((solution) => {
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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              className="h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-9 pr-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)] sm:w-64"
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
                className="kaypal-v3-panel group flex min-w-0 items-center gap-4 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
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
