"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type AgentConfirmation,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

const RISK_TONE: Record<string, "warning" | "danger"> = {
  medium: "warning",
  high: "danger",
};

export function RiskConfirmFlow() {
  const router = useRouter();
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchConfirmations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.confirmations("pending");
      setConfirmations(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载待确认操作失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfirmations();
  }, [fetchConfirmations]);

  const handleDecision = async (
    item: AgentConfirmation,
    decision: "approve" | "reject",
  ) => {
    setActingId(item.id);
    setError(null);
    try {
      if (decision === "approve") {
        await localEngineApi.approveConfirmation(item.id, {});
      } else {
        await localEngineApi.rejectConfirmation(item.id, {});
      }
      await fetchConfirmations();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/capabilities/risk")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              待确认的高风险操作
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              这些操作有风险，你确认后系统才会执行
            </p>
          </div>
          <V2StatusChip tone={confirmations.length > 0 ? "warning" : "success"}>
            {loading ? "加载中" : confirmations.length > 0 ? `${confirmations.length} 项待确认` : "没有待确认项"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : confirmations.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={CheckCircle2}
            title="没有待确认的操作"
            description="有高风险操作需要你确认时，会出现在这里"
          />
        </V2Section>
      ) : (
        <div className="space-y-4">
          {confirmations.map((item) => (
            <V2Section key={item.id} padding={false}>
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] ${
                      item.riskLevel === "high"
                        ? "bg-[var(--kaypal-v3-danger-soft)]"
                        : "bg-[var(--kaypal-v3-amber-soft)]"
                    }`}
                  >
                    {item.riskLevel === "high" ? (
                      <ShieldAlert className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-[var(--kaypal-v3-amber)]" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                        {item.title}
                      </h3>
                      <V2StatusChip tone={RISK_TONE[item.riskLevel] || "warning"}>
                        {item.riskLevel === "high" ? "高风险" : "中风险"}
                      </V2StatusChip>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {item.description}
                    </p>
                    {item.actionLabel && (
                      <p className="mt-1.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                        将执行:{item.actionLabel}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <V2DangerButton
                    icon={XCircle}
                    loading={actingId === item.id}
                    onClick={() => void handleDecision(item, "reject")}
                  >
                    拒绝
                  </V2DangerButton>
                  <V2PrimaryButton
                    icon={CheckCircle2}
                    loading={actingId === item.id}
                    onClick={() => void handleDecision(item, "approve")}
                  >
                    确认执行
                  </V2PrimaryButton>
                </div>
              </div>
            </V2Section>
          ))}
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/capabilities/risk")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
