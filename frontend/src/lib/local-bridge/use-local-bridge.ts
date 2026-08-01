"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_BRIDGE_ACTIONS } from "./actions";
import { LocalBridgeClient } from "./client";
import { toLocalBridgeError, type LocalBridgeError } from "./errors";
import type { BridgeStatus } from "./protocol";

export type LocalBridgeConnectionStatus = "checking" | "online" | "offline";

export interface UseLocalBridgeResult {
  status: LocalBridgeConnectionStatus;
  version: string | null;
  bridgeStatus: BridgeStatus | null;
  platformCount: number | null;
  error: LocalBridgeError | null;
  refresh: () => Promise<void>;
}

export function useLocalBridge(): UseLocalBridgeResult {
  const clientRef = useRef<LocalBridgeClient | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState<LocalBridgeConnectionStatus>("checking");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [platformCount, setPlatformCount] = useState<number | null>(null);
  const [error, setError] = useState<LocalBridgeError | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("checking");
    setError(null);

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

      // 在线时获取平台数
      if (result.online !== false) {
        try {
          const caps = await client.request<unknown[]>(
            LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES,
            {},
            { timeoutMs: 3_000 },
          );
          if (mountedRef.current) setPlatformCount(Array.isArray(caps) ? caps.length : null);
        } catch {
          if (mountedRef.current) setPlatformCount(null);
        }
      }
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setBridgeStatus(null);
      setPlatformCount(null);
      setError(toLocalBridgeError(caught));
      setStatus("offline");
    }
  }, []);

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
