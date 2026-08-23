"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  AlertTriangle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

type CheckItem = {
  key: string;
  label: string;
  ok: boolean;
  message: string;
  nextAction?: string;
};

export function EngineRunDetail() {
  const router = useRouter();
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChecks = useCallback(async () => {
    setError(null);
    try {
      const [healthResult, readinessResult] = await Promise.allSettled([
        localEngineApi.health(),
        localEngineApi.readiness(),
      ]);

      const items: CheckItem[] = [];

      if (healthResult.status === "fulfilled") {
        const h = healthResult.value;
        items.push({
          key: "engine",
          label: "设备服务",
          ok: h.online,
          message: h.online ? `在线（${h.version || "运行中"}）` : "离线",
          nextAction: h.online ? undefined : "重启桌面助手",
        });
        (h.blockers || []).forEach((b, i) => {
          items.push({
            key: `blocker-${i}`,
            label: b.capability,
            ok: false,
            message: b.message,
            nextAction: b.nextAction,
          });
        });
      } else {
        items.push({
          key: "engine",
          label: "设备服务",
          ok: false,
          message: "无法连接引擎",
          nextAction: "检查引擎助手是否启动",
        });
      }

      if (readinessResult.status === "fulfilled") {
        const r = readinessResult.value;
        items.push({
          key: "accounts",
          label: "平台账号",
          ok: (r.summary?.readyAccounts ?? 0) > 0,
          message: `${r.summary?.readyAccounts ?? 0} 个就绪${r.summary?.expiredAccounts ? `，${r.summary.expiredAccounts} 个失效` : ""}`,
          nextAction: r.summary?.expiredAccounts
            ? "重新登录失效账号"
            : undefined,
        });
      }

      setChecks(items);
    } catch (err: unknown) {
      setError(toPublicError(err, "检查失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchChecks();
  }, [fetchChecks]);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchChecks();
    setChecking(false);
  };

  const okCount = checks.filter((c) => c.ok).length;
  const failCount = checks.length - okCount;

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
              运行检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {loading
                ? "正在检查..."
                : failCount > 0
                  ? `${failCount} 项需要处理，${okCount} 项正常`
                  : "全部正常，可以放心使用"}
            </p>
          </div>
          <V2StatusChip tone={failCount > 0 ? "warning" : "success"}>
            {loading ? "检查中" : failCount > 0 ? `${failCount} 项待处理` : "全部正常"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section title="检查结果" padding={false}>
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {checks.map((item) => (
            <div key={item.key} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                {item.ok ? (
                  <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
                ) : (
                  <XCircle className="h-6 w-6 text-[var(--kaypal-v3-danger)]" />
                )}
                <div>
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    {item.message}
                  </p>
                </div>
              </div>
              {!item.ok && item.nextAction && (
                <span className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-amber)]">
                  <AlertTriangle className="h-4 w-4" />
                  {item.nextAction}
                </span>
              )}
            </div>
          ))}
        </div>
      </V2Section>

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
