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
import { MobileTabBar } from "../shell/mobile-tab-bar";
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
