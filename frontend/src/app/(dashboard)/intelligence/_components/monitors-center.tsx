"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  BellRing,
  Loader2,
  Pause,
  Play,
  Plus,
  Zap,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2EmptyState,
  V2Select,
} from "@/components/v2/ui-kit";
import {
  intelligenceApi,
  type IntelligenceMonitorSummary,
} from "@/lib/api/intelligence";
import { toPublicError } from "@/lib/public-error";

const TYPE_LABELS: Record<string, string> = {
  keyword: "关键词",
  account: "账号",
  industry: "行业",
};

const FREQ_PRESETS = [
  { label: "每 30 分钟", value: "*/30 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "每天 12:00", value: "0 12 * * *" },
  { label: "每天 18:00", value: "0 18 * * *" },
] as const;

function freqLabel(schedule?: string): string {
  const preset = FREQ_PRESETS.find((p) => p.value === schedule);
  return preset ? preset.label : schedule || "未设置";
}

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" | "danger" }> = {
  active: { label: "监控中", tone: "success" },
  enabled: { label: "监控中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  archived: { label: "已归档", tone: "muted" },
  error: { label: "异常", tone: "danger" },
};

export function MonitorsCenter() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<IntelligenceMonitorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningDue, setRunningDue] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const fetchMonitors = useCallback(async () => {
    try {
      setLoading(true);
      const data = await intelligenceApi.listMonitors({});
      const list = Array.isArray(data) ? data : (data as { items?: IntelligenceMonitorSummary[]; monitors?: IntelligenceMonitorSummary[] }).items || (data as { monitors?: IntelligenceMonitorSummary[] }).monitors || [];
      setMonitors(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载监控失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMonitors();
  }, [fetchMonitors]);

  const isActive = (m: IntelligenceMonitorSummary) =>
    ["active", "enabled"].includes((m.status || "").toLowerCase());

  const handleToggle = async (monitor: IntelligenceMonitorSummary) => {
    setActingId(monitor.id);
    setError(null);
    try {
      await intelligenceApi.updateMonitor(monitor.id, {
        status: isActive(monitor) ? "paused" : "active",
      });
      await fetchMonitors();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  const handleArchive = async (monitor: IntelligenceMonitorSummary) => {
    setActingId(monitor.id);
    setError(null);
    try {
      await intelligenceApi.archiveMonitor(monitor.id);
      flash("已归档");
      await fetchMonitors();
    } catch (err: unknown) {
      setError(toPublicError(err, "归档失败"));
    } finally {
      setActingId(null);
    }
  };

  const handleRunDue = async () => {
    setRunningDue(true);
    setError(null);
    try {
      const result = await intelligenceApi.runDueMonitors({ limit: 10 });
      const r = result as { executed?: number; succeeded?: number; scanned?: number };
      flash(`到期批量执行完成：执行 ${r.executed ?? 0} 个，成功 ${r.succeeded ?? 0} 个`);
      await fetchMonitors();
    } catch (err: unknown) {
      setError(toPublicError(err, "批量执行失败"));
    } finally {
      setRunningDue(false);
    }
  };

  const handleRunNow = async (monitor: IntelligenceMonitorSummary) => {
    setRunningId(monitor.id);
    setError(null);
    try {
      await intelligenceApi.runMonitor(monitor.id);
      flash("已触发一次监控，新发现会出现在收件箱");
      await fetchMonitors();
    } catch (err: unknown) {
      setError(toPublicError(err, "执行失败，请稍后重试"));
    } finally {
      setRunningId(null);
    }
  };

  const handleFreqChange = async (monitor: IntelligenceMonitorSummary, schedule: string) => {
    setActingId(monitor.id);
    setError(null);
    try {
      await intelligenceApi.updateMonitor(monitor.id, { schedule });
      flash(`频率已改为「${freqLabel(schedule)}」`);
      await fetchMonitors();
    } catch (err: unknown) {
      setError(toPublicError(err, "修改频率失败"));
    } finally {
      setActingId(null);
    }
  };

  const activeCount = monitors.filter(isActive).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/intelligence")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">情报监控</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统自动盯着你关心的事，发现新动态放进收件箱
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <V2GhostButton
              icon={runningDue ? Loader2 : Zap}
              loading={runningDue}
              onClick={() => void handleRunDue()}
            >
              执行到期
            </V2GhostButton>
            <V2StatusChip tone={activeCount > 0 ? "success" : "muted"}>
              {loading ? "加载中" : `${activeCount} 个监控中`}
            </V2StatusChip>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section
        padding={false}
        action={
          <V2PrimaryButton icon={Plus} onClick={() => router.push("/intelligence-v2/monitor-new")}>
            新建监控
          </V2PrimaryButton>
        }
      >
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : monitors.length === 0 ? (
          <V2EmptyState
            icon={BellRing}
            title="还没有监控"
            description="建一个监控，系统帮你盯着关键词、账号或行业"
            action={
              <V2PrimaryButton icon={Plus} onClick={() => router.push("/intelligence-v2/monitor-new")}>
                新建监控
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {monitors.map((monitor) => {
              const active = isActive(monitor);
              const rawStatus = (monitor.status || "").toLowerCase();
              const status =
                STATUS_LABELS[rawStatus] ||
                STATUS_LABELS[active ? "active" : "paused"];
              return (
                <div key={monitor.id} className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="font-medium text-[var(--kaypal-v3-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)] hover:underline"
                          onClick={() =>
                            setExpandedId(expandedId === monitor.id ? null : monitor.id)
                          }
                        >
                          {monitor.keyword || monitor.industry || "未命名监控"}
                        </button>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                        <span className="text-xs text-[var(--kaypal-v3-muted)]">
                          {TYPE_LABELS[monitor.type] || monitor.type}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                        频率：{freqLabel(monitor.schedule)}
                        {monitor.platform ? ` · ${monitor.platform}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {/* cron 快捷切换 */}
                      <div className="w-32">
                        <V2Select
                          value={monitor.schedule || ""}
                          disabled={actingId === monitor.id}
                          onChange={(e) => void handleFreqChange(monitor, e.target.value)}
                        >
                          {FREQ_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                          {!FREQ_PRESETS.some((p) => p.value === monitor.schedule) && (
                            <option value={monitor.schedule}>{monitor.schedule}</option>
                          )}
                        </V2Select>
                      </div>
                      {/* 立即执行 */}
                      <V2GhostButton
                        icon={runningId === monitor.id ? Loader2 : Zap}
                        loading={runningId === monitor.id}
                        onClick={() => void handleRunNow(monitor)}
                      >
                        立即执行
                      </V2GhostButton>
                      {/* 启停 */}
                      <V2GhostButton
                        icon={active ? Pause : Play}
                        loading={actingId === monitor.id}
                        onClick={() => void handleToggle(monitor)}
                      >
                        {active ? "暂停" : "启用"}
                      </V2GhostButton>
                      {/* 归档 */}
                      {rawStatus !== "archived" && (
                        <button
                          type="button"
                          title="归档"
                          className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                          onClick={() => void handleArchive(monitor)}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 详情展开 */}
                  {expandedId === monitor.id && (
                    <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-[var(--kaypal-v3-muted)]">执行频率</p>
                          <p className="mt-0.5 font-medium text-[var(--kaypal-v3-ink)]">
                            {freqLabel(monitor.schedule)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--kaypal-v3-muted)]">积分</p>
                          <p className="mt-0.5 font-medium text-[var(--kaypal-v3-ink)]">
                            {monitor.costLimitPoints ? `上限 ${monitor.costLimitPoints}` : "成功后扣"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--kaypal-v3-muted)]">上次运行</p>
                          <p className="mt-0.5 font-medium text-[var(--kaypal-v3-ink)]">
                            {monitor.lastRunAt
                              ? new Date(monitor.lastRunAt).toLocaleString("zh-CN")
                              : "还没跑过"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--kaypal-v3-muted)]">下次运行</p>
                          <p className="mt-0.5 font-medium text-[var(--kaypal-v3-ink)]">
                            {monitor.nextRunAt
                              ? new Date(monitor.nextRunAt).toLocaleString("zh-CN")
                              : "-"}
                          </p>
                        </div>
                      </div>
                      {monitor.lastError && (
                        <p className="mt-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
                          最近错误:{monitor.lastError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/intelligence")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
