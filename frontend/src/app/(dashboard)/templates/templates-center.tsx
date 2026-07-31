"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { stylesApi, type Style } from "@/lib/api/styles";
import { toPublicError } from "@/lib/public-error";

export function TemplatesCenter() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const data = await stylesApi.list("template");
      setTemplates(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载模板失败"));
    } finally {
      setLoading(false);
    }
  }, []);

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
    <ResourceCenter
      title="内容模板"
      subtitle="预设的内容结构，一键套用到你的创作"
      resourceName="模板"
      icon={LayoutTemplate}
      items={items}
      loading={loading}
      onCreate={() => router.push("/templates/new")}
      onItemClick={(item) => router.push(`/templates/${item.id}/edit`)}
    />
  );
}
