"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { stylesApi, type Style } from "@/lib/api/styles";
import { toPublicError } from "@/lib/public-error";

export function TemplatesCenter() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stylesApi.list("template");
      setTemplates(data);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载模板失败"));
      reportLoadError(error, "内容模板列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const items: ResourceItem[] = templates.map((t) => ({
    id: t.id,
    title: t.name,
    description: t.description || undefined,
    isDefault: t.isDefault,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchTemplates()} />
      ) : null}
      <ResourceCenter
        title="内容模板"
        subtitle="预设的内容结构，一键套用到你的创作"
        resourceName="模板"
        icon={LayoutTemplate}
        items={items}
        loading={loading}
        onCreate={() => router.push("/templates/new")}
        onItemClick={(item) => router.push(`/templates/edit?id=${encodeURIComponent(item.id)}`)}
      />
    </div>
  );
}
