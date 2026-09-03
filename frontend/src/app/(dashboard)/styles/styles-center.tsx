"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Palette } from "@/components/iconpark";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { stylesApi, type Style } from "@/lib/api/styles";
import { toPublicError } from "@/lib/public-error";

const TYPE_LABELS: Record<Style["type"], string> = {
  article: "文章",
  image: "图片",
  template: "模板",
  xiaohongshu: "小红书",
};

export function StylesCenter() {
  const router = useRouter();
  const [styles, setStyles] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchStyles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stylesApi.list();
      setStyles(data);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载风格失败"));
      reportLoadError(error, "内容风格列表暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchStyles();
  }, [fetchStyles]);

  const items: ResourceItem[] = styles.map((s) => ({
    id: s.id,
    title: s.name,
    description: s.description || undefined,
    badges: [TYPE_LABELS[s.type]].filter(Boolean),
    isDefault: s.isDefault,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchStyles()} />
      ) : null}
      <ResourceCenter
        title="内容风格"
        subtitle="定义内容的语言和视觉风格，保持品牌一致性"
        resourceName="风格"
        icon={Palette}
        items={items}
        loading={loading}
        onCreate={() => router.push("/styles/new")}
        onItemClick={(item) => router.push(`/styles/edit?id=${encodeURIComponent(item.id)}`)}
      />
    </div>
  );
}
