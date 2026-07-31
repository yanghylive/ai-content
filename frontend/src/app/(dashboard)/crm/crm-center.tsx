"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Download,
  MessageSquareText,
  Phone,
  Search,
  Upload,
  UserRound,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { V2StatusChip } from "@/components/v2/ui-kit";
import { listCrmCustomers, getCrmSummary, type CrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";

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
  const [stats, setStats] = useState({
    total: 0,
    newThisWeek: 0,
    followUp: 0,
    overdue: 0,
    pipelineYuan: 0,
  });
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [loading, setLoading] = useState(true);

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
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载客户统计失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="客户管理"
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
        primaryAction={{ label: "新增客户", href: "/crm?action=new" }}
        quickActions={[
          {
            key: "new",
            title: "新增客户",
            description: "手动添加一个客户",
            icon: UserRoundPlus,
            href: "/crm?action=new",
          },
          {
            key: "import",
            title: "批量导入",
            description: "从 Excel 批量导入",
            icon: Upload,
            href: "/crm-import-v2",
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
          { key: "export", title: "导出客户", icon: Download, href: "/crm?action=export" },
          { key: "connectors", title: "数据连接", icon: Users, href: "/crm/connectors" },
        ]}
      />

      {/* 客户列表 */}
      <section className="kaypal-v3-panel">
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            客户列表
          </h2>
          <span className="text-sm text-[var(--kaypal-v3-muted)]">
            {loading ? "加载中..." : `共 ${customers.length} 个`}
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
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
                onClick={() => router.push("/crm?action=new")}
              >
                新增客户
              </button>
              <button
                type="button"
                className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => router.push("/crm-import-v2")}
              >
                批量导入
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {customers.map((customer) => {
              const status = STATUS_LABELS[customer.status] || {
                label: customer.status,
                tone: "muted" as const,
              };
              return (
                <button
                  key={customer.id}
                  type="button"
                  className="flex w-full items-center justify-between p-5 text-left transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                  onClick={() => router.push(`/crm/detail?id=${customer.id}`)}
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
    </div>
  );
}
