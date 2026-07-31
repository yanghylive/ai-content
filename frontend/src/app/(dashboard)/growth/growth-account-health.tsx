"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  Smartphone,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthAccountHealth } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信",
  gongzhonghao: "公众号",
};

const LOGIN_LABELS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "muted" }> = {
  online: { label: "在线", tone: "success" },
  expired: { label: "登录失效", tone: "danger" },
  "verification-required": { label: "需要验证", tone: "warning" },
  unknown: { label: "未知", tone: "muted" },
};

const RISK_LABELS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "muted" }> = {
  normal: { label: "正常", tone: "success" },
  cooldown: { label: "冷却中", tone: "warning" },
  paused: { label: "已暂停", tone: "warning" },
  "needs-human": { label: "需要人工", tone: "danger" },
};

export function GrowthAccountHealthPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<GrowthAccountHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listAccountHealth();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载账号健康失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const abnormalCount = accounts.filter(
    (a) => a.loginStatus !== "online" || a.riskStatus !== "normal",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/growth")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">账号健康</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              获客用的各平台账号状态
            </p>
          </div>
          <V2StatusChip tone={abnormalCount > 0 ? "warning" : "success"}>
            {loading ? "检查中" : abnormalCount > 0 ? `${abnormalCount} 个需注意` : "全部正常"}
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
      ) : accounts.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={Smartphone}
            title="还没有获客账号"
            description="配置获客任务后会显示账号状态"
          />
        </V2Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => {
            const login = LOGIN_LABELS[account.loginStatus] || LOGIN_LABELS.unknown;
            const risk = RISK_LABELS[account.riskStatus] || RISK_LABELS.normal;
            const ok = account.loginStatus === "online" && account.riskStatus === "normal";
            return (
              <div key={account.id} className="kaypal-v3-panel p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {ok ? (
                      <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
                    ) : account.riskStatus === "needs-human" || account.loginStatus === "expired" ? (
                      <XCircle className="h-6 w-6 text-[var(--kaypal-v3-danger)]" />
                    ) : (
                      <AlertTriangle className="h-6 w-6 text-[var(--kaypal-v3-amber)]" />
                    )}
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {account.accountName || account.accountId}
                      </p>
                      <p className="text-sm text-[var(--kaypal-v3-muted)]">
                        {PLATFORM_LABELS[account.platform] || account.platform}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <V2StatusChip tone={login.tone}>{login.label}</V2StatusChip>
                    <V2StatusChip tone={risk.tone}>{risk.label}</V2StatusChip>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                      {account.todayActionCount}
                    </p>
                    <p className="text-xs text-[var(--kaypal-v3-muted)]">今日操作</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${account.failureRate > 0.2 ? "text-[var(--kaypal-v3-danger)]" : "text-[var(--kaypal-v3-ink)]"}`}>
                      {Math.round(account.failureRate * 100)}%
                    </p>
                    <p className="text-xs text-[var(--kaypal-v3-muted)]">失败率</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                      {account.lastCheckedAt
                        ? new Date(account.lastCheckedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                        : "-"}
                    </p>
                    <p className="text-xs text-[var(--kaypal-v3-muted)]">最近检查</p>
                  </div>
                </div>
                {account.recommendation && !ok && (
                  <p className="mt-3 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-amber-soft)] p-2.5 text-sm text-[var(--kaypal-v3-amber)]">
                    建议：{account.recommendation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/growth")}>
          返回增长控制台
        </V2GhostButton>
        <V2GhostButton icon={ShieldCheck} onClick={() => void fetchAccounts()}>
          重新检查
        </V2GhostButton>
      </section>
    </div>
  );
}
