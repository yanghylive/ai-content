"use client";

import React, { useEffect, useState } from "react";

/**
 * PWA 添加到主屏幕引导（APP 形态前的安装提示）
 *
 * - Android Chrome：捕获 beforeinstallprompt 触发原生安装
 * - iOS Safari：提示「分享 → 添加到主屏幕」
 * - 已 standalone 运行 / 用户关闭后不再显示（localStorage 记住）
 */
const PWA_DISMISS_KEY = "jiuzhang.pwaDismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean })
    ?.standalone;
  return Boolean(standalone || iosStandalone);
}

export function PwaInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const deferredPromptRef = React.useRef<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(PWA_DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(isIos);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPromptRef.current = event as unknown as typeof deferredPromptRef.current;
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    // 非 Android（无 beforeinstallprompt）也显示 iOS/桌面引导
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(PWA_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    const deferred = deferredPromptRef.current;
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferredPromptRef.current = null;
      setVisible(false);
      return;
    }
    // iOS：无原生安装，引导用户手动添加
    setIos(true);
    setVisible(false);
    try {
      localStorage.setItem("jiuzhang.pwaIosHint", "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 76,
        zIndex: 90,
        borderRadius: 16,
        padding: "12px 14px",
        background: "rgba(23, 50, 91, .96)",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(15, 35, 70, .28)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
          安装 JIUZHANG AI
        </p>
        <p style={{ fontSize: 11, opacity: .85, margin: "2px 0 0", lineHeight: 1.4 }}>
          {ios
            ? "Safari 点「分享」→「添加到主屏幕」，像 App 一样用"
            : "添加到主屏幕，随时打开、收通知"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void install()}
        style={{
          background: "#f4bb67",
          color: "#17325b",
          border: "none",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {ios ? "知道了" : "安装"}
      </button>
      <button
        type="button"
        aria-label="关闭"
        onClick={dismiss}
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,.7)",
          fontSize: 16,
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
