"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import {
  contentStrategiesApi,
  type ContentStrategy,
} from "@/lib/api/content-strategies";
import { toPublicError } from "@/lib/public-error";

export function StrategiesCenter() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStrategies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await contentStrategiesApi.list();
      setStrategies(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载内容策略失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStrategies();
  }, [fetchStrategies]);

  const items: ResourceItem[] = strategies.map((s) => ({
    id: s.id,
    title: s.name,
    description: s.description || s.commercialGoal || undefined,
    badges: [s.industry, s.targetAudience].filter(Boolean) as string[],
    isDefault: s.isDefault,
    enabled: s.enabled,
  }));

  return (
    <ResourceCenter
      title="内容策略"
      subtitle="定义你的内容方向和目标，AI 按策略生成内容"
      resourceName="策略"
      icon={Compass}
      items={items}
      loading={loading}
      onCreate={() => router.push("/strategies/new")}
      onItemClick={(item) => router.push(`/strategies/edit?id=${encodeURIComponent(item.id)}`)}
    />
  );
}
