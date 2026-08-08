"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Palette } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
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

  const fetchStyles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stylesApi.list();
      setStyles(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载风格失败"));
    } finally {
      setLoading(false);
    }
  }, []);

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
  );
}
