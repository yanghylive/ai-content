"use client";

/**
 * 微信「AI 自动接待」状态卡（方案 2 阶段 1+2）
 *
 * 展示引擎守护的运行状态：开关 / 覆盖微信的机器人 / 今日生成草稿数 /
 * 跳过原因。轮询后端状态端点，约 8s 刷新一次。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Sparkles } from "@/components/iconpark";
import { localEngineApi, type WechatAutoReceptionStatus } from "@/lib/api/local-engine";
import { toActionableError } from "@/lib/public-error";
import { LoadErrorBanner } from "@/components/load-error-banner";

export function WechatAutoReceptionCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<WechatAutoReceptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await localEngineApi.wechatAutoReceptionStatus());
      setError(null);
    } catch (e) {
      setError(toActionableError(e, "自动接待状态读取失败"));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const toggle = async () => {
    const next = !status?.enabled;
    setToggling(true);
    try {
      await localEngineApi.setWechatAutoReceptionEnabled(next);
      await load();
    } catch (e) {
      setError(toActionableError(e, "开关切换失败"));
    } finally {
      setToggling(false);
    }
  };

  const toggleAutoAccept = async () => {
    const next = !status?.autoAcceptFriend;
    setToggling(true);
    try {
      await localEngineApi.setWechatAutoAcceptFriendEnabled(next);
      await load();
    } catch (e) {
      setError(toActionableError(e, "自动通过好友开关切换失败"));
    } finally {
      setToggling(false);
    }
  };

  if (error && !status) {
    return (
      <div className="kaypal-v3-panel p-4">
        <LoadErrorBanner message={error} onRetry={() => void load()} />
      </div>
    );
  }

  const enabled = Boolean(status?.enabled);
  const paused = Boolean(status?.paused);
  const reasonList = Object.values(status?.reasons || {}).slice(0, 2);

  if (compact) {
    return (
      <div className="mx-card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>
            <Sparkles width={14} height={14} style={{ color: "var(--kaypal-v3-amber)" }} />
            AI 自动接待
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={toggling}
            onClick={() => void toggle()}
            style={{ flexShrink: 0, width: 42, height: 25, borderRadius: 999, padding: 3, background: enabled ? "var(--kaypal-v3-amber)" : "rgba(142,165,190,.4)", display: "flex", alignItems: "center", justifyContent: enabled ? "flex-end" : "flex-start", transition: "all .2s", border: "none" }}
          >
            <span style={{ width: 19, height: 19, borderRadius: "50%", background: "var(--kaypal-v3-paper)", boxShadow: "var(--kaypal-v3-card-shadow)" }} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 8, lineHeight: 1.5 }}>
          {paused
            ? `暂停中：${status?.pausedReason || "用户正在人工接管"}`
            : enabled
              ? `守护运行中 · 今日生成 ${status?.todayCreated ?? 0} 条草稿`
              : "已关闭，收到微信新消息不会自动生成回复草稿"}
        </p>
        {reasonList.length > 0 && enabled && (
          <p style={{ fontSize: 10.5, color: "var(--kaypal-v3-amber)", marginTop: 6, lineHeight: 1.5 }}>
            {reasonList[0]}
          </p>
        )}
      </div>
    );
  }

  const botNames = (status?.bots || []).filter((bot) => bot.enabled).map((bot) => bot.name);

  return (
    <section className="kaypal-v3-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="kaypal-v3-icon-tile">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
              AI 自动接待
            </h2>
            <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
              客户微信消息到达后自动生成回复草稿，你放行才发送
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {paused && (
            <span className="rounded-full border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-2.5 py-0.5 text-xs text-[var(--kaypal-v3-amber)]">
              暂停中
            </span>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={toggling || paused}
            title={paused ? status?.pausedReason || undefined : undefined}
            className={`flex h-6 w-11 items-center rounded-full p-0.5 transition disabled:opacity-50 ${
              enabled
                ? "justify-end bg-[var(--kaypal-v3-accent)]"
                : "justify-start bg-[var(--kaypal-v3-border-strong)]"
            }`}
            onClick={() => void toggle()}
          >
            <span className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
          </button>
        </div>
      </div>

      {paused && status?.pausedReason ? (
        <p className="mt-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-3 py-2 text-sm text-[var(--kaypal-v3-amber)]">
          {status.pausedReason}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
            自动通过好友
          </p>
          <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
            {status?.autoAcceptFriend
              ? status.autoAcceptRuntimeHint ||
                (status.autoAcceptPlanId
                  ? "已创建自动通过计划，等待 Windows 端到点执行"
                  : "Windows 端到点执行")
              : "开启后定期处理微信好友申请（需 Windows 桌面微信 + native runtime）"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(status?.autoAcceptFriend)}
          disabled={toggling || paused}
          className={`flex h-6 w-11 items-center rounded-full p-0.5 transition disabled:opacity-50 ${
            status?.autoAcceptFriend
              ? "justify-end bg-[var(--kaypal-v3-accent)]"
              : "justify-start bg-[var(--kaypal-v3-border-strong)]"
          }`}
          onClick={() => void toggleAutoAccept()}
        >
          <span className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">承接机器人</p>
          <p className="mt-1 truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
            {botNames.length > 0 ? botNames.join("、") : "未启用"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">今日生成草稿</p>
          <p className="mt-1 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            {status?.todayCreated ?? 0}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">待确认</p>
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
            onClick={() => router.push("/tasks/confirmations")}
          >
            <Inbox className="h-4 w-4" />
            去确认 →
          </button>
        </div>
        <div>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">守护状态</p>
          <p className="mt-1 truncate text-sm text-[var(--kaypal-v3-soft-ink)]">
            {enabled
              ? status?.lastRunAt
                ? `运行中 · 每 ${Math.round((status.intervalMs || 15000) / 1000)}s 检查`
                : "运行中"
              : "已关闭"}
          </p>
        </div>
      </div>

      {reasonList.length > 0 && (
        <div className="mt-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-3 py-2 text-xs text-[var(--kaypal-v3-amber)]">
          {reasonList.map((reason, index) => (
            <p key={`${reason}-${index}`} className={index > 0 ? "mt-1" : undefined}>
              {reason}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
