"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCcw, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api/client";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

interface RiskPolicy {
  action: string;
  riskLevel: string;
  requireConfirm?: boolean;
  autoExecute?: boolean;
  forbidden?: boolean;
  description?: string;
}

const ACTION_LABELS: Record<string, string> = {
  "agent-confirmation-approve": "批准智能任务执行",
  "auto-upload-publish": "自动发布内容",
  "local-file-delete": "删除本地文件",
  "material-batch-delete": "批量删除素材",
  "interaction-approval": "确认发送互动回复",
  "retry-publish": "重试发布",
  "runtime-control": "本机服务控制",
  "schedule-enable": "启用计划任务",
};

/** 未映射的动作码 → 面向客户的兜底名称（不暴露内部代号） */
function formatAction(action?: string | null) {
  const key = String(action || "").trim();
  if (!key) return "系统操作";
  return ACTION_LABELS[key] || "系统操作";
}

/** 风险管控——真实策略和待确认数（不再写死） */
export function RiskCenter() {
  const router = useRouter();
  const [policies, setPolicies] = useState<RiskPolicy[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyData, confirmations] = await Promise.all([
        api.get<RiskPolicy[]>("/risk-policies").catch(() => []),
        localEngineApi.confirmations().catch(() => []),
      ]);
      setPolicies(Array.isArray(policyData) ? policyData : []);
      setPendingCount(
        (Array.isArray(confirmations) ? confirmations : []).filter(
          (c) => c.status === "pending",
        ).length,
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "风控数据读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const levelTone = (level?: string) => {
    if (level === "high") return "danger" as const;
    if (level === "medium") return "warning" as const;
    return "success" as const;
  };
  const levelLabel = (level?: string) =>
    ({ high: "高风险", medium: "中风险", low: "低风险" } as Record<string, string>)[level || ""] || level || "-";

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">风险管控</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              高风险操作需确认后才执行 · 待确认 {pendingCount} 项
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
          <V2PrimaryButton
            icon={AlertTriangle}
            onClick={() => router.push("/tasks/confirmations")}
          >
            处理待确认{pendingCount > 0 ? `（${pendingCount}）` : ""}
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : policies.length === 0 ? (
        <V2EmptyState
          icon={ShieldAlert}
          title="还没有风控策略"
          description="系统默认策略会在首次高风险操作时自动生成"
        />
      ) : (
        <V2Section title={`风控策略（${policies.length}）`}>
          <div className="flex flex-col gap-3">
            {policies.map((policy) => (
              <div
                key={policy.action}
                className="kaypal-v3-surface flex items-center justify-between p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {formatAction(policy.action)}
                    </p>
                    <V2StatusChip tone={levelTone(policy.riskLevel)}>
                      {levelLabel(policy.riskLevel)}
                    </V2StatusChip>
                  </div>
                  {policy.description ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-muted)]">
                      {policy.description}
                    </p>
                  ) : null}
                </div>
                <V2StatusChip tone={policy.forbidden ? "danger" : policy.requireConfirm ? "warning" : "success"}>
                  {policy.forbidden ? "禁止" : policy.requireConfirm ? "需确认" : "自动执行"}
                </V2StatusChip>
              </div>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
