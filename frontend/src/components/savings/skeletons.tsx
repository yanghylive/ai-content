"use client";

import React from "react";
import { Skeleton } from "@heroui/react";

/** 资产卡加载骨架 */
export function WalletSkeleton() {
  return (
    <div className="rounded-2xl border border-default-200 bg-white p-4 dark:border-default-800 dark:bg-content1">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-lg" />
      </div>
      <div className="mt-3 flex gap-6">
        <Skeleton className="h-4 w-24 rounded-md" />
        <Skeleton className="h-4 w-24 rounded-md" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-xl" />
        <Skeleton className="h-9 flex-1 rounded-xl" />
      </div>
    </div>
  );
}

/** 商品卡加载骨架 */
export function ProductSkeleton({ count = 4, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className="grid gap-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-xl border border-default-200 bg-white p-3 dark:border-default-800 dark:bg-content1"
        >
          <Skeleton className={`${compact ? "h-14" : "h-[88px]"} w-[88px] shrink-0 rounded-lg`} />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-3.5 w-full rounded-md" />
            <Skeleton className="h-3.5 w-3/4 rounded-md" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
