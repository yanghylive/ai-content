"use client";
/* eslint-disable @next/next/no-img-element */

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { ShellIcon, type ShellIconName } from "./icons";
import { CommandPalette } from "./command-palette";
import { SettingsNavPanel } from "./settings-nav-panel";
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
import { OnboardingGuide } from "./onboarding-guide";
import "./shell.css";
import "./desktop-vp.css";

/* ---------- 场景定义（顺序 = 快捷键 1-7；「系统设置/助手/我的」固定 rail 底部，不占业务一级导航） ---------- */
const SCENES: Array<{
  key: string;
  href: string;
  label: string;
  icon: ShellIconName;
}> = [
  { key: "growth-home", href: "/today", label: "今日增长", icon: "home" },
  { key: "customer", href: "/crm", label: "客户管理", icon: "users" },
  { key: "content", href: "/content", label: "内容运营", icon: "fileText" },
  { key: "interaction", href: "/message", label: "互动中心", icon: "messageSq" },
  { key: "execution", href: "/tasks", label: "执行中心", icon: "cpu" },
  { key: "device", href: "/device-center", label: "设备任务", icon: "phone" },
];

/** 任意路径 → 所属场景（旧页面也能点亮正确的 rail 图标） */
export function sceneOfPath(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/today")) return "growth-home";
  // 增长全域（/growth 控制台已并入 /today，2026-09-03 双首页合并）：
  // growth 子功能 + 市场机会/情报全部归「今日增长」场景点亮同一导航项
  if (
    pathname.startsWith("/growth") ||
    pathname.startsWith("/intelligence") ||
    pathname.startsWith("/effects")
  )
    return "growth-home";
  // 客户管理：CRM 客户/商机/导入/连接器/成交跟进
  if (
    pathname.startsWith("/crm") ||
    pathname.startsWith("/customer") ||
    pathname.startsWith("/crm-closer") ||
    pathname.startsWith("/wecom-crm") ||
    pathname.startsWith("/boss-recruit")
  )
    return "customer";
  // 移动设备（手机/租约/任务）独立场景，不再误高亮为执行中心
  if (pathname.startsWith("/device-center") || pathname.startsWith("/mai-ui")) return "device";
  // 内容运营：内容/素材/主题/发布/排期/合规/样式
  if (
    pathname.startsWith("/content") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/topics") ||
    pathname.startsWith("/distribution") ||
    pathname.startsWith("/schedules") ||
    pathname.startsWith("/compliance") ||
    pathname.startsWith("/styles") ||
    pathname.startsWith("/viral-analysis") ||
    pathname.startsWith("/knowledge-base")
  )
    return "content";
  // 互动中心：消息/互动（各渠道子页均在 /engagement/* 下）
  if (
    pathname.startsWith("/message") ||
    pathname.startsWith("/engagement")
  )
    return "interaction";
  // 执行中心：任务/审批/证据/工作台
  if (
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/approvals") ||
    pathname.startsWith("/task-evidence") ||
    pathname.startsWith("/agent-workbench")
  )
    return "execution";
  // 系统设置/平台账号/本地引擎/能力页 → mine（固定底部设置/我的）
  if (
    pathname.startsWith("/settings") ||
    pathname.startsWith("/platforms") ||
    pathname.startsWith("/local-engine") ||
    pathname.startsWith("/capabilities") ||
    pathname.startsWith("/accounts-matrix")
  )
    return "mine";
  // 助手保留场景 key（供全局助手 /agent 页高亮），但不占一级导航
  if (pathname.startsWith("/agent")) return "agent";
  return "mine";
}

/** 7 个业务场景路由（这些页面自带 .kx-view 内边距，不再套容器） */
const SCENE_ROUTES = new Set(SCENES.map((s) => s.href));
function isSceneRoute(pathname: string | null) {
  return SCENE_ROUTES.has(pathname || "");
}

/** 宽档路由：多窗格工作台（渠道控制台/设备台），与对话页同宽 1080 */
const WIDE_ROUTE = [
  /^\/engagement\/(douyin|channel|wechat|comment-insights|comment-acquisition)/,
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
            href: "/distribution/accounts",
          });
        });

      // 发布任务通知：按任务 id 去重（同任务多轮/多平台发布只保留最新一条），
      // 多条 failed 聚合为 1 条，避免 Marquee 视觉双份后出现「4× 相同通知」。
      const pubList = Array.isArray(pubTasks)
        ? (pubTasks as AutoUploadPublishTask[])
        : [];
      const seenTasks = new Set<number>();
      const dedupedPubTasks: AutoUploadPublishTask[] = [];
      for (const t of pubList) {
        if (!t || seenTasks.has(t.id)) continue;
        seenTasks.add(t.id);
        dedupedPubTasks.push(t);
      }
      const failedTasks = dedupedPubTasks.filter(
        (t) => t.status === "failed",
      );
      const completedTasks = dedupedPubTasks.filter(
        (t) => t.status === "completed",
      );

      if (failedTasks.length > 0) {
        const first = failedTasks[0];
        next.push({
          id: `pub-fail-${first.id}`,
          dot: "warn",
          text:
            failedTasks.length > 1
              ? `「${failedTasks.length} 个发布任务失败了」，请到任务中心处理`
              : `「${first.title || `任务 #${first.id}`}」发布失败，待处理`,
          href: "/distribution/tasks",
        });
      }

      completedTasks.slice(0, 3).forEach((t) => {
        next.push({
          id: `pub-ok-${t.id}`,
          dot: "ok",
          text: `「${t.title || `任务 #${t.id}`}」已发布完成`,
          href: "/distribution/tasks",
        });
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const badges = useBadges(pathname);
  const noticeItems = useNotificationItems();
  const activeScene = sceneOfPath(pathname || "/today");

  // 路由变化自动关闭设置面板
  React.useEffect(() => {
    setSettingsOpen(false);
  }, [pathname]);
  const isMobile = useIsMobile();

  /* 暗色模式：next-themes 统一驱动（.dark 类 → 旧页面/heroui，data-theme → 新壳） */
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";
  // 清除旧的 data-theme 属性（此前由 JS 手动设置，和 next-themes class 竞态）
  // 暗色规则现在统一用 html.dark 选择器，不再需要 data-theme
  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.removeAttribute("data-theme");
  }, [mounted, dark]);
  const toggleTheme = () => setTheme(dark ? "light" : "dark");

  /* 唯一品牌主题（2026-08-23 定稿）：磨砂紫金，无切换无回退；深浅双档走 next-themes。 */

  /* 全局快捷键：⌘K / 1-7 */
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
      if (!typing && !paletteOpen && /^[1-7]$/.test(e.key)) {
        const scene = SCENES[Number(e.key) - 1];
        if (scene) router.push(scene.href);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [paletteOpen, router]);

  const badgeOf = (key: string) => {
    if (key === "growth-home") return badges.today;
    if (key === "interaction") return badges.waiting;
    return 0;
  };

  /* 移动端（<768px）：底部 5 Tab 导航，共用路由与数据 */
  if (isMobile) {
    return (
      <ShellUserContext.Provider value={user}>
        <MobileShell
          badges={{
            today: badges.today,
            interaction: badges.waiting,
          }}
          onOpenPalette={() => setPaletteOpen(true)}
        >
          {children}
        </MobileShell>
        {/* 移动端命令面板入口（FAB 触发，替代桌面 ⌘K） */}
        <SettingsNavPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <PwaInstallBanner />
        {/* 2026-09-01（大王决策）：移动端 AI 助手悬浮球（紫钮）移除——AI 对话入口
            保留 /agent 页与命令面板搜索「AI 助手」，不再占右下角悬浮位 */}
        <OnboardingGuide />
      </ShellUserContext.Provider>
    );
  }

  return (
    <ShellUserContext.Provider value={user}>
      <div className="kx-app">
        {/* 左侧图标栏 */}
        <nav className="kx-rail" aria-label="主导航">
          <img
            src="/brand/jiuzhang-ai-icon.webp"
            alt="JIUZHANG AI"
            className="kx-rail-logo"
            draggable={false}
          />
          {SCENES.map((scene, i) => {
            const badge = badgeOf(scene.key);
            return (
              <button
                key={scene.key}
                className={`kx-rail-item${activeScene === scene.key ? " kx-active" : ""}`}
                aria-label={`${scene.label}（按 ${i + 1}）`}
                aria-current={activeScene === scene.key ? "page" : undefined}
                onClick={() => router.push(scene.href)}
              >
                {activeScene === scene.key ? (
                  <motion.span
                    layoutId="kx-rail-indicator"
                    aria-hidden="true"
                    className="kx-rail-indicator"
                    transition={{ type: "tween", duration: 0.18, ease: "easeInOut" }}
                  />
                ) : null}
                <ShellIcon name={scene.icon} size={22} />
                <span className="kx-rail-lbl">{scene.label}</span>
                {badge > 0 ? <span className="kx-rail-badge">{badge > 99 ? "99+" : badge}</span> : null}
              </button>
            );
          })}
          <div className="kx-rail-spacer" />
          <button
            className="kx-rail-tool"
            aria-label={dark ? "切换到浅色模式" : "切换到暗色模式"}
            onClick={toggleTheme}
          >
            <ShellIcon name={dark ? "sun" : "moon"} />
          </button>
          {/* Q3：rail「助手」下沉为次级入口（与设置同排），不占业务一级导航。
              2026-09-01 大王决策：悬浮球 AI 入口全面移除（桌面 Electron 悬浮球 +
              移动端紫钮均已砍），AI 对话统一走 rail 助手按钮 / /agent 页 */}
          <button
            className={`kx-rail-item${activeScene === "agent" ? " kx-active" : ""}`}
            aria-label="助手"
            aria-current={activeScene === "agent" ? "page" : undefined}
            onClick={() => router.push("/agent")}
          >
            {activeScene === "agent" ? (
              <motion.span
                layoutId="kx-rail-indicator"
                aria-hidden="true"
                className="kx-rail-indicator"
                transition={{ type: "tween", duration: 0.18, ease: "easeInOut" }}
              />
            ) : null}
            <ShellIcon name="cpu" size={22} />
            <span className="kx-rail-lbl">助手</span>
          </button>
          <button
            className={`kx-rail-item${activeScene === "mine" ? " kx-active" : ""}`}
            aria-label="我的"
            aria-current={activeScene === "mine" ? "page" : undefined}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            {activeScene === "mine" ? <span className="kx-rail-indicator" aria-hidden="true" /> : null}
            <ShellIcon name="user" size={22} />
            <span className="kx-rail-lbl">我的</span>
          </button>
          {/* 头像入口已移除（2026-08-26 导航去重）：原与上方「我的」重复指向 /mine */}
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
            <Ticker label="通知" icon="bell" items={noticeItems} />
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

      <SettingsNavPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellUserContext.Provider>
  );
}
