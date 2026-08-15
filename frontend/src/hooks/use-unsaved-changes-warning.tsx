"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "@/components/confirm-modal";

const DEFAULT_MESSAGE = "当前页面还有未保存的修改，确定要离开吗？";

/**
 * 未保存离开警告：拦截站内链接跳转 + 浏览器关闭。
 * 用 ConfirmModal（warning）替代 window.confirm，统一产品内确认弹窗。
 *
 * 用法不变：`useUnsavedChangesWarning(hasUnsavedChanges)`，
 * Modal 通过 portal 直接挂到 document.body，调用方无需额外渲染。
 */
export function useUnsavedChangesWarning(
  hasUnsavedChanges: boolean,
  message = DEFAULT_MESSAGE,
) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search
      ) {
        return;
      }

      // 拦截跳转，弹确认弹窗；确认后手动跳转
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPendingUrl(nextUrl.href);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedChanges, message]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <ConfirmModal
      open={pendingUrl !== null}
      kind="warning"
      title="有未保存的修改"
      description={message}
      confirmText="离开"
      cancelText="留在本页"
      onConfirm={() => {
        const url = pendingUrl;
        setPendingUrl(null);
        if (url) window.location.href = url;
      }}
      onCancel={() => setPendingUrl(null)}
    />,
    document.body,
  );
}
