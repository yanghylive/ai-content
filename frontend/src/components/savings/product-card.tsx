"use client";

import React from "react";
import { BellRing, Heart, ShoppingBag } from "lucide-react";
import type { OfferView } from "@/lib/api/savings";

const PLATFORM_LABEL: Record<string, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  pdd: "拼多多",
  douyin: "抖音",
  meituan: "美团",
  eleme: "饿了么",
  weipinhui: "唯品会",
};

/** 平台名 → 简洁徽章色（按平台品牌） */
function platformChip(platformCode: string) {
  const map: Record<string, string> = {
    taobao: "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
    tmall: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
    jd: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
    pdd: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
    douyin: "bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200",
    meituan: "bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/30",
    eleme: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
  };
  return map[platformCode] ?? "bg-default-100 text-default-600 border-default-200 dark:bg-default-800 dark:text-default-300 dark:border-default-700";
}

interface ProductCardProps {
  offer: OfferView;
  onBuy: (offer: OfferView) => void;
  /** 横向滚动小卡（限时特惠/美团） */
  compact?: boolean;
  /** 美团等本地生活活动卡：展示佣金率而非返利现金 */
  commissionMode?: boolean;
  /** 是否显示「去购买」按钮 */
  showCta?: boolean;
  /** 收藏状态与切换（提供则显示收藏按钮） */
  favorited?: boolean;
  onToggleFavorite?: (offer: OfferView) => void;
  /** 盯价订阅（提供则显示「盯价」按钮，P3） */
  onWatch?: (offer: OfferView) => void;
  /** 全网最低徽标（P3 跨平台价差） */
  cheapestBadge?: boolean;
  /** 价差信息（如「比最高省 ¥6.2」，P3） */
  priceGapNote?: string | null;
}

export function ProductCard({
  offer,
  onBuy,
  compact = false,
  commissionMode = false,
  showCta = true,
  favorited = false,
  onToggleFavorite,
  onWatch,
  cheapestBadge = false,
  priceGapNote = null,
}: ProductCardProps) {
  const { title, imageUrl, payPrice, estRebate, couponAmount, platformCode, commissionRate } = offer;
  const label = PLATFORM_LABEL[platformCode] ?? platformCode;

  if (compact) {
    return (
      <div className="w-[140px] shrink-0 overflow-hidden rounded-xl border border-default-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-default-800 dark:bg-content1">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="h-[88px] w-full object-cover" />
        ) : (
          <div className="flex h-[88px] w-full items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100 text-2xl dark:from-default-800 dark:to-default-900">
            🏷️
          </div>
        )}
        <div className="p-2">
          <div className="line-clamp-2 text-11 leading-4 text-foreground">{title}</div>
          <div className="mt-1 flex items-baseline gap-1">
            {commissionMode ? (
              <span className="text-11 font-bold text-orange-500 dark:text-orange-400">
                佣金 {commissionRate}%
              </span>
            ) : (
              <>
                <span className="text-11 font-semibold text-default-500">¥</span>
                <span className="text-14 font-extrabold text-foreground">{payPrice}</span>
                <span className="ml-auto text-11 font-bold text-orange-500 dark:text-orange-400">
                  返 ¥{estRebate}
                </span>
              </>
            )}
          </div>
          {showCta && (
            <button
              type="button"
              onClick={() => onBuy(offer)}
              className="mt-1.5 w-full rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 py-1 text-11 font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {commissionMode ? "领券省钱" : "去购买"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-xl border border-default-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-default-800 dark:bg-content1">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={title} className="h-[88px] w-[88px] shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-50 to-amber-100 text-2xl dark:from-default-800 dark:to-default-900">
          🏷️
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="line-clamp-2 text-13 font-semibold leading-5 text-foreground">{title}</div>
          {cheapestBadge && (
            <span className="shrink-0 rounded-md bg-red-500 px-1.5 py-0.5 text-11 font-bold text-white">
              全网最低
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-11 text-default-500">
          <span>{offer.shopName || label}</span>
          <span className={`rounded border px-1 py-px text-11 ${platformChip(platformCode)}`}>
            {label}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-12 font-extrabold text-foreground">
            <span className="text-11 font-semibold text-default-500">到手 ¥</span>
            {payPrice}
          </span>
          <span className="text-13 font-extrabold text-orange-500 dark:text-orange-400">返 ¥{estRebate}</span>
          <span className="text-11 text-default-500">
            净成本 <b className="text-default-700 dark:text-default-300">¥{offer.estNetCost}</b>
          </span>
          {offer.specQty && offer.unitPrice ? (
            <span className="text-11 text-default-500">
              单件 <b className="text-default-700 dark:text-default-300">¥{offer.unitPrice}</b>
              <span className="text-default-400">/{offer.specQty}件装</span>
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {couponAmount > 0 && (
            <span className="rounded bg-red-50 px-1.5 py-px text-11 font-bold text-red-600 dark:bg-red-500/10 dark:text-red-300">
              ¥{couponAmount}券
            </span>
          )}
          {commissionRate > 0 && (
            <span className="rounded bg-emerald-50 px-1.5 py-px text-11 font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              佣金 {commissionRate}%
            </span>
          )}
          {priceGapNote && (
            <span className="rounded bg-blue-50 px-1.5 py-px text-11 font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              {priceGapNote}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {onWatch && (
              <button
                type="button"
                onClick={() => onWatch(offer)}
                aria-label="盯价"
                className="flex h-8 items-center gap-1 rounded-lg border border-default-200 px-2 text-11 font-semibold text-default-500 transition-colors hover:border-orange-300 hover:text-orange-500 dark:border-default-800"
              >
                <BellRing className="h-3.5 w-3.5" />
                盯价
              </button>
            )}
            {onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(offer)}
                aria-label={favorited ? "取消收藏" : "收藏"}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  favorited
                    ? "border-red-200 bg-red-50 text-red-500 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400"
                    : "border-default-200 text-default-400 hover:border-red-200 hover:text-red-400 dark:border-default-800"
                }`}
              >
                <Heart className="h-4 w-4" fill={favorited ? "currentColor" : "none"} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onBuy(offer)}
              className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-1.5 text-xs font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              去购买
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
