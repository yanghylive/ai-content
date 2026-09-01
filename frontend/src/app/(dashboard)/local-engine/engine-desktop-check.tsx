"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  AlertTriangle,
  MonitorSmartphone,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineDesktopStatus } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EngineDesktopCheck() {
  const router = useRouter();
  const [status, setStatus] = useState<LocalEngineDesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await localEngineApi.desktopStatus();
      setStatus(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载桌面状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchStatus();
    setChecking(false);
  };

  const available = Boolean(status?.available);
  const blockers = status?.blockers || [];
  const warnings = status?.warnings || [];
  const permissionChecks = status?.permissionChecks || [];

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/local-engine")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              微信桌面检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              检查微信桌面端是否可被助手操作
            </p>
          </div>
          <V2StatusChip tone={available ? "success" : "danger"}>
            {loading ? "检查中" : available ? "可以操作" : "无法操作"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 阻断项 */}
      {blockers.length > 0 && (
        <V2Section title="需要先解决的问题">
          <div className="space-y-3">
            {blockers.map((blocker, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4"
              >
                <XCircle className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                <p className="text-sm text-[var(--kaypal-v3-ink)]">{blocker}</p>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {/* 权限检查 */}
      {permissionChecks.length > 0 && (
        <V2Section title="系统权限" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {permissionChecks.map((check, i) => {
              const ok = (check as { ok?: boolean; granted?: boolean }).ok ??
                (check as { granted?: boolean }).granted ?? false;
              const label =
                (check as { label?: string; name?: string; capability?: string }).label ||
                (check as { name?: string }).name ||
                (check as { capability?: string }).capability ||
                `权限 ${i + 1}`;
              const message =
                (check as { message?: string }).message || (ok ? "已授权" : "未授权");
              return (
                <div key={i} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    {ok ? (
                      <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
                    ) : (
                      <XCircle className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                    )}
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">{label}</p>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {message}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      {/* 警告 */}
      {warnings.length > 0 && (
        <V2Section title="警告">
          <div className="space-y-2">
            {warnings.map((warning, i) => (
              <p key={i} className="flex items-start gap-2 text-sm text-[var(--kaypal-v3-amber)]">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                {warning}
              </p>
            ))}
          </div>
        </V2Section>
      )}

      {/* 一切正常 */}
      {!loading && available && blockers.length === 0 && (
        <div className="flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-6">
          <MonitorSmartphone className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
          <span className="font-medium text-[var(--kaypal-v3-success)]">
            微信桌面端状态良好，助手可以正常操作
          </span>
        </div>
      )}

      {status?.nextAction && !available && (
        <div className="kaypal-v3-surface p-4">
          <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">
            <strong>下一步：</strong>{status.nextAction}
          </p>
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={RefreshCcw} loading={checking} onClick={() => void handleRecheck()}>
          {checking ? "正在检查..." : "重新检查"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
