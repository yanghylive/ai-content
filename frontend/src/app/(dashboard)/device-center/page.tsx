"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  listDevices,
  listActiveLeases,
  listExecutorTasks,
  type MobileDeviceInfo,
  type ExecutorLeaseView,
  type ExecutorTaskView,
} from "@/lib/api/mobile-executor";

/** 设备中心：设备在线状态 / 账号租约 / 最近任务（PRD §6.2） */
export default function DeviceCenterPage() {
  const isMobile = useIsMobile();
  const [devices, setDevices] = useState<MobileDeviceInfo[]>([]);
  const [leases, setLeases] = useState<ExecutorLeaseView[]>([]);
  const [tasks, setTasks] = useState<ExecutorTaskView[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

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

  const statusColor = (status: string) =>
    status === "online" ? "#059669" : "#dc2626";

  return (
    <div style={{ minHeight: "100dvh", paddingBottom: 90, background: isMobile ? undefined : "#f1f5f9" }}>
      <div className="mx-px" style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "12px 16px 28px" : "28px 24px" }}>
        <div className="mx-header">
          <div className="mx-page-title">设备中心</div>
          <div className="mx-page-sub">手机设备在线状态 · 账号租约 · 执行任务（每 30s 自动刷新）</div>
        </div>

        {error && (
          <div className="mx-card" style={{ marginTop: 12, padding: 12, color: "#dc2626", fontSize: 13 }}>
            ⚠️ {error} <button onClick={() => void load()} style={{ marginLeft: 8, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>重试</button>
          </div>
        )}

        {/* 统计 */}
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

        {/* 设备列表 */}
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

        {/* 活跃租约 */}
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

        {/* 最近任务 */}
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
                const needsAttention = t.status === "failed" || t.status === "unknown";
                return (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: needsAttention ? "#fef2f2" : "#f8fafc", border: `1px solid ${needsAttention ? "#fecaca" : "#e2e8f0"}` }}>
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
                      {needsAttention && (
                        <Link href="/mai-ui" style={{ fontSize: 11.5, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>
                          去 MAI-UI 重试 →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function taskStatusColor(status: string): string {
  switch (status) {
    case "done": return "#059669";
    case "failed": return "#dc2626";
    case "unknown": return "#d97706";
    case "running": case "claimed": return "#2563eb";
    case "cancelled": return "#64748b";
    default: return "#d97706";
  }
}

function taskStatusBg(status: string): string {
  switch (status) {
    case "done": return "#ecfdf5";
    case "failed": return "#fef2f2";
    case "unknown": return "#fffbeb";
    case "running": case "claimed": return "#eff6ff";
    case "cancelled": return "#f1f5f9";
    default: return "#fffbeb";
  }
}

/** 从任务 result 提取失败原因 */
function taskError(t: { result?: unknown }): string {
  const r = t.result as { error?: string; message?: string } | null | undefined;
  if (!r) return "";
  return r.error || r.message || "";
}
