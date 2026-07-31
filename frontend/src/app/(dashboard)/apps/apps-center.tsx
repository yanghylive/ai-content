"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { getMarketApps, type MarketAppState } from "@/lib/api/app-market";
import { toPublicError } from "@/lib/public-error";

export function AppsCenter() {
  const router = useRouter();
  const [apps, setApps] = useState<MarketAppState[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApps = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMarketApps();
      setApps(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载应用失败"));
    } finally {
      setLoading(false);
    }
  }, []);

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
    <ResourceCenter
      title="应用与安装"
      subtitle="安装你需要的功能应用，按需扩展系统能力"
      resourceName="应用"
      icon={LayoutGrid}
      items={items}
      loading={loading}
      onItemClick={(item) => router.push(`/apps/detail?key=${item.id}`)}
    />
  );
}
