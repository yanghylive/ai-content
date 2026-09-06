"use client";

import { useEffect } from "react";

/**
 * 登录页运行时定制（2026-09-06 从部署产物内联脚本迁入源码）。
 *
 * 两段逻辑原先是 out/login.html 里的内联 <script>，重新构建即丢失：
 *  1) 背景透明化：主 CSS 给登录页铺了深色氛围底，而定制设计要整页铺
 *     人物插画（/brand/login-bg-welcome.png）。这里在 .login-preview
 *     挂载后把各层背景强制透明，并关掉场景容器的背景图，避免叠色。
 *  2) 弹窗兜底：内置浏览器/部分环境拦截 window.open 时返回 null，
 *     设备授权「打开确认页面」会卡死。兜底为同页跳转，保证流程可续。
 *
 * 两段均为幂等、失败静默，不影响任何默认路径。
 */
export default function LoginRuntime() {
  // —— 1) 背景透明化 ——
  useEffect(() => {
    if (typeof document === "undefined") return;

    const apply = () => {
      if (!document.querySelector(".login-preview")) return false;
      document.documentElement.style.setProperty("background", "transparent", "important");
      document.body.style.setProperty("background", "transparent", "important");
      [".bg-background", ".login-preview-stack", ".login-preview-hero"].forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          const e = el as HTMLElement;
          e.style.setProperty("background", "transparent", "important");
          e.style.setProperty("background-color", "transparent", "important");
          e.style.setProperty("--tw-bg-opacity", "0", "important");
        });
      });
      const scene = document.querySelector(".login-preview-hero-scene") as HTMLElement | null;
      if (scene) scene.style.setProperty("background-image", "none", "important");
      return true;
    };

    if (apply()) return;

    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // —— 2) window.open 弹窗拦截兜底 ——
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __popupFallbackInstalled?: number };
    if (w.__popupFallbackInstalled) return;
    w.__popupFallbackInstalled = 1;

    const originalOpen = window.open.bind(window);
    window.open = ((...args: Parameters<typeof window.open>) => {
      let handle: Window | null = null;
      try {
        handle = originalOpen(...args);
      } catch {
        handle = null;
      }
      if (!handle) {
        const url = args[0];
        if (typeof url === "string" && /^https?:/i.test(url)) {
          try {
            window.location.href = url;
          } catch {
            /* 静默 */
          }
          return window;
        }
      }
      return handle;
    }) as typeof window.open;
  }, []);

  return null;
}
