"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";

/**
 * Web Push 订阅管理（PRD 16.x：移动端 PWA 推送）。
 *
 * 流程：确认安全上下文 + PushManager 支持 → 确保 SW 注册
 * → 请求通知权限 → PushManager.subscribe(vapidKey) → 上报后端。
 *
 * 优雅降级：浏览器不支持 / 非 https / 权限拒绝时 enabled=false，
 * 页面仅显示不可用说明，不影响其他功能。
 */
export type PushSupport = "supported" | "unsupported" | "insecure" | "denied" | "unavailable";

/** base64url → Uint8Array（PushManager.subscribe 的 applicationServerKey 要求） */
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

export function useWebPush() {
  const [enabled, setEnabled] = useState(false);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectSupport = useCallback((): PushSupport => {
    if (typeof window === "undefined") return "unavailable";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    if (!window.isSecureContext) return "insecure";
    return "supported";
  }, []);

  const ensureServiceWorker = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) return registration;
      const fresh = await navigator.serviceWorker.register("/sw.js");
      return fresh;
    } catch {
      return null;
    }
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const baseSupport = detectSupport();
      setSupport(baseSupport);
      if (baseSupport !== "supported") return;

      // 通知权限
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport("denied");
        return;
      }

      // 确保 SW 注册
      const registration = await ensureServiceWorker();
      if (!registration) {
        setError("无法注册 Service Worker，请检查浏览器设置");
        return;
      }

      // 拉 VAPID public key
      const vapidResult = await api.get<{ publicKey: string }>("/push-notifications/vapid-public-key");

      // 订阅（幂等：已订阅直接复用）
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(vapidResult.publicKey),
        });
      }

      // 上报后端
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("订阅信息不完整");
      }
      await api.post("/push-notifications/subscriptions", {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent.slice(0, 200),
      });
      setEnabled(true);
    } catch (err: unknown) {
      setError(toPublicError(err, "开启推送失败"));
    } finally {
      setBusy(false);
    }
  }, [detectSupport, ensureServiceWorker]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await ensureServiceWorker();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        try {
          await api.delete(`/push-notifications/subscriptions?endpoint=${encodeURIComponent(endpoint)}`);
        } catch {
          /* 后端清理失败不影响本地退订 */
        }
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, [ensureServiceWorker]);

  /* 初始化：检查当前订阅状态 */
  useEffect(() => {
    const init = async () => {
      const baseSupport = detectSupport();
      setSupport(baseSupport);
      if (baseSupport !== "supported") return;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) return;
        const subscription = await registration.pushManager.getSubscription();
        setEnabled(Boolean(subscription));
      } catch {
        /* noop */
      }
    };
    void init();
  }, [detectSupport]);

  return { enabled, support, busy, error, enable, disable };
}
