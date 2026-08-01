"use client";

import React from "react";
import { useTheme } from "next-themes";
import { ShellIcon } from "@/components/shell/icons";

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
 * 助手页 = 白龙马 Brain UI 容器（iframe 嵌入本地服务）。
 * 服务在跑 → 完整脑图/语音界面；没在跑 → 一键启动引导。
 */
export default function AgentPage() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // 脑图统一原生 midnight（金蓝高级感）：
  // 浅色系统里嵌一块深色科技屏，比强行浅色化高级得多
  const blmTheme = "midnight";
  const BLM_ASSET_VERSION = "20260730g";
  const blmSrc = `${BLM_URL}?theme=${blmTheme}&v=${BLM_ASSET_VERSION}`;
  const [service, setService] = React.useState<ServiceState>("checking");
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [frameKey, setFrameKey] = React.useState(0);
  const isElectron = Boolean(getBridge());

  /* 探活：no-cors GET 能绕过 CORS 判断服务是否在线 */
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
    const timer = setInterval(() => void probe(), 15000);
    return () => clearInterval(timer);
  }, [probe]);

  /* 启动白龙马（Electron 桥） */
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
      // 等服务真正就绪（最多 30 秒）
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (await probe()) break;
      }
      setFrameKey((k) => k + 1); // 强制 iframe 重载
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="kx-chat-view" style={{ maxWidth: "none", padding: "14px 24px 20px", flex: "1 0 auto", display: "flex", flexDirection: "column", minHeight: 0, height: "auto" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          background: "var(--kx-card)",
          border: "1px solid var(--kx-border)",
          borderRadius: "var(--kx-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(42, 36, 56, 0.05), 0 3px 14px rgba(90, 70, 160, 0.08)",
        }}
      >
        {/* 顶部状态条 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            borderBottom: "1px solid var(--kx-border)",
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
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>白龙马</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              color: service === "online" ? "var(--kx-success)" : "var(--kx-muted)",
              fontWeight: 700,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  service === "online"
                    ? "var(--kx-success)"
                    : service === "checking"
                      ? "var(--kx-amber, #c26a06)"
                      : "var(--kx-muted)",
              }}
            />
            {service === "online" ? "在线" : service === "checking" ? "检查中" : "离线"}
          </span>
          <div style={{ flex: 1 }} />
          {service === "online" && (
            <>
              <button
                type="button"
                className="kx-btn-sm kx-btn-sm-ghost"
                onClick={() => setFrameKey((k) => k + 1)}
              >
                刷新界面
              </button>
              <button
                type="button"
                className="kx-btn-sm kx-btn-sm-ghost"
                onClick={() => window.open(blmSrc, "_blank")}
              >
                独立窗口打开 ↗
              </button>
            </>
          )}
        </div>

        {/* 主体：在线 = iframe，离线 = 启动引导 */}
        {service === "online" ? (
          <iframe
            key={`${frameKey}-${blmTheme}`}
            src={blmSrc}
            title="白龙马"
            style={{ flex: 1, width: "100%", border: "none", background: blmTheme === "midnight" ? "#0b0e14" : "#f5f7f9" }}
            allow="microphone; autoplay; clipboard-read; clipboard-write"
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: 24,
            }}
          >
            <div
              className="kx-msg-ava"
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: "var(--kx-accent-soft)",
                color: "var(--kx-accent-ink)",
              }}
            >
              <ShellIcon name="mic" />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>
                {service === "checking" ? "正在寻找白龙马…" : "白龙马没在跑"}
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--kx-muted)", maxWidth: 420 }}>
                {service === "checking"
                  ? "稍等，正在连接本地语音服务"
                  : "白龙马是住在这台电脑里的 AI Agent——脑图记忆、语音对话、工具执行。启动后这个页面就是它的完整界面。"}
              </div>
            </div>
            {service === "offline" && (
              <>
                {isElectron ? (
                  <button
                    type="button"
                    className="kx-btn-sm kx-btn-sm-primary"
                    style={{ padding: "10px 22px", fontSize: 14 }}
                    disabled={starting}
                    onClick={() => void startService()}
                  >
                    {starting ? "正在启动白龙马…" : "启动白龙马"}
                  </button>
                ) : (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--kx-muted)",
                      background: "var(--kx-paper-soft)",
                      border: "1px solid var(--kx-border)",
                      borderRadius: 10,
                      padding: "10px 16px",
                      textAlign: "center",
                      lineHeight: 1.8,
                    }}
                  >
                    在桌面应用里打开这个页面可以一键启动；<br />
                    或手动启动：
                    <code style={{ fontSize: 11.5 }}>cd ~/Documents/New\ project/BaiLongma && npm run start:backend</code>
                  </div>
                )}
                {error && (
                  <div style={{ fontSize: 12.5, color: "var(--kx-danger, #dc2626)" }}>{error}</div>
                )}
              </>
            )}
            {service === "checking" && (
              <span className="kx-typing"><i /><i /><i /></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
