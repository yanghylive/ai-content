"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { kaypalApi, type LocalKnowledgeItem } from "@/lib/api/auth";
import { toPublicError } from "@/lib/public-error";

const SYNC_LABELS: Record<string, string> = {
  synced: "已同步",
  pending: "待同步",
  failed: "同步失败",
};

export function KnowledgeBaseCenter() {
  const router = useRouter();
  const [knowledge, setKnowledge] = useState<LocalKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchKnowledge = useCallback(async () => {
    try {
      setLoading(true);
      const result = await kaypalApi.listLocalKnowledge();
      setKnowledge(result.items || []);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载知识库失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKnowledge();
  }, [fetchKnowledge]);

  const items: ResourceItem[] = knowledge.map((item) => ({
    id: item.id,
    title: item.title || item.fileName || "未命名",
    description: item.summary || undefined,
    badges: [
      item.contentType,
      SYNC_LABELS[item.syncStatus] || item.syncStatus,
    ].filter(Boolean) as string[],
    enabled: item.syncStatus !== "failed",
    meta: item.updatedAt
      ? new Date(item.updatedAt).toLocaleDateString("zh-CN")
      : undefined,
  }));

  return (
    <ResourceCenter
      title="知识库"
      subtitle="把你的资料喂给 AI，生成的内容更懂你的业务"
      resourceName="知识"
      icon={BookOpen}
      items={items}
      loading={loading}
      onCreate={() => router.push("/knowledge-base/new")}
      onItemClick={(item) => router.push(`/knowledge-base?item=${item.id}`)}
    />
  );
}
