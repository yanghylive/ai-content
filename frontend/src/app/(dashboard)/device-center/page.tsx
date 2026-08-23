"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  listDevices,
  listActiveLeases,
  listExecutorTasks,
  getTaskRun,
  cancelTask,
  type MobileDeviceInfo,
  type ExecutorLeaseView,
  type ExecutorTaskView,
  type ExecutorRunView,
} from "@/lib/api/mobile-executor";

/** 设备中心：设备在线状态 / 账号租约 / 最近任务（PRD §6.2）
 *  B0 亮色化（2026-08-23）：桌面端从 mx-* 深色沉浸迁移到 kx 亮色品牌体系
 *  （kx-view 容器 + kaypal-v3-panel 卡片 + 全量 token 颜色）；移动端保留 mx 分支。 */

type CommonProps = {
  devices: MobileDeviceInfo[];
  leases: ExecutorLeaseView[];
  tasks: ExecutorTaskView[];
  error: string;
  now: number;
  expandedTaskId: string | null;
  taskRun: ExecutorRunView | null;
  cancelingTaskId: string | null;
  onReload: () => void;
  onExpandTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
};

export default function DeviceCenterPage() {
  const isMobile = useIsMobile();
  const [devices, setDevices] = useState<MobileDeviceInfo[]>([]);
  const [leases, setLeases] = useState<ExecutorLeaseView[]>([]);
  const [tasks, setTasks] = useState<ExecutorTaskView[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskRun, setTaskRun] = useState<ExecutorRunView | null>(null);
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [d, l, t] = await Promise.all([
        listDevices(),
        listActiveLeases(),
        listExecutorTasks(10),
      ]);
      setDevices(d ?? []);
      setLeases(l ?? []);
      setTasks(t ?? []);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const heartbeatAge = (ts: string | null, nowMs: number): string => {
    if (!ts) return "从未心跳";
    const ms = nowMs - new Date(ts).getTime();
    const min = Math.floor(ms / 60_000);
    if (ms < 60_000) return `${Math.floor(ms / 1000)} 秒前`;
    if (min < 60) return `${min} 分钟前`;
    return `${Math.floor(min / 60)} 小时前`;
  };

  /** 展开/收起任务执行进度（P2-26 检查点 UI） */
  const handleExpandTask = useCallback(async (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      setTaskRun(null);
      return;
    }
    setExpandedTaskId(taskId);
    setTaskRun(null);
    try {
      const run = await getTaskRun(taskId);
      setTaskRun(run);
    } catch {
      setTaskRun(null);
    }
  }, [expandedTaskId]);

  /** 取消任务（unknown 心跳超时待人工处理 / queued / leasing） */
  const handleCancelTask = useCallback(async (taskId: string) => {
    setCancelingTaskId(taskId);
    try {
      await cancelTask(taskId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelingTaskId(null);
    }
  }, [load]);

  const common: CommonProps = {
    devices, leases, tasks, error, now,
    expandedTaskId, taskRun, cancelingTaskId,
    onReload: () => void load(),
    onExpandTask: (id) => void handleExpandTask(id),
    onCancelTask: (id) => void handleCancelTask(id),
  };

  return isMobile ? <MobileDeviceCenter {...common} /> : <DesktopDeviceCenter {...common} heartbeatAge={heartbeatAge} />;
}

/* ================= 桌面端：kx 亮色品牌体系 ================= */

function DesktopDeviceCenter(props: CommonProps & { heartbeatAge: (ts: string | null, nowMs: number) => string }) {
  const { devices, leases, tasks, error, now, expandedTaskId, taskRun, cancelingTaskId, onReload, onExpandTask, onCancelTask, heartbeatAge } = props;

  return (
    <div className="kx-view flex flex-col gap-[var(--space-card)]">
      {/* 页头（26/800 规范标题） */}
      <header className="kaypal-v3-panel p-6">
        <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">设备中心</h1>
        <p className="kx-greet-sub text-[var(--kaypal-v3-muted)]">
          手机设备在线状态 · 账号租约 · 执行任务（每 30s 自动刷新）
        </p>
      </header>

      {error && (
        <div className="kaypal-v3-panel p-4 text-[13px]" style={{ color: "var(--kaypal-v3-danger)" }}>
          ⚠️ {error}{" "}
          <button onClick={onReload} className="ml-2 cursor-pointer border-none bg-none text-[13px]" style={{ color: "var(--kaypal-v3-cobalt)" }}>
            重试
          </button>
        </div>
      )}

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-[var(--space-card)]">
        {[
          { label: "设备", value: devices.length, color: "var(--kaypal-v3-cobalt)" },
          { label: "在线", value: devices.filter((d) => d.status === "online").length, color: "var(--kaypal-v3-success)" },
          { label: "活跃租约", value: leases.length, color: "var(--kaypal-v3-amber)" },
          { label: "今日任务", value: tasks.filter((t) => new Date(t.createdAt).getTime() > now - 86400000).length, color: "var(--kaypal-v3-purple)" },
        ].map((s) => (
          <div key={s.label} className="kaypal-v3-panel p-4 text-center">
            <div className="text-[20px] font-extrabold" style={{ color: s.color }}>{s.value}</div>
            <div className="mt-0.5 text-[12px]" style={{ color: "var(--kaypal-v3-muted)" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 设备列表 */}
      <div className="kaypal-v3-panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-semibold" style={{ color: "var(--kaypal-v3-ink)" }}>设备</span>
          <Link href="/mai-ui" className="text-[12px] no-underline" style={{ color: "var(--kaypal-v3-purple)" }}>
            去 MAI-UI 工作台 →
          </Link>
        </div>
        {devices.length === 0 ? (
          <div className="py-4 text-center text-[13px]" style={{ color: "var(--kaypal-v3-muted)" }}>
            暂无注册设备 —— 手机端安装 App 后自动注册
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-[10px] border p-3"
                style={{ borderColor: "var(--kaypal-v3-border)", background: "var(--kaypal-v3-paper-muted)" }}
              >
                <div>
                  <div className="text-[13px] font-semibold" style={{ color: "var(--kaypal-v3-ink)" }}>
                    {d.deviceName}
                    <span className="ml-1.5 text-[11px]" style={{ color: "var(--kaypal-v3-muted)" }}>{d.platform}</span>
                  </div>
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--kaypal-v3-muted)" }}>
                    心跳 {heartbeatAge(d.lastHeartbeatAt, now)} · {d.id.slice(-6)}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: statusColor(d.status) }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor(d.status) }} />
                  {d.status === "online" ? "在线" : "离线"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 活跃租约 */}
      <div className="kaypal-v3-panel p-5">
        <div className="mb-3 text-[14px] font-semibold" style={{ color: "var(--kaypal-v3-ink)" }}>
          账号租约 <span className="text-[11px]" style={{ color: "var(--kaypal-v3-muted)" }}>（同账号同时仅一个外发租约）</span>
        </div>
        {leases.length === 0 ? (
          <div className="py-3 text-center text-[13px]" style={{ color: "var(--kaypal-v3-muted)" }}>
            当前无活跃租约 —— 账号互斥保障生效中
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {leases.map((l) => (
              <div key={l.id} className="rounded-[10px] border p-3" style={{ borderColor: "var(--kaypal-v3-amber-soft)", background: "var(--kaypal-v3-amber-soft)" }}>
                <div className="text-[13px] font-semibold" style={{ color: "var(--kaypal-v3-amber)" }}>账号 {l.accountId}</div>
                <div className="mt-1 text-[12px]" style={{ color: "var(--kaypal-v3-amber)" }}>
                  设备 {l.deviceId.slice(-6)} · 任务 {l.taskId.slice(-6)} · 过期于 {new Date(l.expiresAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 最近任务 */}
      <div className="kaypal-v3-panel p-5">
        <div className="mb-3 text-[14px] font-semibold" style={{ color: "var(--kaypal-v3-ink)" }}>最近任务</div>
        {tasks.length === 0 ? (
          <div className="py-3 text-center text-[13px]" style={{ color: "var(--kaypal-v3-muted)" }}>
            暂无任务记录
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {tasks.map((t) => {
              const err = taskError(t);
              const needsAttention = t.status === "failed" || t.status === "unknown" || t.status === "awaiting_approval";
              const expanded = expandedTaskId === t.id;
              return (
                <div key={t.id} className="rounded-[8px] border p-2.5" style={{ background: needsAttention ? "var(--kaypal-v3-danger-soft)" : "var(--kaypal-v3-paper-muted)", borderColor: needsAttention ? "var(--kaypal-v3-danger-soft)" : "var(--kaypal-v3-border)" }}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold" style={{ color: "var(--kaypal-v3-ink)" }}>
                        {t.type === "custom" ? "MAI-UI 任务" : "发布任务"} · {t.id.slice(-6)}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: "var(--kaypal-v3-muted)" }}>
                        {new Date(t.createdAt).toLocaleString()}
                      </div>
                      {needsAttention && err && (
                        <div className="mt-0.5 break-all text-[11px]" style={{ color: "var(--kaypal-v3-danger)" }}>
                          {t.status === "unknown" ? "⚠️ 结果不确定：" : "失败原因："}{err}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-[6px] px-2 py-0.5 text-[11px] font-bold" style={{ color: taskStatusColor(t.status), background: taskStatusBg(t.status) }}>
                        {t.status}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onExpandTask(t.id)}
                          className="cursor-pointer border-none bg-none p-0 text-[12px]"
                          style={{ color: "var(--kaypal-v3-purple)" }}
                        >
                          {expanded ? "收起进度" : "执行进度"}
                        </button>
                        {(t.status === "unknown" || t.status === "awaiting_approval") && (
                          <button
                            onClick={() => onCancelTask(t.id)}
                            disabled={cancelingTaskId === t.id}
                            className="border-none bg-none p-0 text-[12px]"
                            style={{ color: "var(--kaypal-v3-danger)", cursor: cancelingTaskId === t.id ? "default" : "pointer", opacity: cancelingTaskId === t.id ? 0.5 : 1 }}
                          >
                            {cancelingTaskId === t.id ? "取消中…" : "取消"}
                          </button>
                        )}
                        {needsAttention && (
                          <Link href="/mai-ui" className="whitespace-nowrap text-[12px] no-underline" style={{ color: "var(--kaypal-v3-cobalt)" }}>
                            去 MAI-UI 重试 →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* P2-26 检查点：展开显示执行步骤 */}
                  {expanded && (
                    <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--kaypal-v3-border)" }}>
                      {taskRun && taskRun.taskId === t.id ? (
                        <RunSteps run={taskRun} />
                      ) : (
                        <div className="py-1.5 text-center text-[12px]" style={{ color: "var(--kaypal-v3-muted)" }}>
                          {taskRun === null ? "该任务无执行会话记录" : "加载中…"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= 移动端：保留 mx 分支（mobile.css 定义） ================= */

function MobileDeviceCenter(props: CommonProps) {
  const { devices, leases, tasks, error, now, expandedTaskId, taskRun, cancelingTaskId, onReload, onExpandTask, onCancelTask } = props;

  const heartbeatAge = (ts: string | null, nowMs: number): string => {
    if (!ts) return "从未心跳";
    const ms = nowMs - new Date(ts).getTime();
    const min = Math.floor(ms / 60_000);
    if (ms < 60_000) return `${Math.floor(ms / 1000)} 秒前`;
    if (min < 60) return `${min} 分钟前`;
    return `${Math.floor(min / 60)} 小时前`;
  };

  return (
    <div className="mx-px" style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 28px" }}>
      <div className="mx-header">
        <div className="mx-page-title">设备中心</div>
        <div className="mx-page-sub">手机设备在线状态 · 账号租约 · 执行任务（每 30s 自动刷新）</div>
      </div>

      {error && (
        <div className="mx-card" style={{ marginTop: 12, padding: 12, color: "#dc2626", fontSize: 13 }}>
          ⚠️ {error} <button onClick={onReload} style={{ marginLeft: 8, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>重试</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {[
          { label: "设备", value: devices.length, color: "#2563eb" },
          { label: "在线", value: devices.filter((d) => d.status === "online").length, color: "#059669" },
          { label: "活跃租约", value: leases.length, color: "#d97706" },
          { label: "今日任务", value: tasks.filter((t) => new Date(t.createdAt).getTime() > now - 86400000).length, color: "#7c3aed" },
        ].map((s) => (
          <div key={s.label} className="mx-card" style={{ flex: 1, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)" }}>设备</span>
          <Link href="/mai-ui" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none" }}>
            去 MAI-UI 工作台 →
          </Link>
        </div>
        {devices.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "16px 0", textAlign: "center" }}>
            暂无注册设备 —— 手机端安装 App 后自动注册
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {devices.map((d) => (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mx-ink)" }}>
                    {d.deviceName}
                    <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>{d.platform}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>
                    心跳 {heartbeatAge(d.lastHeartbeatAt, now)} · {d.id.slice(-6)}
                  </div>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 700,
                    color: statusColor(d.status),
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(d.status) }} />
                  {d.status === "online" ? "在线" : "离线"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 10 }}>
          账号租约 <span style={{ fontSize: 11, color: "#94a3b8" }}>（同账号同时仅一个外发租约）</span>
        </div>
        {leases.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "12px 0", textAlign: "center" }}>
            当前无活跃租约 —— 账号互斥保障生效中
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {leases.map((l) => (
              <div key={l.id} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #fed7aa", background: "#fffbeb" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>账号 {l.accountId}</div>
                <div style={{ fontSize: 11.5, color: "#a16207", marginTop: 3 }}>
                  设备 {l.deviceId.slice(-6)} · 任务 {l.taskId.slice(-6)} · 过期于 {new Date(l.expiresAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 10 }}>最近任务</div>
        {tasks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "12px 0", textAlign: "center" }}>
            暂无任务记录
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((t) => {
              const err = taskError(t);
              const needsAttention = t.status === "failed" || t.status === "unknown" || t.status === "awaiting_approval";
              const expanded = expandedTaskId === t.id;
              return (
                <div key={t.id} style={{ padding: "8px 10px", borderRadius: 8, background: needsAttention ? "#fef2f2" : "#f8fafc", border: `1px solid ${needsAttention ? "#fecaca" : "#e2e8f0"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mx-ink)" }}>
                        {t.type === "custom" ? "MAI-UI 任务" : "发布任务"} · {t.id.slice(-6)}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                        {new Date(t.createdAt).toLocaleString()}
                      </div>
                      {needsAttention && err && (
                        <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2, wordBreak: "break-all" }}>
                          {t.status === "unknown" ? "⚠️ 结果不确定：" : "失败原因："}{err}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: taskStatusColor(t.status), background: taskStatusBg(t.status), padding: "3px 8px", borderRadius: 6 }}>
                        {t.status}
                      </span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          onClick={() => onExpandTask(t.id)}
                          style={{ fontSize: 11.5, color: "#7c3aed", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          {expanded ? "收起进度" : "执行进度"}
                        </button>
                        {(t.status === "unknown" || t.status === "awaiting_approval") && (
                          <button
                            onClick={() => onCancelTask(t.id)}
                            disabled={cancelingTaskId === t.id}
                            style={{ fontSize: 11.5, color: "#dc2626", background: "none", border: "none", cursor: cancelingTaskId === t.id ? "default" : "pointer", padding: 0, opacity: cancelingTaskId === t.id ? 0.5 : 1 }}
                          >
                            {cancelingTaskId === t.id ? "取消中…" : "取消"}
                          </button>
                        )}
                        {needsAttention && (
                          <Link href="/mai-ui" style={{ fontSize: 11.5, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>
                            去 MAI-UI 重试 →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 8, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
                      {taskRun && taskRun.taskId === t.id ? (
                        <RunSteps run={taskRun} />
                      ) : (
                        <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "6px 0", textAlign: "center" }}>
                          {taskRun === null ? "该任务无执行会话记录" : "加载中…"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(status: string) {
  return status === "online" ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-danger)";
}

function taskStatusColor(status: string): string {
  switch (status) {
    case "done": case "completed": return "var(--kaypal-v3-success)";
    case "failed": return "var(--kaypal-v3-danger)";
    case "unknown": case "awaiting_approval": case "observing": return "var(--kaypal-v3-amber)";
    case "running": case "executing": case "verifying": return "var(--kaypal-v3-cobalt)";
    case "claimed": case "leasing": case "preparing": return "#0891b2";
    case "crm_sync": return "var(--kaypal-v3-purple)";
    case "cancelled": return "var(--kaypal-v3-muted)";
    default: return "var(--kaypal-v3-soft-ink)";
  }
}

function taskStatusBg(status: string): string {
  switch (status) {
    case "done": case "completed": return "var(--kaypal-v3-success-soft)";
    case "failed": return "var(--kaypal-v3-danger-soft)";
    case "unknown": case "awaiting_approval": case "observing": return "var(--kaypal-v3-amber-soft)";
    case "running": case "executing": case "verifying": return "var(--kaypal-v3-blue-soft)";
    case "claimed": case "leasing": case "preparing": return "#ecfeff";
    case "crm_sync": return "var(--kaypal-v3-purple-soft)";
    case "cancelled": return "var(--kaypal-v3-paper-muted)";
    default: return "var(--kaypal-v3-paper-muted)";
  }
}

/** 从任务 result 提取失败原因 */
function taskError(t: { result?: unknown }): string {
  const r = t.result as { error?: string; message?: string } | null | undefined;
  if (!r) return "";
  return r.error || r.message || "";
}

/** 步骤状态颜色 */
function stepStatusColor(status: string): string {
  switch (status) {
    case "done": return "var(--kaypal-v3-success)";
    case "failed": return "var(--kaypal-v3-danger)";
    case "running": return "var(--kaypal-v3-cobalt)";
    case "pending": case "unknown": return "var(--kaypal-v3-amber)";
    case "skipped": return "var(--kaypal-v3-muted)";
    default: return "var(--kaypal-v3-muted)";
  }
}

/** P2-26 检查点 UI：执行会话步骤进度（token 化） */
function RunSteps({ run }: { run: ExecutorRunView }) {
  if (run.steps.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", padding: "6px 0", textAlign: "center" }}>
        暂无步骤记录（会话状态 {run.status}）
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginBottom: 6 }}>
        断点 checkpoint：{run.checkpoint || "—"} · 会话 {run.status}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {run.steps.map((s) => (
          <div key={s.stepIndex} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 22, textAlign: "right", color: "var(--kaypal-v3-muted)", flexShrink: 0 }}>#{s.stepIndex}</span>
            <span style={{ width: 64, color: "var(--kaypal-v3-ink)", flexShrink: 0 }}>{s.type}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: stepStatusColor(s.status),
                background: "color-mix(in srgb, currentColor 12%, transparent)",
                padding: "1px 7px",
                borderRadius: 5,
              }}
            >
              {s.status}
            </span>
            <span style={{ color: "var(--kaypal-v3-muted)", fontSize: 11, marginLeft: "auto" }}>
              {new Date(s.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
