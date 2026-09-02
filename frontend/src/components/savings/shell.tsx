"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Home, Package, TrendingUp, User, Wallet } from "lucide-react";
import {
  savingsApi,
  type CreditBalance,
  type OfferView,
  type RebateBalance,
  type PriceWatch,
  type VendorOffersResponse,
} from "@/lib/api/savings";
import { MobileTabBar } from "../shell/mobile-tab-bar";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { HomePanel } from "./panels/home";
import { ComparePanel } from "./panels/compare";
import { OrdersPanel } from "./panels/orders";
import { WalletPanel } from "./panels/wallet";
import { MePanel } from "./panels/me";

type TabKey = "home" | "compare" | "orders" | "wallet" | "me";

export type { TabKey };

const TABS: Array<{ key: TabKey; label: string; icon: typeof Home }> = [
  { key: "home", label: "首页", icon: Home },
  { key: "compare", label: "比价", icon: TrendingUp },
  { key: "orders", label: "订单", icon: Package },
  { key: "wallet", label: "钱包", icon: Wallet },
  { key: "me", label: "我的", icon: User },
];

function unavailableResult(message: string): VendorOffersResponse {
  return {
    items: [],
    unavailable: { code: "VENDOR_CREDENTIAL_MISSING", message },
  };
}

/** 5 Tab 信息架构中枢：共享资产/监控状态 + 底部导航（移动）/ 顶部导航（桌面） */
export function SavingsShell({ initialTab = "home" }: { initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [balance, setBalance] = useState<RebateBalance | null>(null);
  const [credit, setCredit] = useState<CreditBalance | null>(null);
  const [watches, setWatches] = useState<PriceWatch[]>([]);
  const [meituanActs, setMeituanActs] = useState<OfferView[]>([]);
  const [featured99, setFeatured99] = useState<OfferView[]>([]);
  const [featured30, setFeatured30] = useState<OfferView[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 2026-09-01（复核 P2）：美团/运营位失败不再静默降级空——记录来源，区块明示
  const [panelErrors, setPanelErrors] = useState<Record<string, string>>({});

  const isMobile = useIsMobile();

  const loadAll = useCallback(async () => {
    setInitialLoading(true);
    setLoadError(null);
    setPanelErrors({});
    try {
      const [b, c, w, mt, f99, f30] = await Promise.all([
        savingsApi.rebateBalance(),
        savingsApi.creditBalance(),
        savingsApi.listWatches(),
        savingsApi.meituanActivities().catch((error) => {
          return unavailableResult(
            (error as { message?: string })?.message?.slice?.(0, 80) ||
              "美团活动加载失败",
          );
        }),
        savingsApi.featured(2).catch((error) => {
          return unavailableResult(
            (error as { message?: string })?.message?.slice?.(0, 80) ||
              "运营位加载失败",
          );
        }),
        savingsApi.featured(3).catch((error) => {
          return unavailableResult(
            (error as { message?: string })?.message?.slice?.(0, 80) ||
              "运营位加载失败",
          );
        }),
      ]);
      setBalance(b);
      setCredit(c);
      setWatches(w);
      setMeituanActs(mt.items);
      setFeatured99(f99.items);
      setFeatured30(f30.items);
      const unavailablePanels: Record<string, string> = {};
      if (mt.unavailable) unavailablePanels.meituan = mt.unavailable.message;
      if (f99.unavailable) {
        unavailablePanels.featured99 = f99.unavailable.message;
      }
      if (f30.unavailable) {
        unavailablePanels.featured30 = f30.unavailable.message;
      }
      setPanelErrors(unavailablePanels);
    } catch {
      /* 未登录或接口暂不可用时静默 */
      setLoadError("数据加载失败，请检查网络后刷新重试");
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const shared = {
    balance,
    credit,
    watches,
    meituanActs,
    featured99,
    featured30,
    initialLoading,
    loadError,
    panelErrors,
    reload: loadAll,
  };

  // ---------- 桌面端：顶部导航 + 宽容器 ----------
  if (!isMobile) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 pt-6">
        {/* 桌面顶部导航：分段控件风格 */}
        <nav
          aria-label="省钱返利主导航"
          className="mb-6 inline-flex items-center gap-1 rounded-2xl border border-default-200 bg-white p-1.5 shadow-sm dark:border-default-800 dark:bg-content1"
        >
          {TABS.map((t) => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-label={t.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-13 font-semibold transition-colors ${
                  isActive
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20"
                    : "text-default-600 hover:bg-default-100 hover:text-default-900 dark:text-default-400 dark:hover:bg-default-800"
                }`}
              >
                <t.icon className="h-4 w-4" strokeWidth={2} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === "home" && <HomePanel {...shared} onNavigate={setTab} />}
        {tab === "compare" && (
          <ComparePanel watches={watches} onWatchCreated={loadAll} />
        )}
        {tab === "orders" && <OrdersPanel onNavigate={setTab} />}
        {tab === "wallet" && (
          <WalletPanel balance={balance} credit={credit} reload={loadAll} />
        )}
        {tab === "me" && <MePanel watches={watches} />}
      </div>
    );
  }

  // ---------- 移动端：原手机 UI（底部 Tab） ----------
  return (
    <div className="mx-auto max-w-[560px] px-4 pb-24 pt-4">
      {tab === "home" && <HomePanel {...shared} onNavigate={setTab} />}
      {tab === "compare" && (
        <ComparePanel watches={watches} onWatchCreated={loadAll} />
      )}
      {tab === "orders" && <OrdersPanel onNavigate={setTab} />}
      {tab === "wallet" && (
        <WalletPanel balance={balance} credit={credit} reload={loadAll} />
      )}
      {tab === "me" && <MePanel watches={watches} />}

      {/* 底部固定 Tab（统一 MobileTabBar；state 驱动） */}
      <MobileTabBar
        ariaLabel="省钱返利主导航"
        maxWidth={560}
        items={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          icon: <t.icon className="h-[19px] w-[19px]" strokeWidth={1.8} />,
        }))}
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
      />
    </div>
  );
}
