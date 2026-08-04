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

const TASK_TYPE_LABELS: Record<string, { label: string; desc: string }> = {
  "create-articles": { label: "自动生成文章", desc: "按策略定时生成内容" },
  "publish-articles": { label: "自动发布文章", desc: "定时发布已生成的内容" },
  "sync-intelligence": { label: "同步情报数据", desc: "定时拉取最新情报" },
  "check-accounts": { label: "检查账号状态", desc: "定时检查平台账号是否正常" },
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(taskType));

  // 智能默认值：每天 09:00、启用
  const [form, setForm] = useState({
    taskType: taskType || "create-articles",
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
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
