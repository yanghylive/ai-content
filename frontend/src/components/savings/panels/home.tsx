"use client";

import React, { useEffect, useState } from "react";
import { Button, Input, addToast } from "@heroui/react";
import {
  BellRing,
  CreditCard,
  Package,
  Search,
  ShoppingCart,
  Store,
  TrendingUp,
  Utensils,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { savingsApi, type CreditBalance, type OfferView, type RebateBalance } from "@/lib/api/savings";
import { CountdownBadge } from "../countdown-badge";
import { ProductCard } from "../product-card";
import { MasonryCard } from "../masonry-card";
import { BuyModal } from "../buy-modal";
import { WalletSkeleton } from "../skeletons";
import type { TabKey } from "../shell";

interface FavoriteRow {
  itemId: string;
  platformCode: string;
}

interface HomePanelProps {
  balance: RebateBalance | null;
  credit: CreditBalance | null;
  meituanActs: OfferView[];
  featured99: OfferView[];
  featured30: OfferView[];
  initialLoading: boolean;
  reload: () => Promise<void>;
  onNavigate: (tab: TabKey) => void;
}

const QUICK_ACTIONS: Array<{ label: string; icon: typeof Search; key: TabKey }> = [
  { label: "比价", icon: TrendingUp, key: "compare" },
  { label: "监控", icon: BellRing, key: "compare" },
  { label: "兑换额度", icon: CreditCard, key: "wallet" },
  { label: "提现", icon: Wallet, key: "wallet" },
  { label: "采购", icon: Store, key: "me" },
  { label: "我的订单", icon: Package, key: "orders" },
];

/**
 * 首页分类导航（B 端客群：企业/个体户采购视角，与后端 /savings/category 的 key 对应）
 * - 门店/餐饮/包装/办公/直播 是企业经营高频采购场景
 * - 美团=本地生活（外卖/到店/买菜，走 meituanActivities 专用接口）
 */
const CATEGORIES = [
  { key: "hot", label: "🔥 热销" },
  { key: "store", label: "🏪 门店经营" },
  { key: "pack", label: "📦 包装耗材" },
  { key: "office", label: "🖥️ 办公设备" },
  { key: "live", label: "🎥 直播设备" },
  { key: "clean", label: "🧹 清洁用品" },
  { key: "food", label: "🍱 餐饮耗材" },
  { key: "marketing", label: "🏷️ 营销物料" },
  { key: "appliance", label: "⚡ 商用电器" },
  { key: "meituan", label: "🍜 美团" },
];

export function HomePanel({
  balance,
  credit,
  meituanActs,
  featured99,
  featured30,
  initialLoading,
  reload,
  onNavigate,
}: HomePanelProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [searched, setSearched] = useState(false);
  const [buyOffer, setBuyOffer] = useState<OfferView | null>(null);
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [promoLink, setPromoLink] = useState<string | null>(null);
  const [promoTitle, setPromoTitle] = useState("");
  const [showPromo, setShowPromo] = useState(false);
  // 盯价订阅（首页商品流）
  const [watchTarget, setWatchTarget] = useState<OfferView | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [watching, setWatching] = useState(false);
  // P3-2 分类导航 + 默认商品流
  const [activeCat, setActiveCat] = useState("hot");
  const [catItems, setCatItems] = useState<OfferView[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState<"VENDOR_CREDENTIAL_MISSING" | "VENDOR_API_ERROR" | null>(null);

  const toast = (title: string, color: "success" | "danger" = "success") =>
    addToast({ title, color });

  /** 加载收藏状态（只取 id 集合用于高亮） */
  const loadFavorites = async () => {
    try {
      const favs = await savingsApi.listFavorites();
      setFavorites(favs.map((f) => ({ itemId: f.itemId, platformCode: f.platformCode })));
    } catch {
      /* 静默 */
    }
  };

  /** 收藏切换 */
  const toggleFavorite = async (offer: OfferView) => {
    const already = favorites.some((f) => f.itemId === offer.itemId && f.platformCode === offer.platformCode);
    try {
      if (already) {
        await savingsApi.removeFavorite(offer.itemId, offer.platformCode);
        setFavorites((prev) => prev.filter((f) => !(f.itemId === offer.itemId && f.platformCode === offer.platformCode)));
        toast("已取消收藏");
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
        setFavorites((prev) => [...prev, { itemId: offer.itemId, platformCode: offer.platformCode }]);
        toast("❤️ 已收藏，随时回来比价");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "收藏操作失败", "danger");
    }
  };

  const isFav = (o: OfferView) => favorites.some((f) => f.itemId === o.itemId && f.platformCode === o.platformCode);

  /** 盯价订阅（首页商品流） */
  const handleWatch = async () => {
    if (!watchTarget) return;
    setWatching(true);
    try {
      const t = Number(targetPrice);
      await savingsApi.upsertWatch({
        itemId: watchTarget.itemId,
        platformCode: watchTarget.platformCode,
        title: watchTarget.title,
        targetPayPrice: t > 0 ? t : undefined,
      });
      toast("🔔 已订阅降价提醒，降价时推送通知");
      setWatchTarget(null);
      setTargetPrice("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "订阅失败", "danger");
    } finally {
      setWatching(false);
    }
  };

  useEffect(() => {
    void loadFavorites();
  }, []);

  /** 加载分类商品流（默认热销；美团走 meituanActivities；热销优先用已加载的 featured99/30 兜底） */
  const loadCategory = async (key: string) => {
    setActiveCat(key);
    setCatLoading(true);
    setCatError(null);
    try {
      if (key === "meituan") {
        const acts = await savingsApi.meituanActivities().catch(() => [] as OfferView[]);
        setCatItems(acts);
        if (acts.length === 0) setCatError("VENDOR_API_ERROR");
        return;
      }
      if (key === "hot" && (featured99.length > 0 || featured30.length > 0)) {
        // 用限时特惠已加载的数据当热销流（免额外请求，避免 column 慢）
        setCatItems([...featured99, ...featured30].slice(0, 10));
        return;
      }
      const res = await savingsApi.category(key, 10);
      setCatItems(res.items);
      if (res.error) setCatError(res.error);
    } catch {
      setCatItems([]);
      setCatError("VENDOR_API_ERROR");
    } finally {
      setCatLoading(false);
    }
  };

  // 热销流：等首屏数据（featured99/30）加载完再填充，避免与 column 并发慢
  useEffect(() => {
    if (activeCat === "hot" && !initialLoading) {
      if (featured99.length > 0 || featured30.length > 0) {
        setCatItems([...featured99, ...featured30].slice(0, 10));
        setCatLoading(false);
        setCatError(null);
      } else {
        void loadCategory("hot");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, featured99, featured30, activeCat]);

  /** 解析/搜索 */
  const handleSearch = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const looksLikeLink = /https?:\/\/|[¥￥]/.test(text);
      let list: OfferView[];
      if (looksLikeLink) {
        const offer = await savingsApi.parse(text);
        list = [offer];
      } else {
        const res = await savingsApi.search(text);
        list = res.slice(0, 10);
      }
      setOffers(list);
      setSearched(true);
      toast(`✅ 找到 ${list.length} 个结果`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "查询失败（好单库凭证配置后可查询）", "danger");
    } finally {
      setBusy(false);
    }
  };

  /** 美团活动转链 */
  const handleTranslink = async (act: OfferView) => {
    setBusy(true);
    try {
      const result = await savingsApi.translink({
        platformCode: "meituan",
        activityId: act.itemId,
      });
      setPromoTitle(act.title);
      setPromoLink(result.promoUrl);
      setShowPromo(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : "生成推广链接失败", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[20px] font-extrabold tracking-tight text-foreground">
            <Wallet className="h-5 w-5 text-orange-500 dark:text-orange-400" />
            省钱返利
          </div>
          <div className="mt-0.5 text-[12px] text-default-500">本来就要买，顺手省钱，返利还能抵算力</div>
        </div>
        <Button isIconOnly variant="flat" size="sm" aria-label="刷新" onPress={() => void reload()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* 搜索/解析输入 */}
      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onValueChange={setInput}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          placeholder="粘贴商品链接/口令，或输入关键词搜索"
          startContent={<Search className="h-4 w-4 text-default-400" />}
          size="lg"
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-100/40" }}
        />
        <Button
          color="primary"
          size="lg"
          isLoading={busy}
          onPress={() => void handleSearch()}
          className="bg-gradient-to-r from-orange-500 to-amber-500 font-bold"
        >
          查
        </Button>
      </div>

      {/* 资产条（点击进钱包） */}
      {initialLoading && !balance ? (
        <div className="mt-4">
          <WalletSkeleton />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate("wallet")}
          className="mt-4 flex w-full items-center justify-between rounded-2xl border border-orange-500/20 bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-left text-white shadow-lg shadow-orange-500/10 transition-transform active:scale-[0.99]"
        >
          <div>
            <div className="text-[11px] font-medium text-orange-100">可用返利</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[24px] font-extrabold">¥{balance?.available ?? 0}</span>
              <span className="text-[11px] text-orange-100">累计 ¥{balance?.totalEarned ?? 0}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-orange-100">
              待结算 ¥{balance?.pending ?? 0} · 预计 ¥{balance?.estimated ?? 0}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">
              <CreditCard className="h-3 w-3" />
              AI 额度 {credit?.balance ?? 0}
            </span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-orange-100">
              查看钱包 →
            </span>
          </div>
        </button>
      )}

      {/* 快捷功能 */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onNavigate(q.key)}
            className="flex flex-col items-center gap-1 rounded-xl border border-default-200 bg-white py-3 transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-default-800 dark:bg-content1 dark:hover:bg-orange-500/5"
          >
            <q.icon className="h-5 w-5 text-orange-500 dark:text-orange-400" strokeWidth={1.8} />
            <span className="text-[12px] font-medium text-foreground">{q.label}</span>
          </button>
        ))}
      </div>

      {/* 分类导航 + 商品流（P3-2） */}
      <div className="mt-5">
        <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => void loadCategory(c.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                activeCat === c.key
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm"
                  : "border border-default-200 bg-white text-default-600 hover:border-orange-300 hover:text-orange-500 dark:border-default-800 dark:bg-content1 dark:text-default-400"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 凭证未配置提示 */}
        {catError === "VENDOR_CREDENTIAL_MISSING" && (
          <div className="mb-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠️ 商品数据源（好单库）凭证未配置，暂时无法加载商品列表。可在搜索框直接搜商品，或联系管理员配置后刷新。
          </div>
        )}
        {catError === "VENDOR_API_ERROR" && (
          <div className="mb-2.5 rounded-xl border border-default-200 bg-default-50 px-3 py-2.5 text-[11px] text-default-500 dark:border-default-800 dark:bg-default-100/5">
            商品加载失败（供应商网络波动），下拉刷新重试。
          </div>
        )}

        {/* 商品流（瀑布流 2 列） */}
        {catLoading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-default-200 bg-white p-2.5 dark:border-default-800 dark:bg-content1">
                <div className="aspect-[16/10] rounded-xl bg-default-200 dark:bg-default-800" />
                <div className="mt-2 h-3 w-3/4 rounded bg-default-100 dark:bg-default-800" />
                <div className="mt-1.5 h-4 w-1/2 rounded bg-default-100 dark:bg-default-800" />
              </div>
            ))}
          </div>
        ) : catItems.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5">
            {catItems.map((o, i) =>
              activeCat === "meituan" ? (
                <MasonryCard
                  key={`mt-${o.itemId}-${i}`}
                  offer={o}
                  onBuy={handleTranslink}
                  favorited={isFav(o)}
                  onToggleFavorite={toggleFavorite}
                />
              ) : (
                <MasonryCard
                  key={`cat-${o.itemId}-${i}`}
                  offer={o}
                  onBuy={setBuyOffer}
                  onWatch={setWatchTarget}
                  favorited={isFav(o)}
                  onToggleFavorite={toggleFavorite}
                />
              ),
            )}
          </div>
        ) : (
          !catError && (
            <div className="rounded-xl border border-dashed border-default-300 py-8 text-center text-[11px] text-default-500 dark:border-default-700">
              该分类暂无商品，换一个分类看看
            </div>
          )
        )}
      </div>

      {/* 限时特惠运营位 */}
      {(featured99.length > 0 || featured30.length > 0) && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[14px] font-bold text-foreground">
              <TrendingUp className="h-4 w-4 text-orange-500 dark:text-orange-400" />
              限时特惠
            </div>
            <CountdownBadge />
          </div>
          {featured99.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-medium text-default-500">🔥 9.9 包邮</div>
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {featured99.map((o, i) => (
                  <ProductCard key={`f99-${o.itemId}-${i}`} offer={o} onBuy={setBuyOffer} compact />
                ))}
              </div>
            </div>
          )}
          {featured30.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-default-500">🛒 30 元封顶</div>
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {featured30.map((o, i) => (
                  <ProductCard key={`f30-${o.itemId}-${i}`} offer={o} onBuy={setBuyOffer} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 美团本地生活 */}
      {meituanActs.length > 0 && (
        <div className="mt-5">
          <div className="mb-1 flex items-center gap-1.5 text-[14px] font-bold text-foreground">
            <Utensils className="h-4 w-4 text-yellow-500" />
            美团本地生活
            <span className="rounded-full bg-default-100 px-1.5 py-px text-[10px] font-semibold text-default-500 dark:bg-default-800">
              {meituanActs.length}
            </span>
          </div>
          <div className="mb-2 text-[10px] text-default-400">外卖/到店/买菜，点卡片生成推广链接</div>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {meituanActs.map((a, i) => (
              <ProductCard key={`mt-${a.itemId}-${i}`} offer={a} onBuy={handleTranslink} compact commissionMode />
            ))}
          </div>
        </div>
      )}

      {/* 比价结果 */}
      {offers.length > 0 && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[14px] font-bold text-foreground">
            <ShoppingCart className="h-4 w-4 text-orange-500 dark:text-orange-400" />
            比价结果
            <span className="rounded-full bg-default-100 px-1.5 py-px text-[10px] font-semibold text-default-500 dark:bg-default-800">
              {offers.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {offers.map((o, i) => (
              <ProductCard
                key={`${o.itemId}-${i}`}
                offer={o}
                onBuy={setBuyOffer}
                favorited={isFav(o)}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      {/* 空态引导 */}
      {!initialLoading && !searched && offers.length === 0 && meituanActs.length === 0 && featured99.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-default-300 py-10 text-center dark:border-default-700">
          <TrendingUp className="h-8 w-8 text-orange-300 dark:text-orange-500/40" strokeWidth={1.5} />
          <div className="text-[13px] font-semibold text-foreground">复制链接/口令，先查一单</div>
          <div className="max-w-[260px] text-[11px] leading-5 text-default-500">
            在淘宝/京东/拼多多复制商品链接或口令，粘贴到上方搜索框，即可看到返利金额
          </div>
        </div>
      )}

      {/* 去购买（转化闭环） */}
      {buyOffer && <BuyModal offer={buyOffer} onClose={() => setBuyOffer(null)} onCopied={toast} />}

      {/* 盯价订阅弹层 */}
      {watchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWatchTarget(null)}>
          <div
            className="w-[300px] rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 text-[15px] font-bold text-foreground">
              <BellRing className="h-4 w-4 text-orange-500 dark:text-orange-400" />
              订阅降价提醒
            </div>
            <div className="mt-1 line-clamp-1 text-[11px] text-default-500">{watchTarget.title}</div>
            <div className="mt-1 text-[11px] text-default-500">
              当前到手价 ¥{watchTarget.payPrice} · 返 ¥{watchTarget.estRebate}
            </div>
            <Input
              type="number"
              value={targetPrice}
              onValueChange={setTargetPrice}
              placeholder={`目标价（低于 ¥${watchTarget.payPrice} 时提醒）`}
              size="lg"
              className="mt-3"
            />
            <div className="mt-4 flex gap-2">
              <Button
                color="primary"
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                isLoading={watching}
                onPress={() => void handleWatch()}
              >
                订阅
              </Button>
              <Button variant="flat" className="flex-1" onPress={() => setWatchTarget(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 推广链接弹层 */}
      {showPromo && promoLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowPromo(false)}>
          <div
            className="w-[320px] rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 text-[15px] font-bold text-emerald-500">
              <ShoppingCart className="h-4 w-4" />
              推广链接已生成
            </div>
            {promoTitle && <div className="mt-0.5 line-clamp-1 text-[11px] text-default-500">{promoTitle}</div>}
            <div className="mt-3 max-h-[120px] overflow-y-auto break-all rounded-lg bg-default-50 p-3 font-mono text-[11px] leading-5 text-default-600 dark:bg-default-900 dark:text-default-400">
              {promoLink}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                color="primary"
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500"
                onPress={() => {
                  void navigator.clipboard?.writeText(promoLink);
                  setShowPromo(false);
                  toast("✅ 推广链接已复制");
                }}
              >
                复制链接
              </Button>
              <Button variant="flat" className="flex-1" onPress={() => setShowPromo(false)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
