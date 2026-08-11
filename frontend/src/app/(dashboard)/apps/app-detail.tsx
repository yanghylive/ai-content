"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ShoppingCart, Download, Rocket } from "lucide-react";
import {
  V2Section,
  V2PrimaryButton,
  V2GhostButton,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import {
  getMarketApps,
  installCrmApp,
  purchaseCrmApp,
  type MarketAppState,
} from "@/lib/api/app-market";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const ACTION_LABELS: Record<string, string> = {
  purchase: "购买应用",
  install: "安装应用",
  open: "打开应用",
  contact_sales: "联系销售",
  none: "暂无可用操作",
};

export function AppDetail({ appKey }: { appKey: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [app, setApp] = useState<MarketAppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadApp = useCallback(async () => {
    try {
      setLoading(true);
      const apps = await getMarketApps();
      const found = apps.find((a) => a.appKey === appKey) || null;
      setApp(found);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载应用失败"));
    } finally {
      setLoading(false);
    }
  }, [appKey]);

  useEffect(() => {
    void loadApp();
  }, [loadApp]);

  const primaryAction = app?.access.primaryAction || "none";

  const handlePrimaryAction = async () => {
    if (!app) return;
    setActing(true);
    setError(null);
    setDone(null);
    try {
      if (primaryAction === "install") {
        await installCrmApp();
        setDone("安装完成，可以开始使用了");
      } else if (primaryAction === "purchase") {
        await purchaseCrmApp();
        setDone("购买成功，现在可以安装了");
      } else if (primaryAction === "open") {
        router.push(`/apps/${app.appKey}`);
        return;
      }
      await loadApp();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
    );
  }

  if (!app) {
    return (
      <V2Section>
        <div className="py-8 text-center">
          <p className="text-[var(--kaypal-v3-muted)]">没找到这个应用</p>
          <div className="mt-4">
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/apps")}>
              返回应用市场
            </V2GhostButton>
          </div>
        </div>
      </V2Section>
    );
  }

  const actionIcon =
    primaryAction === "purchase"
      ? ShoppingCart
      : primaryAction === "install"
        ? Download
        : primaryAction === "open"
          ? Rocket
          : CheckCircle2;

  /* 移动端原生视图（mx-* 明德 VP 风格）——apps/detail */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/apps")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回应用市场
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {app.name}
                  {app.installed && <span className="mx-badge mx-badge-green" style={{ fontSize: 10 }}>已安装</span>}
                </div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>{app.priceLabel}</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}
          {done && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(5,150,105,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#059669" }}>{done}</p>
            </div>
          )}

          <div className="mx-section-head" style={{ marginTop: 14 }}>应用介绍</div>
          <div className="mx-card" style={{ padding: 13 }}>
            <p style={{ fontSize: 12.5, color: "var(--mx-ink)", lineHeight: 1.65 }}>{app.description}</p>
          </div>

          {app.commercialWarnings.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 16 }}>注意事项</div>
              <div className="mx-card" style={{ padding: 13, borderColor: "rgba(222,150,57,.4)" }}>
                <ul style={{ listStyle: "disc", listStylePosition: "inside", fontSize: 12, color: "#b45309", lineHeight: 1.8 }}>
                  {app.commercialWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/apps")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回市场
            </button>
            {primaryAction !== "none" && primaryAction !== "contact_sales" && (
              <button
                type="button"
                className="mx-btn-gold"
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                disabled={acting}
                onClick={() => void handlePrimaryAction()}
              >
                {actionIcon === ShoppingCart ? <ShoppingCart width={14} height={14} /> : actionIcon === Download ? <Download width={14} height={14} /> : actionIcon === Rocket ? <Rocket width={14} height={14} /> : <CheckCircle2 width={14} height={14} />}
                {acting ? "处理中…" : ACTION_LABELS[primaryAction]}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/apps")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {app.name}
              </h1>
              {app.installed && (
                <V2StatusChip tone="success">已安装</V2StatusChip>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {app.priceLabel}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {done && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{done}</p>
        </div>
      )}

      <V2Section title="应用介绍">
        <p className="text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
          {app.description}
        </p>
      </V2Section>

      {app.commercialWarnings.length > 0 && (
        <V2Section title="注意事项">
          <ul className="list-inside list-disc space-y-1 text-sm text-[var(--kaypal-v3-amber)]">
            {app.commercialWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </V2Section>
      )}

      {/* 单一主行动：由 access 策略驱动，用户不用想 */}
      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/apps")}>
          返回应用市场
        </V2GhostButton>
        {primaryAction !== "none" && primaryAction !== "contact_sales" && (
          <V2PrimaryButton
            icon={actionIcon}
            loading={acting}
            onClick={handlePrimaryAction}
          >
            {acting ? "处理中..." : ACTION_LABELS[primaryAction]}
          </V2PrimaryButton>
        )}
      </section>
    </div>
  );
}
