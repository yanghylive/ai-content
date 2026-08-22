"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addToast } from "@heroui/react";
import { ArrowDown, ArrowUp, Check, ClipboardList, Heart, Home, Loader2, Plus, ShieldAlert, Star, Trash2 } from "lucide-react";
import {
  caseAdminApi,
  type AdminCase,
  type AuditEntry,
  type ContentHealthOverview,
  type FeaturedCase,
} from "@/lib/api/case-admin";
import { ApiError } from "@/lib/api/client";
import { authApi } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/admin-user";
import { V2BackButton } from "@/components/v2/v2-back-button";
import {OpsButton,
  OpsDenseTable,
  OpsDesktopPage,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsTabs
} from "../components/desktop-ops-ui";

const PROVENANCE_LABEL: Record<string, string> = {
  delivery: "九章交付",
  open_source: "开源演示",
  prototype: "概念原型",
  template: "可定制模板",
};

const STATUS_META: Record<string, { label: string; tone: "default" | "success" | "warning" | "danger" | "brand" }> = {
  draft: { label: "草稿", tone: "default" },
  submitted: { label: "待审核", tone: "warning" },
  approved: { label: "已批准", tone: "brand" },
  published: { label: "已发布", tone: "success" },
  unpublished: { label: "已下线", tone: "danger" },
  archived: { label: "已归档", tone: "default" },
};

const HEALTH_META: Record<string, { label: string; tone: "default" | "success" | "warning" | "danger" | "brand" }> = {
  healthy: { label: "健康", tone: "success" },
  warning: { label: "告警", tone: "warning" },
  broken: { label: "异常", tone: "danger" },
  expired: { label: "已过期", tone: "danger" },
  unknown: { label: "未知", tone: "default" },
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

type TabKey = "list" | "featured" | "health" | "audit";

export default function CaseAdminPage() {
  const [tab, setTab] = useState<TabKey>("list");
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [featured, setFeatured] = useState<FeaturedCase[]>([]);
  const [health, setHealth] = useState<ContentHealthOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingFeatured, setSavingFeatured] = useState(false);
  const [permission, setPermission] = useState<
    "checking" | "allowed" | "denied"
  >("checking");

  // 权限预检：非 admin/owner 不发任何 /admin/* 请求，直接渲染引导
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await authApi.me();
        if (!cancelled) {
          setPermission(isAdminUser(me) ? "allowed" : "denied");
        }
      } catch {
        if (!cancelled) setPermission("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCases = useCallback(async () => {
    const list = await caseAdminApi.list();
    setCases(list);
  }, []);

  const loadFeatured = useCallback(async () => {
    setFeatured(await caseAdminApi.featured());
  }, []);

  const loadHealth = useCallback(async () => {
    setHealth(await caseAdminApi.contentHealth());
  }, []);

  const loadAudit = useCallback(async () => {
    setAudit(await caseAdminApi.audit(100));
  }, []);

  useEffect(() => {
    if (permission !== "allowed") return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (tab === "list") await loadCases();
        else if (tab === "featured") await loadFeatured();
        else if (tab === "health") await loadHealth();
        else if (tab === "audit") await loadAudit();
      } catch (err: unknown) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setPermission("denied");
          } else {
            addToast({ title: "加载失败", description: "请刷新后重试", color: "danger" });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, permission, loadCases, loadFeatured, loadHealth, loadAudit]);

  const publishedCases = useMemo(
    () => cases.filter((c) => c.status === "published"),
    [cases],
  );

  const featuredIds = useMemo(() => new Set(featured.map((f) => f.caseId)), [featured]);

  const candidates = useMemo(
    () => publishedCases.filter((c) => !featuredIds.has(c.id)),
    [publishedCases, featuredIds],
  );

  const addFeatured = (caseId: string) => {
    const target = publishedCases.find((c) => c.id === caseId);
    if (!target) return;
    setFeatured((prev) => [
      ...prev,
      { caseId: target.id, slug: target.slug, title: target.title, status: target.status, sortOrder: prev.length },
    ]);
  };

  const removeFeatured = (caseId: string) => {
    setFeatured((prev) =>
      prev
        .filter((f) => f.caseId !== caseId)
        .map((f, index) => ({ ...f, sortOrder: index })),
    );
  };

  const moveFeatured = (index: number, dir: -1 | 1) => {
    setFeatured((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((f, i) => ({ ...f, sortOrder: i }));
    });
  };

  const saveFeatured = async () => {
    setSavingFeatured(true);
    try {
      const saved = await caseAdminApi.setFeatured(featured.map((f) => f.caseId));
      setFeatured(saved);
      addToast({ title: "精选位已保存", color: "success" });
    } catch {
      addToast({ title: "保存失败", description: "请确认案例仍存在后重试", color: "danger" });
    } finally {
      setSavingFeatured(false);
    }
  };

  if (permission === "checking") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <V2BackButton label="返回" />
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-[var(--kaypal-v3-accent)]" />
        </div>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <V2BackButton label="返回" />
        <div className="rounded-xl border border-dashed border-divider p-12 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-warning" />
          <h2 className="text-lg font-semibold text-foreground">
            无权限访问案例管理
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-default-500">
            案例管理仅限 admin/owner 角色使用。如需开通请联系管理员，或返回今日工作台继续。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/today">
              <OpsButton tone="brand">
                <Home className="h-4 w-4" /> 返回今日工作台
              </OpsButton>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <V2BackButton label="返回" />
      <OpsDesktopPage
        title="案例管理"
        description="内容运营无需研发即可维护案例：编辑、提交审核、精选位排序、内容健康与审计"
        actions={
          <Link href="/case-admin/new">
            <OpsButton tone="brand">
              <Plus className="h-4 w-4" /> 新建案例
            </OpsButton>
          </Link>
        }
      >
        <OpsTabs
          ariaLabel="案例管理视图"
          activeKey={tab}
          onChange={(key) => setTab(key as TabKey)}
          items={[
            { key: "list", label: "案例列表", count: cases.length },
            { key: "featured", label: "精选位", count: featured.length },
            { key: "health", label: "内容健康" },
            { key: "audit", label: "审计" },
          ]}
        />

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-[var(--kaypal-v3-accent)]" />
          </div>
        ) : tab === "list" ? (
          <CaseListTable cases={cases} />
        ) : tab === "featured" ? (
          <FeaturedManager
            featured={featured}
            candidates={candidates}
            saving={savingFeatured}
            onAdd={addFeatured}
            onRemove={removeFeatured}
            onMove={moveFeatured}
            onSave={saveFeatured}
          />
        ) : tab === "health" ? (
          <HealthPanel health={health} />
        ) : (
          <AuditTable audit={audit} />
        )}
      </OpsDesktopPage>
    </div>
  );
}

function CaseListTable({ cases }: { cases: AdminCase[] }) {
  if (cases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-divider p-10 text-center text-sm text-default-500">
        暂无案例，点击右上角「新建案例」开始
      </div>
    );
  }
  return (
    <OpsDenseTable>
      <table>
        <thead>
          <tr>
            <th>标题</th>
            <th>来源</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const status = STATUS_META[c.status] ?? STATUS_META.draft;
            return (
              <tr key={c.id}>
                <td>
                  <div className="font-medium text-foreground">{c.title}</div>
                  <div className="text-[12px] text-default-500">/{c.slug}</div>
                </td>
                <td>{PROVENANCE_LABEL[c.provenanceType] ?? c.provenanceType}</td>
                <td>
                  <OpsStatusPill tone={status.tone}>{status.label}</OpsStatusPill>
                </td>
                <td>{fmtTime(c.updatedAt)}</td>
                <td>
                  <Link href={`/case-admin/${c.id}`}>
                    <OpsButton tone="ghost">编辑</OpsButton>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </OpsDenseTable>
  );
}

function FeaturedManager({
  featured,
  candidates,
  saving,
  onAdd,
  onRemove,
  onMove,
  onSave,
}: {
  featured: FeaturedCase[];
  candidates: AdminCase[];
  saving: boolean;
  onAdd: (caseId: string) => void;
  onRemove: (caseId: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <OpsPanel title="已精选（拖动排序：上移/下移）" extra={
        <OpsButton tone="brand" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          保存排序
        </OpsButton>
      }>
        {featured.length === 0 ? (
          <div className="py-6 text-center text-sm text-default-500">
            尚未配置精选位，从下方候选案例添加
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {featured.map((f, index) => (
              <div key={f.caseId} className="flex items-center justify-between gap-2 rounded-lg border border-divider px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Star className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]" />
                  <span className="text-[13px] font-medium text-foreground">
                    {index + 1}. {f.title}
                  </span>
                  <span className="truncate text-[12px] text-default-500">/{f.slug}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <OpsButton tone="ghost" onClick={() => onMove(index, -1)} disabled={index === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </OpsButton>
                  <OpsButton tone="ghost" onClick={() => onMove(index, 1)} disabled={index === featured.length - 1}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </OpsButton>
                  <OpsButton tone="danger" onClick={() => onRemove(f.caseId)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </OpsButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="候选案例（已发布，未精选）">
        {candidates.length === 0 ? (
          <div className="py-6 text-center text-sm text-default-500">没有可添加的已发布案例</div>
        ) : (
          <div className="flex flex-col gap-2">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-divider px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">{c.title}</div>
                  <div className="truncate text-[12px] text-default-500">/{c.slug}</div>
                </div>
                <OpsButton tone="ghost" onClick={() => onAdd(c.id)}>
                  <Heart className="h-3.5 w-3.5" /> 添加精选
                </OpsButton>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

function HealthPanel({ health }: { health: ContentHealthOverview | null }) {
  if (!health) return null;
  const h = health.demoEndpoints;
  return (
    <div className="flex flex-col gap-3">
      <OpsPanel title="演示入口健康度">
        <div className="flex flex-wrap">
          <OpsMetric label="总数" value={h.total} />
          <OpsMetric label="健康" value={h.healthy} tone="success" />
          <OpsMetric label="告警" value={h.warning} tone="warning" />
          <OpsMetric label="异常" value={h.broken} tone="danger" />
          <OpsMetric label="已过期" value={h.expired} tone="danger" />
        </div>
      </OpsPanel>

      {health.demoEndpointAnomalies.length > 0 ? (
        <OpsPanel title="异常入口 + 负责人">
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>案例</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>负责人</th>
                  <th>最后检查</th>
                </tr>
              </thead>
              <tbody>
                {health.demoEndpointAnomalies.map((a) => {
                  const meta = HEALTH_META[a.healthStatus] ?? HEALTH_META.unknown;
                  return (
                    <tr key={a.endpointId}>
                      <td>{a.caseTitle}</td>
                      <td>{a.endpointType}</td>
                      <td><OpsStatusPill tone={meta.tone}>{meta.label}</OpsStatusPill></td>
                      <td>{a.ownerUserId ?? "未指定"}</td>
                      <td>{fmtTime(a.lastCheckedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      ) : null}

      {health.authorizationsExpiring.length > 0 ? (
        <OpsPanel title="授权到期提醒">
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>授权方 / 许可</th>
                  <th>剩余天数</th>
                  <th>到期时间</th>
                </tr>
              </thead>
              <tbody>
                {health.authorizationsExpiring.map((a) => (
                  <tr key={a.id}>
                    <td>{a.grantor ?? a.licenseName ?? a.recordType}</td>
                    <td>
                      <OpsStatusPill tone={a.window === "7d" ? "danger" : "warning"}>
                        {a.daysRemaining} 天
                      </OpsStatusPill>
                    </td>
                    <td>{fmtTime(a.validUntil)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      ) : null}

      {health.reviewsDue.length > 0 ? (
        <OpsPanel title="内容待复核">
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>案例</th>
                  <th>状态</th>
                  <th>下次复核</th>
                </tr>
              </thead>
              <tbody>
                {health.reviewsDue.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td>
                      <OpsStatusPill tone={r.overdue ? "danger" : "warning"}>
                        {r.overdue ? "已逾期" : `${r.daysRemaining} 天后`}
                      </OpsStatusPill>
                    </td>
                    <td>{fmtTime(r.nextReviewAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      ) : null}

      {health.demoEndpointAnomalies.length === 0 &&
        health.authorizationsExpiring.length === 0 &&
        health.reviewsDue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-divider p-10 text-center text-sm text-default-500">
          <ClipboardList className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          内容健康，暂无待办
        </div>
      ) : null}
    </div>
  );
}

function AuditTable({ audit }: { audit: AuditEntry[] }) {
  if (audit.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-divider p-10 text-center text-sm text-default-500">
        暂无审核记录
      </div>
    );
  }
  const decisionMeta: Record<string, { label: string; tone: "default" | "success" | "warning" | "danger" | "brand" }> = {
    pending: { label: "待审核", tone: "warning" },
    approved: { label: "已批准", tone: "success" },
    rejected: { label: "已驳回", tone: "danger" },
    requested_changes: { label: "要求修改", tone: "warning" },
  };
  return (
    <OpsDenseTable>
      <table>
        <thead>
          <tr>
            <th>案例</th>
            <th>类型</th>
            <th>决策</th>
            <th>审核人</th>
            <th>意见</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((a) => {
            const meta = decisionMeta[a.decision] ?? decisionMeta.pending;
            return (
              <tr key={a.id}>
                <td>{a.caseTitle}</td>
                <td>{a.reviewType}</td>
                <td><OpsStatusPill tone={meta.tone}>{meta.label}</OpsStatusPill></td>
                <td>{a.reviewedBy ?? a.submittedBy ?? "—"}</td>
                <td>{a.comments ?? "—"}</td>
                <td>{fmtTime(a.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </OpsDenseTable>
  );
}
