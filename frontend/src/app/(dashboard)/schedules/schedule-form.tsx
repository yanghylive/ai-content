"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Save } from "lucide-react";
import {
  V2Section,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { schedulesApi, type ScheduleConfig } from "@/lib/api/schedules";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const TASK_TYPE_LABELS: Record<string, { label: string; desc: string }> = {
  collect_materials: { label: "自动采集素材", desc: "从所有已启用的信息源定期获取最新内容" },
  mine_materials: { label: "自动挖掘素材", desc: "批量利用大模型加工并提炼未处理的素材" },
  create_articles: { label: "自动生成文章", desc: "从就绪的精选选题中按默认风格生成草稿" },
};

// cron 转人话预设：用户看到的是"每天 9 点"而不是 0 9 * * *
const FREQ_PRESETS = [
  { label: "每 30 分钟", cron: "*/30 * * * *", desc: "高频同步" },
  { label: "每小时", cron: "0 * * * *", desc: "整点执行" },
  { label: "每天 09:00", cron: "0 9 * * *", desc: "每天上班前" },
  { label: "每天 12:00", cron: "0 12 * * *", desc: "每天中午" },
  { label: "每天 18:00", cron: "0 18 * * *", desc: "每天下班后" },
  { label: "每天 21:00", cron: "0 21 * * *", desc: "每天晚间" },
] as const;

function cronToPreset(cron: string): string {
  const found = FREQ_PRESETS.find((p) => p.cron === cron);
  return found ? found.cron : "0 9 * * *";
}

function cronToText(cron: string): string {
  return FREQ_PRESETS.find((p) => p.cron === cron)?.label || cron;
}

export function ScheduleForm({ taskType }: { taskType?: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(taskType));

  // 智能默认值：每天 09:00、启用
  const [form, setForm] = useState({
    taskType: taskType || "create_articles",
    cron: "0 9 * * *",
    enabled: true,
  });

  const loadSchedule = useCallback(async () => {
    if (!taskType) return;
    try {
      setLoading(true);
      const list = await schedulesApi.list();
      const found = list.find((s: ScheduleConfig) => s.taskType === taskType);
      if (found) {
        setForm({
          taskType: found.taskType,
          cron: cronToPreset(found.cronExpr),
          enabled: found.enabled,
        });
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "加载定时任务失败"));
    } finally {
      setLoading(false);
    }
  }, [taskType]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await schedulesApi.update(form.taskType, {
        cronExpr: form.cron,
        enabled: form.enabled,
      });
      router.push("/schedules");
    } catch (err: unknown) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const taskInfo = TASK_TYPE_LABELS[form.taskType] || {
    label: form.taskType,
    desc: "",
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
    );
  }

  /* 移动端原生视图（mx-* 明德 VP 风格）——schedules/edit */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/schedules")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回定时任务
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>{taskInfo.label}</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>{taskInfo.desc || "设置这个任务的执行频率"}</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 执行频率 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>多久执行一次？</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {FREQ_PRESETS.map((preset) => {
              const selected = form.cron === preset.cron;
              return (
                <button
                  key={preset.cron}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, cron: preset.cron }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>
                    <CalendarClock width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{preset.label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1 }}>{preset.desc}</span>
                  </span>
                  {selected && <span style={{ color: "var(--kaypal-v3-amber)", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 启用开关 */}
          <div className="mx-card" style={{ marginTop: 14, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>启用这个任务</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 3, lineHeight: 1.5 }}>停用后系统将不再自动执行，随时可以重新开启</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
              style={{
                flexShrink: 0, width: 46, height: 27, borderRadius: 999, padding: 3,
                background: form.enabled ? "var(--kaypal-v3-amber)" : "rgba(142,165,190,.4)",
                display: "flex", alignItems: "center",
                justifyContent: form.enabled ? "flex-end" : "flex-start",
                transition: "all .2s", border: "none",
              }}
            >
              <span style={{ width: 21, height: 21, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
            </button>
          </div>

          {/* 摘要 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12 }}>
            <p style={{ fontSize: 12, color: "var(--mx-muted)", lineHeight: 1.6 }}>
              当前设置：<b style={{ color: "var(--mx-ink)" }}>{taskInfo.label}</b> 将 <b style={{ color: "var(--mx-ink)" }}>{cronToText(form.cron)}</b> 执行一次，状态为
              <b style={{ color: form.enabled ? "var(--kaypal-v3-success)" : "var(--mx-muted)" }}>{form.enabled ? " 已启用" : " 已停用"}</b>
            </p>
          </div>

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => router.push("/schedules")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={saving}
              onClick={() => void handleSubmit()}
            >
              <Save width={15} height={15} />
              {saving ? "正在保存…" : "保存设置"}
            </button>
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
            onClick={() => router.push("/schedules")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {taskInfo.label}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {taskInfo.desc || "设置这个任务的执行频率"}
            </p>
          </div>
          <V2StatusChip tone={form.enabled ? "success" : "muted"}>
            {form.enabled ? "已启用" : "已停用"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 执行频率：人话选项，不是 cron */}
      <V2Section title="多久执行一次？" description="选一个频率就行，不用管技术细节">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FREQ_PRESETS.map((preset) => (
            <V2OptionCard
              key={preset.cron}
              icon={CalendarClock}
              title={preset.label}
              description={preset.desc}
              selected={form.cron === preset.cron}
              onClick={() => setForm((p) => ({ ...p, cron: preset.cron }))}
            />
          ))}
        </div>
      </V2Section>

      {/* 启用开关 */}
      <V2Section>
        <label className="flex items-center justify-between">
          <div>
            <p className="font-medium text-[var(--kaypal-v3-ink)]">启用这个任务</p>
            <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
              停用后系统将不再自动执行，随时可以重新开启
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            className={`flex h-7 w-12 items-center rounded-full p-0.5 transition ${
              form.enabled
                ? "justify-end bg-[var(--kaypal-v3-accent)]"
                : "justify-start bg-[var(--kaypal-v3-border-strong)]"
            }`}
            onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
          >
            <div className="h-6 w-6 rounded-full bg-white shadow" />
          </button>
        </label>
      </V2Section>

      {/* 摘要 */}
      <div className="kaypal-v3-surface p-4">
        <p className="text-sm text-[var(--kaypal-v3-muted)]">
          当前设置：<strong className="text-[var(--kaypal-v3-ink)]">{taskInfo.label}</strong>
          {" "}将 <strong className="text-[var(--kaypal-v3-ink)]">{cronToText(form.cron)}</strong>
          {" "}执行一次，状态为
          <strong className={form.enabled ? "text-[var(--kaypal-v3-success)]" : "text-[var(--kaypal-v3-muted)]"}>
            {form.enabled ? " 已启用" : " 已停用"}
          </strong>
        </p>
      </div>

      {/* 底部操作栏 — 单一主行动 */}
      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/schedules")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={Save} loading={saving} onClick={handleSubmit}>
          {saving ? "正在保存..." : "保存设置"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
