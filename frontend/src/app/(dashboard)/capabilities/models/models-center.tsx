"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { settingsApi, type AIModel } from "@/lib/api/settings";
import { toPublicError } from "@/lib/public-error";

export function ModelsCenter() {
  const router = useRouter();
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.listModels();
      setModels(Array.isArray(data) ? data : []);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载模型失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const items: ResourceItem[] = models.map((model) => ({
    id: model.id,
    title: model.name,
    description: model.modelId,
    badges: [model.platform?.name].filter(Boolean) as string[],
    enabled: model.enabled,
  }));

  return (
    <ResourceCenter
      title="AI 模型"
      subtitle="管理系统可用的 AI 模型，控制启用状态"
      resourceName="模型"
      icon={Cpu}
      items={items}
      loading={loading}
      onCreate={() => router.push("/capabilities/models/new")}
      onItemClick={(item) =>
        router.push(`/capabilities/models/edit?id=${item.id}`)
      }
    />
  );
}
