"use client";

import { SkeletonList, SkeletonRow } from "@/components/skeleton";
import { CountUpNumber } from "@/components/count-up-number";

import { BrandLogo } from "@/components/brand-logo";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  ChevronRight,
  Download,
  Link,
  MessageSquareText,
  Phone,
  Plus,
  Search,
  Upload,
  User,
  UserPlus,
  UserRound,
  UserRoundPlus,
  Users,
} from "@/components/iconpark";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { V2StatusChip } from "@/components/v2/ui-kit";
import { CrmCustomerFormModal } from "@/components/v2/crm-customer-form";
import { listCrmCustomers, getCrmSummary, type CrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { V2BackButton } from "@/components/v2/v2-back-button";

function isThisWeek(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  return d >= weekAgo;
}

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "accent" | "muted" }> = {
  new: { label: "新客户", tone: "accent" },
  follow_up: { label: "跟进中", tone: "warning" },
  following: { label: "跟进中", tone: "warning" },
  won: { label: "已成交", tone: "success" },
  lost: { label: "已流失", tone: "muted" },
};

export function CrmCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  // ?action=new 进入时自动打开「新增客户」弹窗；?filter=follow-up 进入时过滤待跟进客户
  useEffect(() => {
    if (searchParams.get("action") === "new") setShowCreateModal(true);
    const filter = searchParams.get("filter");
    setActiveFilter(filter === "follow-up" ? "follow-up" : null);
  }, [searchParams]);
  const [stats, setStats] = useState({
    total: 0,
    newThisWeek: 0,
    followUp: 0,
    overdue: 0,
    pipelineYuan: 0,
  });
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [list, summary] = await Promise.allSettled([
        listCrmCustomers(),
        getCrmSummary(),
      ]);
      const customers =
        list.status === "fulfilled" && Array.isArray(list.value) ? list.value : [];
      setCustomers(customers);
      const newThisWeek = customers.filter((c) =>
        isThisWeek((c as { createdAt?: string }).createdAt),
      ).length;
      const followUp = customers.filter(
        (c) => (c as { status?: string }).status === "follow_up" || (c as { status?: string }).status === "following",
      ).length;
      const summaryData = summary.status === "fulfilled" ? summary.value : null;
      setStats({
        total: summaryData?.totalCustomers ?? customers.length,
        newThisWeek,
        followUp,
        overdue: summaryData?.overdueTasks ?? 0,
        pipelineYuan: Math.round((summaryData?.pipelineAmountCents ?? 0) / 100),
      });
      // 2026-09-01 Codex 复核回改（同类自查）：allSettled 的 rejected 不进 catch，
      // 客户列表/统计失败会被降成 0 还无条件清错 = 假成功，须检查 rejected
      const rejected = [list, summary].filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (rejected.length > 0) {
        for (const r of rejected) console.error(r.reason);
        reportLoadError(
          rejected[0].reason,
          rejected.length === 2
            ? "客户数据暂时无法读取"
            : "客户部分数据暂时无法读取，统计可能不准确",
        );
      } else {
        clearLoadError();
      }
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载客户统计失败"));
      reportLoadError(error, "客户数据暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state */
  const isMobile = useIsMobile();
  if (isMobile) {
    const statusBadge = (status: string) => {
      const tone = STATUS_LABELS[status]?.tone || "muted";
      return tone === "success" ? "mx-badge mx-badge-green"
        : tone === "warning" ? "mx-badge mx-badge-gold"
          : "mx-badge";
    };
    return (
      <>
        <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <BrandLogo />
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">客户管理</h1>
              <p className="mx-page-sub">管理你的客户档案，跟进每一个商机</p>
            </div>
            <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => setShowCreateModal(true)}>
              <Plus width={13} height={13} />
              新增
            </button>
          </div>
        </header>

        {/* 统计 */}
        <section className="mx-px" style={{ marginTop: 14 }}>
          <div className="mx-stat-grid">
            <div className="mx-stat-item mx-control"><div className="mx-stat-num"><CountUpNumber value={stats.total} loading={loading} /></div><div className="mx-stat-label">客户总数</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text"><CountUpNumber value={stats.newThisWeek} loading={loading} /></div><div className="mx-stat-label">本周新增</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: "var(--kaypal-v3-amber)" }}><CountUpNumber value={stats.followUp} loading={loading} /></div><div className="mx-stat-label">待跟进</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: "var(--kaypal-v3-danger)" }}><CountUpNumber value={stats.overdue} loading={loading} /></div><div className="mx-stat-label">逾期任务</div></div>
          </div>
        </section>

        {/* 快捷入口 */}
        <section className="mx-px mx-mt-lg">
          <div className="mx-svc-grid">
            <button type="button" className="mx-svc-item mx-control" onClick={() => setShowCreateModal(true)}>
              <span className="mx-svc-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}>
                <UserPlus width={19} height={19} />
              </span>
              <span className="mx-svc-name">新增客户</span><span className="mx-svc-sub">手动添加</span>
            </button>
            <button type="button" className="mx-svc-item mx-control" onClick={() => router.push("/crm-import")}>
              <span className="mx-svc-ic" style={{ background: "rgba(16,185,129,.1)", color: "var(--kaypal-v3-success)" }}>
                <Upload width={19} height={19} />
              </span>
              <span className="mx-svc-name">批量导入</span><span className="mx-svc-sub">Excel 导入</span>
            </button>
            <button type="button" className="mx-svc-item mx-control" onClick={() => router.push("/crm?filter=follow-up")}>
              <span className="mx-svc-ic" style={{ background: "rgba(234,161,75,.14)", color: "#c87922" }}>
                <Search width={19} height={19} />
              </span>
              <span className="mx-svc-name">待跟进</span><span className="mx-svc-sub">{stats.followUp} 位客户</span>
            </button>
            <button type="button" className="mx-svc-item mx-control" onClick={() => router.push("/crm/connectors")}>
              <span className="mx-svc-ic" style={{ background: "rgba(139,92,246,.1)", color: "var(--kaypal-v3-purple)" }}>
                <Link width={19} height={19} />
              </span>
              <span className="mx-svc-name">数据连接</span><span className="mx-svc-sub">渠道接入</span>
            </button>
          </div>
        </section>

        {/* 客户列表 */}
        <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
          <div className="mx-section-head">
            <div>
              <div className="mx-section-title">
                <span className="mx-sec-icon"><Users /></span>
                客户列表
              </div>
              <p className="mx-section-eyebrow">{loading ? "加载中…" : `共 ${stats.total} 位客户`}</p>
            </div>
          </div>
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <SkeletonRow width="70%" />
                <SkeletonRow width="58%" />
              </div>
            ) : customers.length === 0 ? (
              <div className="mx-empty">
                <p>还没有客户，先添加一个</p>
                <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => setShowCreateModal(true)}>新增客户</button>
              </div>
            ) : (
              customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                  onClick={() => router.push(`/crm/customer?id=${customer.id}`)}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                    <User width={18} height={18} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{customer.displayName}</div>
                    <div className="mx-row-desc">
                      {customer.companyName ? customer.companyName : ""}
                      {customer.phone ? ` · ${customer.phone}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    <span className={statusBadge(customer.status)}>{STATUS_LABELS[customer.status]?.label || customer.status}</span>
                    <ChevronRight width={15} height={15} style={{ color: "#b9c5d4" }} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
        </div>
        <CrmCustomerFormModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => void fetchData()}
        />
      </>
    );
  }

  return (
    <div className="kx-view flex flex-col gap-6">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchData()} />
      ) : null}
      <WorkbenchCenter
        title="客户管理"
        backHref="/crm"
        subtitle="管理你的客户档案，跟进每一个商机"
        icon={Users}
        stats={[
          {
            label: "客户总数",
            value: loading ? "-" : stats.total,
            tone: "accent",
          },
          {
            label: "本周新增",
            value: loading ? "-" : stats.newThisWeek,
            tone: stats.newThisWeek > 0 ? "success" : "default",
          },
          {
            label: "待跟进",
            value: loading ? "-" : stats.followUp,
            tone: stats.followUp > 0 ? "warning" : "default",
          },
          {
            label: "逾期任务",
            value: loading ? "-" : stats.overdue,
            tone: stats.overdue > 0 ? "danger" : "default",
          },
        ]}
        primaryAction={{
          label: "新增客户",
          onClick: () => setShowCreateModal(true),
        }}
        quickActions={[
          {
            key: "new",
            title: "新增客户",
            description: "手动添加一个客户",
            icon: UserRoundPlus,
            onClick: () => setShowCreateModal(true),
          },
          {
            key: "import",
            title: "批量导入",
            description: "从 Excel 批量导入",
            icon: Upload,
            href: "/crm-import",
          },
          {
            key: "follow-up",
            title: "待跟进",
            description: "需要跟进的客户",
            icon: Search,
            href: "/crm?filter=follow-up",
            badge: stats.followUp > 0 ? String(stats.followUp) : undefined,
          },
        ]}
        advancedLinks={[
          { key: "connectors", title: "数据连接", icon: Users, href: "/crm/connectors" },
        ]}
      />

      {/* 客户列表 */}
      <section className="kaypal-v3-panel">
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            客户列表
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-xs font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading || customers.length === 0}
              onClick={() => {
                const rows = [
                  ["姓名/昵称", "公司", "手机号", "微信号", "状态"],
                  ...customers.map((c) => [
                    c.displayName,
                    c.companyName ?? "",
                    c.phone ?? "",
                    c.wechat ?? "",
                    STATUS_LABELS[c.status]?.label ?? c.status,
                  ]),
                ];
                const csv = rows
                  .map((r) =>
                    r
                      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                      .join(","),
                  )
                  .join("\n");
                const blob = new Blob(["\uFEFF" + csv], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `crm-customers-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </button>
            <span className="text-sm text-[var(--kaypal-v3-muted)]">
              {loading ? "加载中..." : `共 ${customers.length} 个`}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
              <UserRound className="h-8 w-8 text-[var(--kaypal-v3-accent-ink)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              还没有客户
            </h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              新增一个客户，或者从 Excel 批量导入
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
                onClick={() => setShowCreateModal(true)}
              >
                新增客户
              </button>
              <button
                type="button"
                className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => router.push("/crm-import")}
              >
                批量导入
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {(activeFilter === "follow-up"
              ? customers.filter(
                  (c) => c.status === "follow_up" || c.status === "following",
                )
              : customers
            ).map((customer) => {
              const status = STATUS_LABELS[customer.status] || {
                label: customer.status,
                tone: "muted" as const,
              };
              return (
                <button
                  key={customer.id}
                  type="button"
                  className="flex w-full items-center justify-between p-5 text-left transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                  onClick={() => router.push(`/crm/customer?id=${customer.id}`)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                      <UserRound className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {customer.displayName}
                        </p>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                      </div>
                      <p className="mt-0.5 flex items-center gap-3 text-sm text-[var(--kaypal-v3-muted)]">
                        {customer.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {customer.phone}
                          </span>
                        )}
                        {customer.wechat && (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquareText className="h-3.5 w-3.5" />
                            {customer.wechat}
                          </span>
                        )}
                        {customer.companyName && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" />
                            {customer.companyName}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-[var(--kaypal-v3-muted)]">→</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <CrmCustomerFormModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => void fetchData()}
      />
    </div>
  );
}
