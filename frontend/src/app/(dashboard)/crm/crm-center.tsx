"use client";

import { SkeletonList, SkeletonRow } from "@/components/skeleton";
import { CountUpNumber } from "@/components/count-up-number";

import { BrandLogo } from "@/components/brand-logo";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  X,
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
  /** 2026-09-03 列表精进:关键词搜索 + 状态筛选 + 前端分页 */
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
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

  /* ---------- 2026-09-03 列表精进：状态筛选 + 搜索 + 前端分页 ---------- */
  const normalizeStatus = (st?: string) =>
    st === "following" ? "follow_up" : st;

  const FILTER_TABS: Array<{ key: string | null; label: string }> = [
    { key: null, label: "全部" },
    { key: "new", label: "新客户" },
    { key: "follow-up", label: "跟进中" },
    { key: "won", label: "已成交" },
    { key: "lost", label: "已流失" },
  ];

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: customers.length,
      new: 0,
      "follow-up": 0,
      won: 0,
      lost: 0,
    };
    for (const cu of customers) {
      const st = normalizeStatus(cu.status);
      if (st === "new") c.new += 1;
      else if (st === "follow_up") c["follow-up"] += 1;
      else if (st === "won") c.won += 1;
      else if (st === "lost") c.lost += 1;
    }
    return c;
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return customers
      .filter((cu) => {
        const st = normalizeStatus(cu.status);
        const statusMatch =
          !activeFilter ||
          (activeFilter === "follow-up"
            ? st === "follow_up"
            : st === activeFilter);
        if (!statusMatch) return false;
        if (!kw) return true;
        const hay = [
          cu.displayName,
          cu.companyName,
          cu.phone,
          cu.wechat,
          cu.email,
          cu.title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(kw);
      })
      .sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
      );
  }, [customers, query, activeFilter]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredCustomers.length / PAGE_SIZE),
  );
  const visibleCustomers = filteredCustomers.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const changeFilter = (key: string | null) => {
    setActiveFilter(key);
    setPage(1);
    // 与地址栏同步，便于返回/分享当前筛选视图
    const url = new URL(window.location.href);
    if (key === "follow-up") url.searchParams.set("filter", "follow-up");
    else url.searchParams.delete("filter");
    window.history.replaceState(null, "", url.toString());
  };

  const changeQuery = (v: string) => {
    setQuery(v);
    setPage(1);
  };

  const customerInitial = (name: string) =>
    (name || "?").trim().charAt(0).toUpperCase();

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
              <p className="mx-section-eyebrow">
                {loading
                  ? "加载中…"
                  : activeFilter
                    ? FILTER_TABS.find((t) => t.key === activeFilter)?.label
                    : "全部客户"}{" "}
                · {filteredCustomers.length} 位
              </p>
            </div>
          </div>

          {customers.length > 0 ? (
            <>
              {/* 筛选 chips */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  overflowX: "auto",
                  marginTop: 10,
                  paddingBottom: 4,
                }}
              >
                {FILTER_TABS.map((tab) => {
                  const active = activeFilter === tab.key;
                  return (
                    <button
                      key={tab.key ?? "all"}
                      type="button"
                      onClick={() => changeFilter(tab.key)}
                      style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: "none",
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        background: active
                          ? "var(--kaypal-v3-accent)"
                          : "rgba(233,240,250,.75)",
                        color: active
                          ? "#fff"
                          : "var(--kaypal-v3-soft-ink)",
                      }}
                    >
                      {tab.label}
                      <span style={{ opacity: 0.75, fontSize: 10 }}>
                        {statusCounts[tab.key ?? "all"]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* 搜索 */}
              <div
                style={{
                  position: "relative",
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Search
                  width={15}
                  height={15}
                  style={{ position: "absolute", left: 12, color: "var(--kaypal-v3-muted)" }}
                />
                <input
                  value={query}
                  onChange={(e) => changeQuery(e.target.value)}
                  placeholder="搜索姓名 / 公司 / 手机…"
                  aria-label="搜索客户"
                  style={{
                    width: "100%",
                    padding: "9px 12px 9px 34px",
                    borderRadius: 10,
                    border: "1px solid var(--kaypal-v3-border)",
                    background: "#fff",
                    fontSize: 13,
                    color: "var(--kaypal-v3-ink)",
                    outline: "none",
                  }}
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => changeQuery("")}
                    style={{
                      position: "absolute",
                      right: 8,
                      padding: 4,
                      border: "none",
                      background: "none",
                      color: "var(--kaypal-v3-muted)",
                    }}
                  >
                    <X width={14} height={14} />
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="mx-card mx-list-card" style={{ marginTop: customers.length > 0 ? 10 : 0 }}>
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
            ) : filteredCustomers.length === 0 ? (
              <div className="mx-empty">
                <p>没有找到匹配的客户</p>
                <button
                  type="button"
                  style={{
                    marginTop: 12,
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--kaypal-v3-border)",
                    background: "#fff",
                    fontSize: 13,
                    color: "var(--kaypal-v3-soft-ink)",
                  }}
                  onClick={() => {
                    setActiveFilter(null);
                    setQuery("");
                    setPage(1);
                  }}
                >
                  清除筛选条件
                </button>
              </div>
            ) : (
              filteredCustomers.map((customer) => (
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
            onClick: () => changeFilter(null),
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
            onClick: () => changeFilter("follow-up"),
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
            brand: "userPlus",
            title: "新增客户",
            description: "手动添加一个客户",
            icon: UserRoundPlus,
            onClick: () => setShowCreateModal(true),
          },
          {
            key: "import",
            brand: "importTray",
            title: "批量导入",
            description: "从 Excel 批量导入",
            icon: Upload,
            href: "/crm-import",
          },
          {
            key: "follow-up",
            brand: "followUp",
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
        {/* 面板头：标题 + 导出 */}
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
              客户列表
            </h2>
            <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
              {loading
                ? "加载中..."
                : customers.length === 0
                  ? "还没有客户档案"
                  : activeFilter
                    ? FILTER_TABS.find((t) => t.key === activeFilter)?.label
                    : "全部客户"}{" "}
              · {filteredCustomers.length} 位
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-xs font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading || filteredCustomers.length === 0}
              onClick={() => {
                const rows = [
                  ["姓名/昵称", "公司", "手机号", "微信号", "状态"],
                  ...filteredCustomers.map((c) => [
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
              导出 CSV（当前 {filteredCustomers.length} 位）
            </button>
          </div>
        </div>

        {/* 工具条：状态筛选 + 搜索 */}
        {customers.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]/50 px-6 py-3">
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="按客户状态筛选">
              {FILTER_TABS.map((tab) => {
                const active = activeFilter === tab.key;
                return (
                  <button
                    key={tab.key ?? "all"}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => changeFilter(tab.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-[var(--kaypal-v3-accent)] text-white shadow-sm"
                        : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper)] hover:text-[var(--kaypal-v3-accent-ink)]"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-semibold ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)]"
                      }`}
                    >
                      {statusCounts[tab.key ?? "all"]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative min-w-[220px] max-w-[300px] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
              <input
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                placeholder="搜索姓名 / 公司 / 手机 / 微信…"
                aria-label="搜索客户"
                className="w-full rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] py-2 pl-9 pr-8 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-2 focus:ring-[var(--kaypal-v3-accent-tint)]"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => changeQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : customers.length === 0 ? (
          /* 全局空态：引导新增 / 导入 / 连接 */
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
              <UserRound className="h-8 w-8 text-[var(--kaypal-v3-accent-ink)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              还没有客户
            </h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              新增一个客户，或从 Excel 批量导入
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                className="inline-flex items-center justify-center h-11 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-sm font-semibold text-white transition hover:brightness-105"
                onClick={() => setShowCreateModal(true)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="h-4 w-4" /> 新增客户
                </span>
              </button>
              <button
                type="button"
                className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => router.push("/crm-import")}
              >
                批量导入
              </button>
            </div>
            {/* 快速开始：三步引导 */}
            <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                {
                  title: "1 · 添加客户",
                  desc: "手动录入或从 Excel 导入档案",
                  icon: <UserPlus className="h-4 w-4" />,
                  onClick: () => setShowCreateModal(true),
                  primary: true,
                },
                {
                  title: "2 · 连接数据",
                  desc: "接入获客任务，线索自动入库",
                  href: "/crm/connectors",
                  icon: <Link className="h-4 w-4" />,
                },
                {
                  title: "3 · 跟进转化",
                  desc: "录入待跟进客户，逐条推进商机",
                  href: "/crm?filter=follow-up",
                  icon: <Phone className="h-4 w-4" />,
                },
              ].map((step) => {
                const cls =
                  "group flex items-start gap-3 rounded-[var(--kaypal-v3-radius)] border border-dashed p-4 text-left transition " +
                  (step.primary
                    ? "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)]/50 hover:bg-[var(--kaypal-v3-accent-soft)]"
                    : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-accent)]");
                const inner = (
                  <>
                    <span
                      className={
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] " +
                        (step.primary
                          ? "bg-[var(--kaypal-v3-accent)] text-white"
                          : "bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]")
                      }
                    >
                      {step.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--kaypal-v3-muted)]">
                        {step.desc}
                      </span>
                    </span>
                  </>
                );
                return step.href ? (
                  <button
                    key={step.title}
                    type="button"
                    className={cls}
                    onClick={() => router.push(step.href!)}
                  >
                    {inner}
                  </button>
                ) : (
                  <button key={step.title} type="button" className={cls} onClick={step.onClick}>
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        ) : filteredCustomers.length === 0 ? (
          /* 空结果：搜索/筛选无命中 */
          <div className="px-6 py-14 text-center">
            <Search className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]" />
            <h3 className="mt-3 text-base font-semibold text-[var(--kaypal-v3-ink)]">
              没有找到匹配的客户
            </h3>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {query
                ? `没有客户符合「${query}」`
                : "该状态下还没有客户"}
            </p>
            <button
              type="button"
              className="mt-5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
              onClick={() => {
                setActiveFilter(null);
                setQuery("");
                setPage(1);
              }}
            >
              清除筛选条件
            </button>
          </div>
        ) : (
          <>
            {/* 表格化列表 */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[var(--kaypal-v3-border)] text-xs font-medium text-[var(--kaypal-v3-muted)]">
                    <th className="px-6 py-3 font-medium">客户</th>
                    <th className="px-3 py-3 font-medium">联系方式</th>
                    <th className="px-3 py-3 font-medium">公司 / 职位</th>
                    <th className="px-3 py-3 font-medium">任务 / 记录</th>
                    <th className="px-3 py-3 font-medium">状态</th>
                    <th className="w-12 px-3 py-3" aria-label="打开" />
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((customer) => {
                    const status = STATUS_LABELS[customer.status] || {
                      label: customer.status,
                      tone: "muted" as const,
                    };
                    const meta = [
                      customer.phone && (
                        <span
                          key="p"
                          className="inline-flex items-center gap-1"
                        >
                          <Phone className="h-3 w-3" />
                          {customer.phone}
                        </span>
                      ),
                      customer.wechat && (
                        <span
                          key="w"
                          className="inline-flex items-center gap-1"
                        >
                          <MessageSquareText className="h-3 w-3" />
                          {customer.wechat}
                        </span>
                      ),
                      customer.email && (
                        <span key="e" className="inline-flex items-center gap-1">
                          {customer.email}
                        </span>
                      ),
                    ]
                      .filter(Boolean)
                      .slice(0, 2);
                    return (
                      <tr
                        key={customer.id}
                        onClick={() =>
                          router.push(`/crm/customer?id=${customer.id}`)
                        }
                        className="cursor-pointer border-b border-[var(--kaypal-v3-border)]/60 transition last:border-b-0 hover:bg-[var(--kaypal-v3-paper-soft)]"
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)] text-sm font-semibold text-[var(--kaypal-v3-accent-ink)]">
                              {customerInitial(customer.displayName)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                                {customer.displayName}
                              </p>
                              {customer.title ? (
                                <p className="truncate text-xs text-[var(--kaypal-v3-muted)]">
                                  {customer.title}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          {meta.length ? (
                            <div className="flex flex-col gap-1 text-xs text-[var(--kaypal-v3-soft-ink)]">
                              {meta}
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--kaypal-v3-muted)]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {customer.companyName ? (
                            <div className="flex items-center gap-1.5 text-sm text-[var(--kaypal-v3-soft-ink)]">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--kaypal-v3-muted)]" />
                              <span className="truncate">
                                {customer.companyName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--kaypal-v3-muted)]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="text-xs text-[var(--kaypal-v3-muted)]">
                            {customer.taskCount > 0
                              ? `${customer.taskCount} 个任务`
                              : "无任务"}
                            {customer.noteCount > 0
                              ? ` · ${customer.noteCount} 条记录`
                              : ""}
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <V2StatusChip tone={status.tone}>
                            {status.label}
                          </V2StatusChip>
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <ChevronRight className="ml-auto h-4 w-4 text-[var(--kaypal-v3-muted)]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--kaypal-v3-border)] px-6 py-3 text-xs text-[var(--kaypal-v3-muted)]">
                <span>
                  共 {filteredCustomers.length} 位 · 第 {page} / {pageCount} 页
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((pg) => Math.max(1, pg - 1))}
                    className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() => setPage((pg) => Math.min(pageCount, pg + 1))}
                    className="rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            ) : null}
          </>
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
