"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { getMarketApps, type MarketAppState } from "@/lib/api/app-market";
import { toPublicError } from "@/lib/public-error";

export function AppsCenter() {
  const router = useRouter();
  const [apps, setApps] = useState<MarketAppState[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchApps = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMarketApps();
      setApps(data);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载应用失败"));
      reportLoadError(error, "应用市场暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchApps();
  }, [fetchApps]);

  const items: ResourceItem[] = apps.map((app) => ({
    id: app.appKey,
    title: app.name,
    description: app.description,
    badges: [
      app.installed ? "已安装" : app.purchased ? "已购买" : app.priceLabel,
    ].filter(Boolean),
    enabled: app.installed,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchApps()} />
      ) : null}
      <ResourceCenter
        title="应用与安装"
        subtitle="安装你需要的功能应用，按需扩展系统能力"
        resourceName="应用"
        icon={LayoutGrid}
        items={items}
        loading={loading}
        onItemClick={(item) => router.push(`/apps/detail?key=${item.id}`)}
      />
    </div>
  );
}
