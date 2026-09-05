"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/api/auth";

/**
 * 平台登录卡片（2026-09-04 阶段 5）：把「打开平台登录页」从旧引擎
 * browser_navigate 迁到内置面板会话——用户看的页面 = Agent 读的页面四合一。
 *
 * 流程：建 platform 会话（拿 sessionId/tenantId）→ /auth/me（ownerId）→
 * browserPanel.open（面板落登录起点）→ 轮询 login-state 三态引导用户扫码。
 *
 * 不静默降级：非 Electron 环境按钮禁用并说明；面板不可用 400 显式透出原因；
 * 登录态判定是启发式（仅 UI 引导），不作为任何写动作放行依据。
 */

const B = "/api/local-engine/agent-browser";
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_TICKS = 100; // 5 分钟

type Phase = "idle" | "opening" | "waiting" | "logged_in" | "error";

type LoginStateResponse = {
  ok?: boolean;
  platform?: string;
  state?: "logged_in" | "login_prompt" | "unknown";
  url?: string;
};

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
  };
  if (!json.success) throw new Error(json.message || `请求失败（${res.status}）`);
  return json.data as T;
}

export function PlatformLoginCard({
  platform,
  label,
  loginUrl,
}: {
  platform: string;
  label: string;
  loginUrl: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const start = useCallback(async () => {
    setPhase("opening");
    setNote("");
    try {
      // 1) 非 Electron 环境：面板能力不存在，明确说明（不静默降级）
      const electron = window.electronAPI;
      if (!electron?.browserPanel?.open) {
        setPhase("error");
        setNote("请在桌面端使用（浏览器内没有内置面板能力）");
        return;
      }
      // 2) 建 platform 会话（域名白名单自动并入平台域）
      const session = await jfetch<{
        id: string;
        lease?: { tenantId?: string | null };
      }>(`${B}/sessions`, {
        method: "POST",
        body: JSON.stringify({ platform, startUrl: loginUrl }),
      });
      // 3) 当前用户 id（面板 owner 断言用）
      const me = await authApi.me();
      // 4) 打开面板（desktop manager.open 已支持 platform，IPC 透传）
      // 2026-09-05 真机修复：IPC 'browser-panel:open' 返回 { state: publicState() }，
      // 没有 success 字段——旧判断 opened?.success 恒 falsy → 面板明明已打开
      // 却恒报「面板打开失败，请重试」。改为按 state.hasSession 判断。
      const opened = await electron.browserPanel.open({
        url: loginUrl,
        ownerId: me.id,
        tenantId: session.lease?.tenantId ?? undefined,
        platform,
      });
      if (!opened?.state?.hasSession) {
        setPhase("error");
        setNote("面板打开失败，请重试");
        return;
      }
      // 5) 轮询登录态：400（面板未就绪/未开）不终止——透出原因继续等
      setPhase("waiting");
      setNote("等待扫码登录…（扫码后会自动检测）");
      let ticks = 0;
      stopPolling();
      timerRef.current = setInterval(async () => {
        ticks += 1;
        try {
          const ls = await jfetch<LoginStateResponse>(
            `${B}/sessions/${session.id}/login-state`,
          );
          if (ls.state === "logged_in") {
            stopPolling();
            setPhase("logged_in");
            setNote(`${label} 登录成功，登录态已保存在面板会话里`);
            return;
          }
          if (ticks >= POLL_MAX_TICKS) {
            stopPolling();
            setPhase("error");
            setNote("5 分钟内未检测到登录成功，请重新打开再扫码");
          }
        } catch (e) {
          // 400 = 面板未开/桥未就绪：显示原因但继续轮询（用户可能正在开面板）
          setNote(e instanceof Error ? e.message : "登录态查询失败，等待重试…");
          if (ticks >= POLL_MAX_TICKS) {
            stopPolling();
            setPhase("error");
          }
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setPhase("error");
      setNote(e instanceof Error ? e.message : "打开失败，请重试");
    }
  }, [label, loginUrl, platform, stopPolling]);

  const stateDot =
    phase === "logged_in"
      ? "#34d399"
      : phase === "waiting"
        ? "#fbbf24"
        : phase === "error"
          ? "#f87171"
          : "var(--kaypal-v3-muted)";

  const stateText =
    phase === "idle"
      ? "未开始"
      : phase === "opening"
        ? "打开中…"
        : phase === "waiting"
          ? "等待扫码"
          : phase === "logged_in"
            ? "已登录"
            : "失败";

  return (
    <div className="rounded-small border-small border-divider bg-content1 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: stateDot }}
            />
            <span className="truncate text-small font-medium text-default-900">
              {label}
            </span>
            <span className="shrink-0 text-tiny text-default-500">
              {stateText}
            </span>
          </div>
          {note ? (
            <p className="mt-1 line-clamp-2 text-tiny text-default-500">{note}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={phase === "opening" || phase === "logged_in"}
          onClick={() => void start()}
          className="shrink-0 rounded-small border-small border-divider px-3 py-1.5 text-tiny text-default-700 transition-colors hover:bg-default-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "logged_in" ? "已完成" : "在面板中打开"}
        </button>
      </div>
    </div>
  );
}
