"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_BRIDGE_ACTIONS } from "./actions";
import { LocalBridgeClient } from "./client";
import { toLocalBridgeError, type LocalBridgeError } from "./errors";
import type { BridgeStatus } from "./protocol";
import { api } from "@/lib/api/client";

export type LocalBridgeConnectionStatus = "checking" | "online" | "offline";

export interface UseLocalBridgeResult {
  status: LocalBridgeConnectionStatus;
  version: string | null;
  bridgeStatus: BridgeStatus | null;
  platformCount: number | null;
  error: LocalBridgeError | null;
  refresh: () => Promise<void>;
}

function getApiBase() {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3011/api`;
  }
  return "http://localhost:3011/api";
}

export function useLocalBridge(): UseLocalBridgeResult {
  const clientRef = useRef<LocalBridgeClient | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState<LocalBridgeConnectionStatus>("checking");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [platformCount, setPlatformCount] = useState<number | null>(null);
  const [error, setError] = useState<LocalBridgeError | null>(null);

  const fetchPlatformCount = useCallback(async () => {
    try {
      const caps = await api.get<unknown[]>("/local-bridge/capabilities");
      if (mountedRef.current) setPlatformCount(Array.isArray(caps) ? caps.length : null);
    } catch {
      if (mountedRef.current) setPlatformCount(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("checking");
    setError(null);

    // 先尝试 Local Bridge (Electron postMessage)
    try {
      const client = clientRef.current ?? new LocalBridgeClient();
      clientRef.current = client;
      const result = await client.request<BridgeStatus>(
        LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
        {},
        { timeoutMs: 3_000, signal: controller.signal },
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      setBridgeStatus(result);
      setStatus(result.online === false ? "offline" : "online");
      if (result.online !== false) {
        void fetchPlatformCount();
      }
      return;
    } catch {
      // Local Bridge 不通，降级到直接调 API
    }

    // 降级：直接调后端 API（@Public 路由，不需要登录）
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/local-bridge/status`, {
        headers: { "x-jiuzhang-trace-id": `web-${Date.now()}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current || controller.signal.aborted) return;
      const data = json.data || json;
      const fakeStatus: BridgeStatus = {
        online: data.online !== false,
        status: data.status || "ok",
        service: data.service || "jiuzhang-local-bridge",
        version: data.version || "1.0.0",
        protocolVersion: data.protocolVersion || 1,
        actions: data.actions || [],
        checkedAt: data.checkedAt || new Date().toISOString(),
      };
      setBridgeStatus(fakeStatus);
      setStatus(fakeStatus.online ? "online" : "offline");
      void fetchPlatformCount();
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setBridgeStatus(null);
      setPlatformCount(null);
      setError(toLocalBridgeError(caught));
      setStatus("offline");
    }
  }, [fetchPlatformCount]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [refresh]);

  return {
    status,
    version: bridgeStatus?.version ?? null,
    bridgeStatus,
    platformCount,
    error,
    refresh,
  };
}
