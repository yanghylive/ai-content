"use client";

import React from "react";
import { ShellIcon } from "@/components/shell/icons";
import { AgentConversationWorkbench } from "../agent-workbench/agent-conversation-workbench";

const BLM_URL = "http://127.0.0.1:3721/";

interface BaiLongmaBridge {
  status(): Promise<{ serviceRunning: boolean; ready: boolean; message?: string }>;
  start(): Promise<{ ok?: boolean; message?: string; error?: string | null }>;
  open(): Promise<{ ok?: boolean }>;
}

function getBridge(): BaiLongmaBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { electronAPI?: { baiLongma?: BaiLongmaBridge } }).electronAPI?.baiLongma || null;
}

type ServiceState = "checking" | "online" | "offline";

/**
 * 助手页 = 云端 AI 助手（AgentS 对话系统，与手机 App 同一套技术）。
 * 会话、模型、执行与手机完全一致；白龙马本地脑图降级为可选入口。
 */
export default function AgentPage() {
  const blmTheme = "midnight";
  const BLM_ASSET_VERSION = "20260730g";
  const blmSrc = `${BLM_URL}?theme=${blmTheme}&v=${BLM_ASSET_VERSION}`;
  const [service, setService] = React.useState<ServiceState>("checking");
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isElectron = Boolean(getBridge());

  /* 探活：no-cors GET 能绕过 CORS 判断服务是否在线（仅用于白龙马入口按钮） */
  const probe = React.useCallback(async () => {
    try {
      await fetch(BLM_URL, { mode: "no-cors", cache: "no-store" });
      setService("online");
      return true;
    } catch {
      setService("offline");
      return false;
    }
  }, []);

  React.useEffect(() => {
    void probe();
    const timer = setInterval(() => void probe(), 30000);
    return () => clearInterval(timer);
  }, [probe]);

  const startService = async () => {
    const bridge = getBridge();
    setStarting(true);
    setError(null);
    try {
      if (bridge) {
        const result = await bridge.start();
        if (result.error) {
          setError(result.error);
          setStarting(false);
          return;
        }
      }
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await probe()) break;
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="kx-chat-view" style={{ maxWidth: "none", padding: "14px 24px 20px", flex: "1 0 auto", display: "flex", flexDirection: "column", minHeight: 0, height: "auto" }}>
      {/* 顶部状态条：云端 AI 助手 + 白龙马可选入口 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderBottom: "1px solid var(--kx-border)",
          background: "var(--kx-card)",
        }}
      >
        <div
          className="kx-msg-ava"
          style={{
            width: 28,
            height: 28,
            background: "var(--kx-accent-soft)",
            color: "var(--kx-accent-ink)",
          }}
        >
          <ShellIcon name="mic" />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>AI 助手</span>
        <span style={{ fontSize: 11.5, color: "var(--kx-muted)" }}>
          云端对话 · 与手机 App 同一套智能体
        </span>
        <div style={{ flex: 1 }} />
        {service === "online" && (
          <button
            type="button"
            className="kx-btn-sm kx-btn-sm-ghost"
            onClick={() => window.open(blmSrc, "_blank")}
          >
            白龙马脑图 ↗
          </button>
        )}
        {service === "offline" && isElectron && (
          <button
            type="button"
            className="kx-btn-sm kx-btn-sm-ghost"
            disabled={starting}
            onClick={() => void startService()}
          >
            {starting ? "正在启动白龙马…" : "启动白龙马"}
          </button>
        )}
      </div>

      {/* 主体：云端 AI 助手（AgentS 对话，手机同款） */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          marginTop: 14,
          background: "var(--kx-card)",
          border: "1px solid var(--kx-border)",
          borderRadius: "var(--kx-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(42, 36, 56, 0.05), 0 3px 14px rgba(90, 70, 160, 0.08)",
        }}
      >
        <AgentConversationWorkbench />
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: "var(--kx-danger, #dc2626)", marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
