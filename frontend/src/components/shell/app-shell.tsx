"use client";
/* eslint-disable @next/next/no-img-element */

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ShellIcon, type ShellIconName } from "./icons";
import { CommandPalette } from "./command-palette";
import { Ticker, type TickerItem } from "./tickers";
import { localEngineApi } from "@/lib/api/local-engine";
import { autoUploadApi, type AutoUploadPublishTask } from "@/lib/api/auto-upload";
import {
  autoUploadAccountIdentityKey,
  dedupeAutoUploadAccounts,
  isAutoUploadAccountLoggedIn,
} from "@/lib/auto-upload-account-state";
import { materialsApi } from "@/lib/api/materials";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { MobileShell } from "./mobile-shell";
import { PwaInstallBanner } from "./pwa-install-banner";
import { AiAssistant } from "./ai-assistant";
import "./shell.css";

/* ---------- 场景定义（顺序 = 快捷键 1-6） ---------- */
const SCENES: Array<{
  key: string;
  href: string;
  label: string;
  icon: ShellIconName;
}> = [
  { key: "today", href: "/today", label: "今天", icon: "home" },
  { key: "agent", href: "/agent", label: "助手", icon: "cpu" },
  { key: "customer", href: "/customer", label: "客户", icon: "users" },
  { key: "content", href: "/content", label: "内容", icon: "fileText" },
  { key: "message", href: "/message", label: "消息", icon: "message" },
  { key: "mine", href: "/mine", label: "我的", icon: "user" },
];

/** 任意路径 → 所属场景（旧页面也能点亮正确的 rail 图标） */
export function sceneOfPath(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/today")) return "today";
  if (pathname.startsWith("/agent")) return "agent";
  if (
    pathname.startsWith("/customer") ||
    pathname.startsWith("/growth") ||
    pathname.startsWith("/crm")
  )
    return "customer";
  if (
    pathname.startsWith("/content") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/articles") ||
    pathname.startsWith("/distribution") ||
    pathname.startsWith("/compliance") ||
    pathname.startsWith("/solutions")
  )
    return "content";
  if (
    pathname.startsWith("/message") ||
    pathname.startsWith("/engagement") ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/confirmations") ||
    pathname.startsWith("/douyin") ||
    pathname.startsWith("/wechat")
  )
    return "message";
  return "mine";
}

/** 6 个场景路由（这些页面自带 .kx-view 内边距，不再套容器） */
const SCENE_ROUTES = new Set(SCENES.map((s) => s.href));
function isSceneRoute(pathname: string | null) {
  return SCENE_ROUTES.has(pathname || "");
}

/** 宽档路由：多窗格工作台（渠道控制台/设备台），与对话页同宽 1080 */
const WIDE_ROUTE = [
  /^\/engagement\/(douyin|channel|wechat|comment-insights)/,
  /^\/local-engine/,
  /^\/agent-console/,
  /^\/agent-workbench/,
];
function isWideRoute(pathname: string | null) {
  return WIDE_ROUTE.some((re) => re.test(pathname || ""));
}

/* ---------- 用户信息上下文（场景页可用，如 /mine 的资料卡） ---------- */
export type ShellUser = {
  displayName: string;
  planLabel: string;
  creditLabel: string;
  avatarUrl?: string;
  onLogout: () => void;
  loggingOut: boolean;
};
export const ShellUserContext = React.createContext<ShellUser | null>(null);
export function useShellUser() {
  return React.useContext(ShellUserContext);
}

/* ---------- 角标数据（30s 刷新） ---------- */
function useBadges(pathname: string) {
  const [waiting, setWaiting] = React.useState(0);
  const [failed, setFailed] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      const [tasks, pubTasks] = await Promise.all([
        localEngineApi.tasks(50).catch(() => []),
        autoUploadApi.tasks(50).catch(() => []),
      ]);
      if (!active) return;
      const taskList = Array.isArray(tasks) ? tasks : [];
      // 兼容两种返回结构：数组（本地引擎）或分页对象 { items }（auto-upload 后端）
      const pubList = Array.isArray(pubTasks)
        ? pubTasks
        : Array.isArray((pubTasks as { items?: unknown[] } | null)?.items)
          ? ((pubTasks as { items: unknown[] }).items as AutoUploadPublishTask[])
          : [];
      const w = taskList.filter(
        (t) => t.status === "waiting_for_send_confirmation",
      ).length;
      const f = pubList.filter(
        (t) => t.status === "failed",
      ).length;
      setWaiting(w);
      setFailed(f);
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return { waiting, failed, today: waiting + failed };
}

/* ---------- 通知滚动条（真实系统事件） ---------- */
function useNotificationItems(): TickerItem[] {
  const [items, setItems] = React.useState<TickerItem[]>([]);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      const next: TickerItem[] = [];
      const [accounts, pubTasks, collect] = await Promise.all([
        autoUploadApi.accounts().catch(() => []),
        autoUploadApi.tasks(5).catch(() => []),
        materialsApi.collectStatus().catch(() => null),
      ]);

      dedupeAutoUploadAccounts(accounts)
        .filter((account) => !isAutoUploadAccountLoggedIn(account))
        .slice(0, 2)
        .forEach((account) => {
          next.push({
            id: `acc-${autoUploadAccountIdentityKey(account)}`,
            dot: "warn",
            text: `账号「${account.profileName || account.userName || account.accountName || account.id}」登录状态异常，请重新扫码`,
            href: "/platforms",
          });
        });

      (Array.isArray(pubTasks) ? pubTasks : []).slice(0, 3).forEach((t, i) => {
        if (t.status === "completed") {
          next.push({
            id: `pub-ok-${i}`,
            dot: "ok",
            text: `「${t.title || `任务 #${t.id}`}」已发布完成`,
            href: "/distribution-v2/tasks",
          });
        } else if (t.status === "failed") {
          next.push({
            id: `pub-fail-${i}`,
            dot: "warn",
            text: `「${t.title || `任务 #${t.id}`}」发布失败，待处理`,
            href: "/distribution-v2/tasks",
          });
        }
      });

      const counts = (collect as { counts?: Record<string, number> } | null)
        ?.counts;
      const newCount = counts?.new ?? counts?.collected ?? counts?.total ?? 0;
      if (newCount > 0) {
        next.push({
          id: "collect",
          dot: "ok",
          text: `素材库现有 ${newCount} 条素材可用`,
          href: "/materials",
        });
      }

      if (!active) return;
      setItems(
        next.length > 0
          ? next
          : [{ id: "ok", dot: "info", text: "系统运行正常，暂无新通知" }],
      );
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const refreshOnFocus = () => void load();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  return items;
}

/* ---------- 外壳 ---------- */
export function AppShell({
  children,
  footer,
  user,
  tenant,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  user: ShellUser;
  tenant?: {
    memberships: Array<{ tenantId: string; name: string }>;
    activeTenantId: string;
    onChange: (tenantId: string) => void;
  };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const badges = useBadges(pathname);
  const noticeItems = useNotificationItems();
  const activeScene = sceneOfPath(pathname || "/today");
  const isMobile = useIsMobile();

  /* 暗色模式：next-themes 统一驱动（.dark 类 → 旧页面/heroui，data-theme → 新壳） */
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";
  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "");
  }, [dark, mounted]);
  const toggleTheme = () => setTheme(dark ? "light" : "dark");

  /* 全局快捷键：⌘K / 1-6 */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(
        (document.activeElement?.tagName as string) || "",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (!typing && !paletteOpen && /^[1-6]$/.test(e.key)) {
        const scene = SCENES[Number(e.key) - 1];
        if (scene) router.push(scene.href);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [paletteOpen, router]);

  const badgeOf = (key: string) => {
    if (key === "today") return badges.today;
    if (key === "message") return badges.waiting;
    return 0;
  };

  /* 移动端（<768px）：底部 5 Tab 导航，共用路由与数据 */
  if (isMobile) {
    return (
      <ShellUserContext.Provider value={user}>
        <MobileShell
          badges={{
            today: badges.today,
            publish: badges.failed,
            message: badges.waiting,
          }}
        >
          {children}
        </MobileShell>
        <PwaInstallBanner />
        <AiAssistant />
      </ShellUserContext.Provider>
    );
  }

  return (
    <ShellUserContext.Provider value={user}>
      <div className="kx-app">
        {/* 左侧图标栏 */}
        <nav className="kx-rail" aria-label="主导航">
          <img
            src="/brand/jiuzhang-ai-icon.png"
            alt="JIUZHANG AI"
            className="kx-rail-logo"
            draggable={false}
          />
          {SCENES.slice(0, 5).map((scene, i) => {
            const badge = badgeOf(scene.key);
            return (
              <button
                key={scene.key}
                className={`kx-rail-item${activeScene === scene.key ? " kx-active" : ""}`}
                aria-label={`${scene.label}（按 ${i + 1}）`}
                aria-current={activeScene === scene.key ? "page" : undefined}
                onClick={() => router.push(scene.href)}
              >
                <ShellIcon name={scene.icon} size={22} />
                <span className="kx-rail-lbl">{scene.label}</span>
                {badge > 0 ? <span className="kx-rail-badge">{badge > 99 ? "99+" : badge}</span> : null}
              </button>
            );
          })}
          <div className="kx-rail-spacer" />
          <button
            className="kx-rail-tool"
            aria-label="切换暗色模式"
            onClick={toggleTheme}
          >
            <ShellIcon name={dark ? "sun" : "moon"} />
          </button>
          <button
            className={`kx-rail-item${activeScene === "mine" ? " kx-active" : ""}`}
            aria-label="我的（按 6）"
            aria-current={activeScene === "mine" ? "page" : undefined}
            onClick={() => router.push("/mine")}
          >
            <ShellIcon name="user" size={22} />
            <span className="kx-rail-lbl">我的</span>
          </button>
          <button
            className="kx-rail-avatar"
            aria-label={`${user.displayName}的主页`}
            onClick={() => router.push("/mine")}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.displayName} />
            ) : (
              user.displayName.slice(0, 1)
            )}
          </button>
        </nav>

        {/* 主区 */}
        <main className="kx-main">
          <div className="kx-topbar">
            <button className="kx-search-pill" onClick={() => setPaletteOpen(true)}>
              <ShellIcon name="search" size={15} strokeWidth={2} />
              <span className="kx-grow">搜索功能，或直接说你想做什么…</span>
              <span className="kx-kbd">⌘K</span>
            </button>
            {tenant && tenant.memberships.length > 1 ? (
              <select
                className="kx-topbar-select"
                aria-label="当前工作区"
                value={tenant.activeTenantId}
                onChange={(e) => tenant.onChange(e.target.value)}
              >
                {tenant.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* 全局通知滚动条 */}
          <div className="kx-ticker-wrap">
            <Ticker label="通知" icon="bell" items={noticeItems} speed={52} />
          </div>

          {isSceneRoute(pathname) ? (
            children
          ) : (
            <div
              className={`kx-legacy-wrap${isWideRoute(pathname) ? " kx-wide" : ""}`}
            >
              {children}
            </div>
          )}
          {footer}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellUserContext.Provider>
  );
}
