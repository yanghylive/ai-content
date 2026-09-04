"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserPanelState } from "@/types/electron-api";

/**
 * 浏览器面板 dock（工作流阶段 2）：3010 侧的浮动入口。
 * - 仅在 Electron 桌面端（window.electronAPI.browserPanel 存在）渲染；
 * - 展示面板状态（就绪/加载/需接管/阻断/出错）；
 * - 「在浏览器面板打开」剪贴板/当前页快捷入口；阶段 4 起 Agent 事件横幅也挂这里。
 */
const STATUS_LABEL: Record<string, string> = {
  starting: "加载中…",
  ready: "就绪",
  "needs-human": "需要你接管",
  blocked: "已阻断",
  stopped: "已收起",
  error: "出错",
};

export function BrowserPanelDock() {
  const api =
    typeof window !== "undefined" ? window.electronAPI?.browserPanel : undefined;
  const [state, setState] = useState<BrowserPanelState | null>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unmountRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void api.getState().then((result) => {
      if (!disposed && result.success && result.state) setState(result.state);
    });
    const key = api.onState((next) => {
      if (!disposed) setState(next);
    });
    unmountRef.current = () => api.removeOnState(key);
    return () => {
      disposed = true;
      unmountRef.current?.();
    };
  }, [api]);

  const openPanel = useCallback(
    async (url: string) => {
      if (!api) return;
      setError(null);
      const result = await api.open({ url });
      if (!result.success) {
        setError(result.error || "面板打开失败");
      } else if (result.state) {
        setState(result.state);
        setOpen(false);
      }
    },
    [api],
  );

  if (!api) return null;

  const session = state?.session ?? null;
  const status = session && state?.visible ? session.status : null;
  const statusColor =
    status === "ready"
      ? "var(--kaypal-v3-success, #52c41a)"
      : status === "needs-human" || status === "blocked" || status === "error"
        ? "var(--kaypal-v3-danger, #ff4d4f)"
        : status === "starting"
          ? "var(--kaypal-v3-warning, #faad14)"
          : "var(--kaypal-v3-muted, #8a8d98)";

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 64,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
        fontFamily:
          '-apple-system, "PingFang SC", "Segoe UI", sans-serif',
      }}
    >
      {error ? (
        <div
          role="alert"
          style={{
            background: "var(--kaypal-v3-danger-weak, #fff2f0)",
            color: "var(--kaypal-v3-danger, #cf1322)",
            border: "1px solid currentColor",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            maxWidth: 280,
          }}
        >
          {error}
        </div>
      ) : null}
      {open ? (
        <div
          style={{
            width: 280,
            background: "var(--kaypal-v3-card, #ffffff)",
            border: "1px solid var(--kaypal-v3-border, #e5e6eb)",
            borderRadius: 10,
            padding: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            autoFocus
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && inputValue.trim()) {
                const raw = inputValue.trim();
                const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)
                  ? raw
                  : `https://${raw}`;
                void openPanel(url);
              }
            }}
            placeholder="输入网址，回车在右侧面板打开"
            style={{
              height: 30,
              border: "1px solid var(--kaypal-v3-border, #e5e6eb)",
              borderRadius: 6,
              padding: "0 8px",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => void openPanel(window.location.href)}
            style={{
              height: 28,
              border: "none",
              borderRadius: 6,
              background: "var(--kaypal-v3-primary, #722ed1)",
              color: "#fff",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            在面板中打开当前页
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="浏览器面板"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 34,
          padding: "0 12px",
          borderRadius: 17,
          border: "1px solid var(--kaypal-v3-border, #e5e6eb)",
          background: "var(--kaypal-v3-card, #ffffff)",
          color: "var(--kaypal-v3-ink, #1d2129)",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(31,35,41,.10)",
          transition: "box-shadow .15s ease, border-color .15s ease",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--kaypal-v3-accent, #722ed1)"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 9h17M3.5 15h17" />
          <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
        </svg>
        <span>浏览器面板</span>
        {status ? (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              flex: "none",
            }}
            title={STATUS_LABEL[status] || status}
          />
        ) : null}
      </button>
    </div>
  );
}
