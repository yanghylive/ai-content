"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu } from "@/components/iconpark";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { settingsApi, type AIModel } from "@/lib/api/settings";
import { toPublicError } from "@/lib/public-error";

export function ModelsCenter() {
  const router = useRouter();
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.listModels();
      setModels(Array.isArray(data) ? data : []);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载模型失败"));
      reportLoadError(error, "AI 模型列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

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
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchModels()} />
      ) : null}
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
    </div>
  );
}
