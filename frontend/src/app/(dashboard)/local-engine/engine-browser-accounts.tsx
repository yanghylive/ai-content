"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Users,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineBrowserStatus } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EngineBrowserAccounts() {
  const router = useRouter();
  const [status, setStatus] = useState<LocalEngineBrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await localEngineApi.browserStatus();
      setStatus(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载账号状态失败"));
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

  const total = status?.totalAccounts ?? 0;
  const ready = status?.readyAccounts ?? 0;
  const expired = status?.expiredAccounts ?? 0;

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
              平台账号检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              各平台账号的登录状态和可用性
            </p>
          </div>
          <V2StatusChip tone={expired > 0 ? "warning" : ready > 0 ? "success" : "muted"}>
            {loading ? "检查中" : expired > 0 ? `${expired} 个失效` : `${ready} 个正常`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 三态统计 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-5 text-center">
          <Users className="mx-auto h-6 w-6 text-[var(--kaypal-v3-muted)]" />
          <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-ink)]">
            {loading ? "-" : total}
          </p>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">账号总数</p>
        </div>
        <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-5 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--kaypal-v3-success)]" />
          <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-success)]">
            {loading ? "-" : ready}
          </p>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">登录正常</p>
        </div>
        <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-5 text-center">
          <XCircle className="mx-auto h-6 w-6 text-[var(--kaypal-v3-danger)]" />
          <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-danger)]">
            {loading ? "-" : expired}
          </p>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">登录失效</p>
        </div>
      </div>

      {/* 恢复建议 */}
      {status?.recovery && (status.recovery.waitingTasks > 0 || status.recovery.resumableTasks > 0) && (
        <V2Section title="待恢复任务">
          <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">
            有 {status.recovery.waitingTasks} 个任务等待恢复，
            {status.recovery.resumableTasks} 个可以继续。
            {status.recovery.nextAction && (
              <span className="mt-1 block text-[var(--kaypal-v3-muted)]">
                建议：{status.recovery.nextAction}
              </span>
            )}
          </p>
        </V2Section>
      )}

      {!loading && total === 0 && (
        <V2Section>
          <V2EmptyState
            icon={Users}
            title="还没有平台账号"
            description="先添加一个平台账号，系统才能帮你自动执行任务"
          />
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={RefreshCcw} loading={checking} onClick={() => void handleRecheck()}>
          {checking ? "正在检查..." : "重新检查"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
