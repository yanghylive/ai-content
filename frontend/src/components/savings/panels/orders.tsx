"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Chip, addToast } from "@heroui/react";
import { Package, RefreshCw, Search } from "lucide-react";
import { savingsApi, type OrderItem } from "@/lib/api/savings";
import type { TabKey } from "../shell";

interface OrdersPanelProps {
  onNavigate: (tab: TabKey) => void;
}

const STATUS_META: Record<string, { label: string; color: "success" | "warning" | "default" | "primary" }> = {
  paid: { label: "已付款", color: "primary" },
  confirmed: { label: "已确认", color: "warning" },
  settled: { label: "已结算", color: "success" },
  expired: { label: "已失效", color: "default" },
  cancelled: { label: "已取消", color: "default" },
};

const PLATFORM_LABEL: Record<string, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  pdd: "拼多多",
  douyin: "抖音",
  meituan: "美团",
  eleme: "饿了么",
};

/** 模块级 toast（无组件状态依赖） */
function toast(title: string, color: "success" | "danger" = "success") {
  addToast({ title, color });
}

export function OrdersPanel({ onNavigate }: OrdersPanelProps) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await savingsApi.listOrders(filter || undefined);
      setItems(res.items);
      setTotal(res.total);
    } catch {
      toast("订单列表加载失败", "danger");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabel = (status: string) => STATUS_META[status]?.label ?? status;
  const statusColor = (status: string) => STATUS_META[status]?.color ?? "default";

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xl font-extrabold tracking-tight text-foreground">
          <Package className="h-5 w-5 text-orange-500 dark:text-orange-400" />
          订单
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-default-200 px-2.5 py-1.5 text-12 text-default-600 transition-colors hover:border-orange-300 hover:text-orange-500 dark:border-default-800 dark:text-default-400"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </button>
      </div>
      <div className="mt-0.5 text-12 text-default-500">订单状态透明，返利到账有预期</div>

      {/* 状态筛选 */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {[
          { key: "", label: "全部" },
          { key: "paid", label: "已付款" },
          { key: "confirmed", label: "已确认" },
          { key: "settled", label: "已结算" },
        ].map((f) => (
          <Chip
            key={f.key}
            size="sm"
            variant={filter === f.key ? "solid" : "flat"}
            color={filter === f.key ? "primary" : "default"}
            onClick={() => setFilter(f.key)}
            className="cursor-pointer"
          >
            {f.label}
          </Chip>
        ))}
      </div>

      {/* 订单列表 */}
      {loading ? (
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-default-200 bg-white p-3.5 dark:border-default-800 dark:bg-content1">
              <div className="h-3.5 w-2/3 rounded bg-default-200 dark:bg-default-800" />
              <div className="mt-2.5 h-3 w-1/2 rounded bg-default-100 dark:bg-default-800" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-default-300 py-10 text-center dark:border-default-700">
          <Search className="h-8 w-8 text-orange-300 dark:text-orange-500/40" strokeWidth={1.5} />
          <div className="text-13 font-semibold text-foreground">还没有返利订单</div>
          <div className="max-w-[260px] text-11 leading-5 text-default-500">
            先去搜索比价，通过推广链接下单后，订单会在这里自动追踪
          </div>
          <button
            type="button"
            onClick={() => onNavigate("compare")}
            className="mt-1 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2 text-xs font-bold text-white"
          >
            去比价
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          <div className="text-11 text-default-400">共 {total} 笔</div>
          {items.map((o) => (
            <div key={o.id} className="rounded-xl border border-default-200 bg-white p-3.5 dark:border-default-800 dark:bg-content1">
              <div className="flex items-center justify-between">
                <span className="text-13 font-bold text-foreground">
                  {PLATFORM_LABEL[o.platformCode] ?? o.platformCode} · 订单返利
                </span>
                <Chip size="sm" color={statusColor(o.status)} variant="flat">
                  {statusLabel(o.status)}
                </Chip>
              </div>
              <div className="mt-1.5 font-mono text-11 text-default-400">{o.orderNo}</div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-12 text-default-500">
                  实付 <b className="text-foreground">¥{o.payAmount}</b>
                </span>
                <span className="text-13 font-extrabold text-orange-500 dark:text-orange-400">
                  返 ¥{o.userRebate}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-11 text-default-400">
                <span>{o.paidAt ? `下单 ${o.paidAt.slice(0, 10)}` : o.createdAt.slice(0, 10)}</span>
                {o.status === "paid" && <span className="text-emerald-500">预计确认后返利入账</span>}
                {o.status === "confirmed" && <span className="text-emerald-500">已确认，等待结算</span>}
                {o.status === "settled" && <span className="text-emerald-500">已结算到账 ✅</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
