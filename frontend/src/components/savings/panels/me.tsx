"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button, Input, addToast } from "@heroui/react";
import { BellRing, Copy, Gift, Heart, Landmark, Share2, Store, User } from "lucide-react";
import { savingsApi, type OfferView, type PriceWatch } from "@/lib/api/savings";
import { ProductCard } from "../product-card";
import { BuyModal } from "../buy-modal";

interface MePanelProps {
  watches: PriceWatch[];
}

interface FavoriteRow {
  id: string;
  itemId: string;
  platformCode: string;
  vendorCode: string;
  title: string;
  imageUrl?: string | null;
  payPrice: number;
  couponAmount: number;
  estRebate: number;
  estNetCost: number;
  commissionRate: number | null;
  createdAt: string;
}

/** 模块级 toast */
function toast(title: string, color: "success" | "danger" = "success") {
  addToast({ title, color });
}

export function MePanel({ watches }: MePanelProps) {
  const [showStore, setShowStore] = useState(false);
  const [stores, setStores] = useState<Array<{ id: string; name: string; address?: string | null }>>([]);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [newStoreName, setNewStoreName] = useState("");
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [checkin, setCheckin] = useState<{
    todayChecked: boolean;
    streakDay: number;
    monthDays: number;
    todayReward: number | null;
  } | null>(null);
  const [invite, setInvite] = useState<{ inviteCode: string; inviteUrl: string; shareText: string } | null>(null);
  const [buyOffer, setBuyOffer] = useState<OfferView | null>(null);
  const [checking, setChecking] = useState(false);

  const loadGrowth = useCallback(async () => {
    try {
      const [favs, ci, iv] = await Promise.all([
        savingsApi.listFavorites().catch(() => []),
        savingsApi.checkinStatus().catch(() => null),
        savingsApi.invite().catch(() => null),
      ]);
      setFavorites(favs);
      setCheckin(ci);
      setInvite(iv);
    } catch {
      /* 静默 */
    }
  }, []);

  useEffect(() => {
    void loadGrowth();
  }, [loadGrowth]);

  const openStores = () => {
    void savingsApi
      .listStores()
      .then((st) => {
        setStores(st);
        setShowStore(true);
      })
      .catch(() => toast("门店列表加载失败", "danger"));
  };

  /** 收藏切换（从 ProductCard 触发） */
  const toggleFavorite = async (offer: OfferView) => {
    const already = favorites.some((f) => f.itemId === offer.itemId && f.platformCode === offer.platformCode);
    try {
      if (already) {
        await savingsApi.removeFavorite(offer.itemId, offer.platformCode);
        toast("已取消收藏");
        setFavorites((prev) => prev.filter((f) => !(f.itemId === offer.itemId && f.platformCode === offer.platformCode)));
      } else {
        await savingsApi.addFavorite({
          vendorCode: offer.vendorCode,
          platformCode: offer.platformCode,
          itemId: offer.itemId,
          title: offer.title,
          imageUrl: offer.imageUrl,
          payPrice: offer.payPrice,
          couponAmount: offer.couponAmount,
          estRebate: offer.estRebate,
          estNetCost: offer.estNetCost,
          commissionRate: offer.commissionRate,
        });
        toast("❤️ 已收藏，随时回来比价");
        await loadGrowth();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "收藏操作失败", "danger");
    }
  };

  /** 今日签到 */
  const handleCheckin = async () => {
    if (checking || checkin?.todayChecked) return;
    setChecking(true);
    try {
      const res = await savingsApi.checkin();
      setCheckin((prev) =>
        prev
          ? { ...prev, todayChecked: true, streakDay: res.streakDay, todayReward: res.rewardAmount, monthDays: prev.monthDays + 1 }
          : { todayChecked: true, streakDay: res.streakDay, monthDays: 1, todayReward: res.rewardAmount },
      );
      toast(`✅ 签到成功，返利 +¥${res.rewardAmount}，连续 ${res.streakDay} 天`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "签到失败", "danger");
    } finally {
      setChecking(false);
    }
  };

  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("复制失败", "danger");
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xl font-extrabold tracking-tight text-foreground">
        <User className="h-5 w-5 text-orange-500 dark:text-orange-400" />
        我的
      </div>
      <div className="mt-0.5 text-12 text-default-500">收藏 · 签到 · 门店 · 邀请</div>

      {/* 签到卡 */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500 to-amber-500 p-4 text-white shadow-lg shadow-orange-500/10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-13 font-bold">每日签到</div>
            <div className="mt-0.5 text-11 text-orange-100">
              已连续 <b className="text-14">{checkin?.streakDay ?? 0}</b> 天 · 本月 {checkin?.monthDays ?? 0} 次
            </div>
            <div className="mt-0.5 text-11 text-orange-100">连续签到返利递增，今天可得 ¥0.1 起</div>
          </div>
          <Button
            onPress={() => void handleCheckin()}
            isDisabled={checkin?.todayChecked}
            isLoading={checking}
            className="bg-white/95 font-bold text-orange-600"
            size="sm"
          >
            {checkin?.todayChecked ? "今日已签" : "签到领返利"}
          </Button>
        </div>
      </div>

      {/* 功能入口 */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={openStores}
          className="flex flex-col items-center gap-1 rounded-xl border border-default-200 bg-white py-3 transition-colors hover:border-orange-300 dark:border-default-800 dark:bg-content1"
        >
          <Store className="h-5 w-5 text-orange-500 dark:text-orange-400" strokeWidth={1.8} />
          <span className="text-12 font-medium text-foreground">门店采购</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (invite) void copyText(invite.shareText, "✅ 邀请文案已复制，去分享给好友");
            else toast("邀请码加载中，稍后再试", "danger");
          }}
          className="flex flex-col items-center gap-1 rounded-xl border border-default-200 bg-white py-3 transition-colors hover:border-orange-300 dark:border-default-800 dark:bg-content1"
        >
          <Share2 className="h-5 w-5 text-orange-500 dark:text-orange-400" strokeWidth={1.8} />
          <span className="text-12 font-medium text-foreground">邀请有礼</span>
        </button>
        <button
          type="button"
          onClick={() => toast("任务中心更多玩法将陆续上线")}
          className="flex flex-col items-center gap-1 rounded-xl border border-default-200 bg-white py-3 transition-colors hover:border-orange-300 dark:border-default-800 dark:bg-content1"
        >
          <Gift className="h-5 w-5 text-orange-500 dark:text-orange-400" strokeWidth={1.8} />
          <span className="text-12 font-medium text-foreground">任务中心</span>
        </button>
      </div>

      {/* 邀请码 */}
      {invite && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="min-w-0 flex-1">
            <div className="text-11 font-semibold text-emerald-700 dark:text-emerald-300">
              我的邀请码：<b className="font-mono text-14">{invite.inviteCode}</b>
            </div>
            <div className="mt-0.5 truncate text-11 text-emerald-600/80 dark:text-emerald-400/80">好友下单，你得返利分成</div>
          </div>
          <Button size="sm" variant="flat" color="success" startContent={<Copy className="h-3.5 w-3.5" />} onPress={() => void copyText(invite.inviteCode, "✅ 邀请码已复制")}>
            复制
          </Button>
        </div>
      )}

      {/* 收藏夹 */}
      <div className="mt-5">
        <div className="mb-2.5 flex items-center gap-1.5 text-14 font-bold text-foreground">
          <Heart className="h-4 w-4 text-red-500" fill="currentColor" />
          收藏夹
          <span className="rounded-full bg-default-100 px-1.5 py-px text-11 font-semibold text-default-500 dark:bg-default-800">
            {favorites.length}
          </span>
        </div>
        {favorites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-default-300 py-6 text-center text-11 text-default-500 dark:border-default-700">
            还没有收藏——搜索商品时点 ♥ 即可收藏，跨平台统一管理
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {favorites.map((f) => (
              <ProductCard
                key={f.id}
                offer={{
                  vendorCode: f.vendorCode,
                  platformCode: f.platformCode,
                  itemId: f.itemId,
                  title: f.title,
                  imageUrl: f.imageUrl,
                  price: f.payPrice,
                  couponAmount: f.couponAmount,
                  payPrice: f.payPrice,
                  commissionRate: f.commissionRate ?? 0,
                  estCommission: 0,
                  estRebate: f.estRebate,
                  estNetCost: f.estNetCost,
                  freight: 0,
                }}
                onBuy={setBuyOffer}
                favorited
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        )}
      </div>

      {/* 价格监控 */}
      <div className="mt-5">
        <div className="mb-2.5 flex items-center gap-1.5 text-14 font-bold text-foreground">
          <BellRing className="h-4 w-4 text-orange-500 dark:text-orange-400" />
          价格监控
          <span className="rounded-full bg-default-100 px-1.5 py-px text-11 font-semibold text-default-500 dark:bg-default-800">
            {watches.length}
          </span>
        </div>
        {watches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-default-300 py-6 text-center text-11 text-default-500 dark:border-default-700">
            还没有监控商品——搜索时点击「监控」即可添加
          </div>
        ) : (
          <div className="space-y-1.5">
            {watches.slice(0, 8).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-2 rounded-xl border border-default-200 bg-white px-3 py-2.5 dark:border-default-800 dark:bg-content1">
                <span className="min-w-0 truncate text-12 text-foreground">{w.title}</span>
                <span className="shrink-0 text-11 text-default-500">
                  {w.targetPayPrice ? `≤¥${w.targetPayPrice}` : ""}
                  {w.minRebate ? ` 返利≥¥${w.minRebate}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 去购买弹层 */}
      {buyOffer && <BuyModal offer={buyOffer} onClose={() => setBuyOffer(null)} onCopied={toast} />}

      {/* 门店采购弹层 */}
      {showStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowStore(false)}>
          <div
            className="max-h-[70vh] w-[320px] overflow-y-auto rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-1.5 text-14 font-bold text-foreground">
              <Landmark className="h-4 w-4 text-orange-500 dark:text-orange-400" />
              门店采购（{stores.length}）
            </div>
            {stores.length === 0 && <div className="mb-2 text-11 text-default-500">还没有门店，先创建一个</div>}
            <div className="space-y-1.5">
              {stores.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStore(st.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                    selectedStore === st.id
                      ? "border-orange-400 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10"
                      : "border-default-200 bg-white dark:border-default-800 dark:bg-content1"
                  }`}
                >
                  <div className="text-13 font-semibold text-foreground">{st.name}</div>
                  {st.address ? <div className="text-11 text-default-500">{st.address}</div> : null}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input value={newStoreName} onValueChange={setNewStoreName} placeholder="新门店名" size="sm" className="flex-1" />
              <Button
                size="sm"
                isLoading={busy}
                onPress={() => {
                  if (!newStoreName.trim()) return;
                  setBusy(true);
                  void savingsApi
                    .createStore({ name: newStoreName.trim() })
                    .then((st) => {
                      setStores((prev) => [...prev, st]);
                      setSelectedStore(st.id);
                      setNewStoreName("");
                      toast("门店创建成功");
                    })
                    .catch(() => toast("门店创建失败", "danger"))
                    .finally(() => setBusy(false));
                }}
              >
                创建
              </Button>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="flat" className="flex-1" onPress={() => setShowStore(false)}>
                关闭
              </Button>
              <Button
                color="primary"
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                isDisabled={!selectedStore}
                onPress={() => {
                  setShowStore(false);
                  toast("门店已选，可在「AI 助手」让 AI 帮你建采购清单");
                }}
              >
                选这个门店
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
