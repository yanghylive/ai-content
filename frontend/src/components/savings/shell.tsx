"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Home, Package, TrendingUp, User, Wallet } from "lucide-react";
import {
  savingsApi,
  type CreditBalance,
  type OfferView,
  type RebateBalance,
  type PriceWatch,
} from "@/lib/api/savings";
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

/** 5 Tab 信息架构中枢：共享资产/监控状态 + 底部导航 */
export function SavingsShell() {
  const [tab, setTab] = useState<TabKey>("home");
  const [balance, setBalance] = useState<RebateBalance | null>(null);
  const [credit, setCredit] = useState<CreditBalance | null>(null);
  const [watches, setWatches] = useState<PriceWatch[]>([]);
  const [meituanActs, setMeituanActs] = useState<OfferView[]>([]);
  const [featured99, setFeatured99] = useState<OfferView[]>([]);
  const [featured30, setFeatured30] = useState<OfferView[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setInitialLoading(true);
    try {
      const [b, c, w, mt, f99, f30] = await Promise.all([
        savingsApi.rebateBalance(),
        savingsApi.creditBalance(),
        savingsApi.listWatches(),
        savingsApi.meituanActivities().catch(() => []),
        savingsApi.featured(2).catch(() => []),
        savingsApi.featured(3).catch(() => []),
      ]);
      setBalance(b);
      setCredit(c);
      setWatches(w);
      setMeituanActs(mt);
      setFeatured99(f99);
      setFeatured30(f30);
    } catch {
      /* 未登录或接口暂不可用时静默 */
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const shared = { balance, credit, watches, meituanActs, featured99, featured30, initialLoading, reload: loadAll };

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-24 pt-4">
      {tab === "home" && <HomePanel {...shared} onNavigate={setTab} />}
      {tab === "compare" && <ComparePanel watches={watches} onWatchCreated={loadAll} />}
      {tab === "orders" && <OrdersPanel onNavigate={setTab} />}
      {tab === "wallet" && <WalletPanel balance={balance} credit={credit} reload={loadAll} />}
      {tab === "me" && <MePanel watches={watches} />}

      {/* 底部固定 Tab */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-default-200 bg-white/95 backdrop-blur dark:border-default-800 dark:bg-content1/95">
        <div className="mx-auto grid max-w-[560px] grid-cols-5">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
                  isActive ? "text-orange-500 dark:text-orange-400" : "text-default-400"
                }`}
                aria-label={t.label}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.7} />
                <span className="text-[10px] font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
