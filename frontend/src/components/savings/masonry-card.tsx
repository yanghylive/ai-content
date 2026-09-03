"use client";

import React from "react";
import { BellRing, Heart, ShoppingBag, Tag } from "@/components/iconpark";
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

const PLATFORM_CHIP: Record<string, string> = {
  taobao: "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
  tmall: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  jd: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  pdd: "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  douyin: "bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200",
  meituan: "bg-yellow-50 text-yellow-600 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/30",
  eleme: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
};

/**
 * 瀑布流商品卡（首页分类商品流专用，2 列网格）：
 * 大图 + 标题 + 平台徽标 + 价格/返利/券 + 底部 CTA。
 * 设计要点：图在上（16:10 视觉焦点），返利金额橙色加粗，券标红底，
 * 平台标小徽章，CTA 整行渐变按钮。
 */
export function MasonryCard({
  offer,
  onBuy,
  onWatch,
  favorited = false,
  onToggleFavorite,
}: {
  offer: OfferView;
  onBuy: (offer: OfferView) => void;
  onWatch?: (offer: OfferView) => void;
  favorited?: boolean;
  onToggleFavorite?: (offer: OfferView) => void;
}) {
  const { title, imageUrl, payPrice, estRebate, couponAmount, platformCode, commissionRate } = offer;
  const label = PLATFORM_LABEL[platformCode] ?? platformCode;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-default-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-default-800 dark:bg-content1">
      {/* 图区（16:10） */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-default-100 dark:bg-default-800">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100 text-3xl dark:from-default-800 dark:to-default-900">
            🏷️
          </div>
        )}
        {/* 券角标（图左上） */}
        {couponAmount > 0 && (
          <span className="absolute left-2 top-2 flex items-center gap-0.5 rounded-md bg-red-500 px-1.5 py-0.5 text-11 font-bold text-white shadow-sm">
            <Tag className="h-3 w-3" />
            ¥{couponAmount}券
          </span>
        )}
        {/* 佣金角标（图右上） */}
        {commissionRate > 0 && (
          <span className="absolute right-2 top-2 rounded-md bg-emerald-500 px-1.5 py-0.5 text-11 font-bold text-white shadow-sm">
            {commissionRate}%
          </span>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col p-2.5">
        <div className="line-clamp-2 min-h-[32px] text-12 font-semibold leading-4 text-foreground">{title}</div>
        <div className="mt-1.5 flex items-center gap-1">
          <span className={`rounded border px-1 py-px text-11 font-semibold ${PLATFORM_CHIP[platformCode] ?? "bg-default-100 text-default-500 border-default-200 dark:bg-default-800 dark:text-default-400 dark:border-default-700"}`}>
            {label}
          </span>
          {offer.shopName && (
            <span className="truncate text-11 text-default-400">{offer.shopName}</span>
          )}
        </div>

        {/* 价格区：到手价大 + 返利橙 */}
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="text-11 font-semibold text-default-400">到手</span>
          <span className="text-base font-extrabold leading-none text-foreground">¥{payPrice}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="text-12 font-extrabold text-orange-500 dark:text-orange-400">返 ¥{estRebate}</span>
          <span className="text-11 text-default-400">净 ¥{offer.estNetCost}</span>
        </div>

        {/* CTA 行 */}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => onBuy(offer)}
            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 text-12 font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            去购买
          </button>
          {onWatch && (
            <button
              type="button"
              onClick={() => onWatch(offer)}
              aria-label="盯价"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-default-200 text-default-500 transition-colors hover:border-orange-300 hover:text-orange-500 dark:border-default-800"
            >
              <BellRing className="h-3.5 w-3.5" />
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
              <Heart className="h-3.5 w-3.5" fill={favorited ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
