"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, ShieldCheck, RefreshCcw } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineReadiness } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EnginePermissions() {
  const router = useRouter();
  const [readiness, setReadiness] = useState<LocalEngineReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.readiness();
      setReadiness(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载安全检查失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchReadiness();
    setChecking(false);
  };

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  const blockers = readiness?.blockers || [];
  const warnings = readiness?.warnings || [];
  const allClear = blockers.length === 0;

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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              安全检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              权限和安全的完整检查结果
            </p>
          </div>
          <V2StatusChip tone={allClear ? "success" : "danger"}>
            {loading ? "检查中" : allClear ? "全部通过" : `${blockers.length} 项未通过`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {blockers.length > 0 && (
        <V2Section title="未通过项（需要处理）" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {blockers.map((item, i) => (
              <div key={i} className="flex items-start gap-4 p-5">
                <XCircle className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    {item.capability}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    {item.message}
                  </p>
                  {item.nextAction && (
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-accent-ink)]">
                      怎么办：{item.nextAction}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {warnings.length > 0 && (
        <V2Section title="警告（建议处理）" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {warnings.map((item, i) => {
              const w = item as { capability?: string; message?: string };
              return (
                <div key={i} className="flex items-start gap-4 p-5">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-amber)]" />
                  <div className="flex-1">
                    <p className="font-medium text-[var(--kaypal-v3-ink)]">
                      {w.capability || `警告 ${i + 1}`}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                      {w.message || String(item)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      {!loading && allClear && (
        <div className="flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-6">
          <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
          <span className="font-medium text-[var(--kaypal-v3-success)]">
            安全检查全部通过
          </span>
        </div>
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
