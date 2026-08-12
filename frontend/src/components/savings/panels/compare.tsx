"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Input, addToast } from "@heroui/react";
import { BellRing, Clock, Search, ShoppingCart, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { savingsApi, type OfferView, type PriceWatch } from "@/lib/api/savings";
import { ProductCard } from "../product-card";
import { BuyModal } from "../buy-modal";

interface ComparePanelProps {
  watches: PriceWatch[];
  onWatchCreated?: () => Promise<void> | void;
}

interface FavoriteRow {
  itemId: string;
  platformCode: string;
}

const HISTORY_KEY = "savings.search.history";
const MAX_HISTORY = 6;

/** 模块级 toast（无组件状态依赖，避免 useCallback 依赖漂移） */
function toast(title: string, color: "success" | "danger" = "success") {
  addToast({ title, color });
}

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function ComparePanel({ watches, onWatchCreated }: ComparePanelProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [buyOffer, setBuyOffer] = useState<OfferView | null>(null);
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [chart, setChart] = useState<{
    title: string;
    itemId: string;
    platformCode: string;
    days: number;
    points: Array<{ date: string; payPrice: number }>;
    avg30: number | null;
    min30: number | null;
    current: number | null;
    belowAvgPct: number | null;
  } | null>(null);
  const [watchTarget, setWatchTarget] = useState<OfferView | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    void savingsApi
      .listFavorites()
      .then((favs) => setFavorites(favs.map((f) => ({ itemId: f.itemId, platformCode: f.platformCode }))))
      .catch(() => {});
  }, []);

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

  const runSearch = useCallback(
    async (text: string) => {
      const keyword = text.trim();
      if (!keyword || busy) return;
      setBusy(true);
      try {
        const looksLikeLink = /https?:\/\/|[¥￥]/.test(keyword);
        let list: OfferView[];
        if (looksLikeLink) {
          const offer = await savingsApi.parse(keyword);
          list = [offer];
        } else {
          const res = await savingsApi.search(keyword);
          list = res.slice(0, 10);
        }
        setOffers(list);
        const next = [keyword, ...loadHistory().filter((h) => h !== keyword)].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        setHistory(next);
        toast(`✅ 找到 ${list.length} 个结果`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "查询失败（好单库凭证配置后可查询）", "danger");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const openChart = async (w: PriceWatch, days = 30) => {
    try {
      const h = await savingsApi.priceHistory(w.itemId, days);
      setChart({
        title: w.title,
        itemId: w.itemId,
        platformCode: w.platformCode,
        days: h.days,
        points: h.points,
        avg30: h.avg30,
        min30: h.min30,
        current: h.current,
        belowAvgPct: h.belowAvgPct,
      });
    } catch {
      toast("价格曲线加载失败", "danger");
    }
  };

  /** 切换 30/90 天曲线 */
  const switchDays = async (days: number) => {
    if (!chart) return;
    await openChart({ id: "", title: chart.title, itemId: chart.itemId, platformCode: chart.platformCode } as PriceWatch, days);
  };

  /** 盯价订阅 */
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
      await onWatchCreated?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "订阅失败", "danger");
    } finally {
      setWatching(false);
    }
  };

  /** 全网最低标记（同批搜索结果里净成本最低者） */
  const cheapestOfferId = useMemo(() => {
    if (offers.length < 2) return null;
    return offers.reduce((a, b) => (a.estNetCost < b.estNetCost ? a : b)).itemId;
  }, [offers]);

  const priceGapOf = (o: OfferView): string | null => {
    if (offers.length < 2) return null;
    const max = offers.reduce((a, b) => (a.estNetCost > b.estNetCost ? a : b));
    if (max.itemId === o.itemId) return null;
    const gap = Number((max.estNetCost - o.estNetCost).toFixed(2));
    return gap > 0 ? `比最高省 ¥${gap}` : null;
  };

  const chartData = chart
    ? chart.points.map((p) => ({ name: p.date.slice(5, 10), 价格: p.payPrice }))
    : [];

  return (
    <div>
      {/* 页头 */}
      <div className="flex items-center gap-1.5 text-[20px] font-extrabold tracking-tight text-foreground">
        <TrendingUp className="h-5 w-5 text-orange-500 dark:text-orange-400" />
        比价
      </div>
      <div className="mt-0.5 text-[12px] text-default-500">跨平台比价 · 历史曲线 · 盯价监控</div>

      {/* 搜索输入 */}
      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onValueChange={setInput}
          onKeyDown={(e) => e.key === "Enter" && void runSearch(input)}
          placeholder="粘贴商品链接/口令，或输入关键词"
          startContent={<Search className="h-4 w-4 text-default-400" />}
          size="lg"
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-100/40" }}
        />
        <Button
          color="primary"
          size="lg"
          isLoading={busy}
          onPress={() => void runSearch(input)}
          className="bg-gradient-to-r from-orange-500 to-amber-500 font-bold"
        >
          查
        </Button>
      </div>

      {/* 历史搜索 */}
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {history.map((h) => (
            <Chip
              key={h}
              size="sm"
              variant="flat"
              startContent={<Clock className="h-3 w-3" />}
              onClick={() => {
                setInput(h);
                void runSearch(h);
              }}
              className="cursor-pointer"
            >
              {h.slice(0, 12)}
            </Chip>
          ))}
        </div>
      )}

      {/* 比价结果 */}
      {offers.length > 0 && (
        <div className="mt-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-[14px] font-bold text-foreground">
            <ShoppingCart className="h-4 w-4 text-orange-500 dark:text-orange-400" />
            比价结果
            <span className="rounded-full bg-default-100 px-1.5 py-px text-[10px] font-semibold text-default-500 dark:bg-default-800">
              {offers.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {offers.map((o, i) => (
              <ProductCard
                key={`${o.itemId}-${i}`}
                offer={o}
                onBuy={setBuyOffer}
                favorited={isFav(o)}
                onToggleFavorite={toggleFavorite}
                onWatch={setWatchTarget}
                cheapestBadge={cheapestOfferId === o.itemId}
                priceGapNote={priceGapOf(o)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 空态 */}
      {offers.length === 0 && history.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-default-300 py-10 text-center dark:border-default-700">
          <Search className="h-8 w-8 text-orange-300 dark:text-orange-500/40" strokeWidth={1.5} />
          <div className="text-[13px] font-semibold text-foreground">搜一搜，比一比</div>
          <div className="max-w-[260px] text-[11px] leading-5 text-default-500">
            输入商品关键词或粘贴链接/口令，查看全网最优价格与返利
          </div>
        </div>
      )}

      {/* 价格监控 */}
      {watches.length > 0 && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[14px] font-bold text-foreground">
            <BellRing className="h-4 w-4 text-orange-500 dark:text-orange-400" />
            价格监控
            <span className="rounded-full bg-default-100 px-1.5 py-px text-[10px] font-semibold text-default-500 dark:bg-default-800">
              {watches.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {watches.slice(0, 5).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => void openChart(w)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-default-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-orange-300 dark:border-default-800 dark:bg-content1 dark:hover:border-orange-500/40"
              >
                <span className="min-w-0 truncate text-[12px] text-foreground">{w.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-default-500">
                  {w.targetPayPrice ? `≤¥${w.targetPayPrice}` : ""}
                  {w.minRebate ? ` 返利≥¥${w.minRebate}` : ""}
                  <TrendingUp className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 去购买弹层 */}
      {buyOffer && <BuyModal offer={buyOffer} onClose={() => setBuyOffer(null)} onCopied={toast} />}

      {/* 价格曲线弹层（recharts） */}
      {chart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setChart(null)}
        >
          <div
            className="w-[340px] rounded-2xl border border-default-200 bg-white p-5 shadow-xl dark:border-default-800 dark:bg-content1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[14px] font-bold text-foreground">📈 {chart.title.slice(0, 18)}</div>
              <div className="flex shrink-0 gap-1">
                {[30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => void switchDays(d)}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
                      chart.days === d
                        ? "bg-orange-500 text-white"
                        : "bg-default-100 text-default-500 hover:bg-orange-100 hover:text-orange-600 dark:bg-default-800 dark:hover:bg-orange-500/20"
                    }`}
                  >
                    {d}天
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-0.5 text-[11px] text-default-500">
              {chart.days} 天价格轨迹（{chart.points.length} 个价格点）
            </div>
            {chartData.length >= 2 ? (
              <div className="mt-3 h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="savingsPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="currentColor" opacity={0.4} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="currentColor" opacity={0.4} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="价格"
                      stroke="#f97316"
                      strokeWidth={2}
                      fill="url(#savingsPrice)"
                      dot={{ r: 2, fill: "#f97316" }}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-6 text-center text-[12px] text-default-500">
                数据积累中（监控扫描后每天记录一个价格点）
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-default-500">
              <span>当前 ¥{chart.current ?? "-"}</span>
              <span>30 日均价 ¥{chart.avg30 ?? "-"}</span>
              <span>最低 ¥{chart.min30 ?? "-"}</span>
              {chart.belowAvgPct !== null && chart.belowAvgPct > 0 && (
                <span className="font-bold text-orange-500 dark:text-orange-400">低于均价 {chart.belowAvgPct}% 🎯</span>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="flat"
                className="flex-1"
                onPress={() => void switchDays(chart.days === 30 ? 90 : 30)}
                startContent={<BellRing className="h-3.5 w-3.5" />}
              >
                订阅降价提醒
              </Button>
              <Button variant="flat" className="flex-1" onPress={() => setChart(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 盯价订阅弹层（P3） */}
      {watchTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setWatchTarget(null)}
        >
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
    </div>
  );
}
