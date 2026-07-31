"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FolderInput,
  Lightbulb,
  Inbox,
  CheckCircle2,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import {
  intelligenceApi,
  type IntelligenceItem,
} from "@/lib/api/intelligence";
import { toPublicError } from "@/lib/public-error";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  gongzhonghao: "公众号",
  bilibili: "B站",
};

export function InboxProcessing() {
  const router = useRouter();
  const [items, setItems] = useState<IntelligenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMap, setDoneMap] = useState<Record<string, string>>({});

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const data = await intelligenceApi.listItems({ limit: 50 });
      const list = Array.isArray(data)
        ? data
        : (data as { items?: IntelligenceItem[] }).items || [];
      setItems(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载线索失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const pendingItems = useMemo(
    () => items.filter((item) => !doneMap[item.id]),
    [items, doneMap],
  );

  const handleImportMaterial = async (item: IntelligenceItem) => {
    setActingId(item.id);
    setError(null);
    try {
      await intelligenceApi.importMaterial(item.id, {});
      setDoneMap((prev) => ({ ...prev, [item.id]: "已导入素材库" }));
    } catch (err: unknown) {
      setError(toPublicError(err, "导入失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  const handleGenerateTopic = async (item: IntelligenceItem) => {
    setActingId(item.id);
    setError(null);
    try {
      await intelligenceApi.generateTopic(item.id, {});
      setDoneMap((prev) => ({ ...prev, [item.id]: "已生成选题" }));
    } catch (err: unknown) {
      setError(toPublicError(err, "生成失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/intelligence/inbox")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              线索收件箱
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              看到有用的线索，一键导入素材库或生成选题
            </p>
          </div>
          <V2StatusChip tone={pendingItems.length > 0 ? "warning" : "success"}>
            {loading ? "加载中" : pendingItems.length > 0 ? `${pendingItems.length} 条待处理` : "全部处理完"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : pendingItems.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={CheckCircle2}
            title="收件箱已清空"
            description="监控发现新线索时会出现在这里"
          />
        </V2Section>
      ) : (
        <div className="space-y-4">
          {pendingItems.map((item) => (
            <V2Section key={item.id} padding={false}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <V2StatusChip tone="accent">
                        {PLATFORM_LABELS[item.platform] || item.platform}
                      </V2StatusChip>
                      {item.author && (
                        <span className="text-sm text-[var(--kaypal-v3-muted)]">
                          {item.author}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 font-medium text-[var(--kaypal-v3-ink)]">
                      {item.title || "（无标题）"}
                    </h3>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--kaypal-v3-muted)]">
                        {item.summary}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <V2GhostButton
                    icon={FolderInput}
                    loading={actingId === item.id}
                    onClick={() => void handleImportMaterial(item)}
                  >
                    导入素材库
                  </V2GhostButton>
                  <V2PrimaryButton
                    icon={Lightbulb}
                    loading={actingId === item.id}
                    onClick={() => void handleGenerateTopic(item)}
                  >
                    生成选题
                  </V2PrimaryButton>
                </div>
              </div>
            </V2Section>
          ))}
        </div>
      )}

      {Object.keys(doneMap).length > 0 && (
        <div className="kaypal-v3-surface p-4">
          <p className="text-sm text-[var(--kaypal-v3-success)]">
            ✓ 本次已处理 {Object.keys(doneMap).length} 条：
            {Object.values(doneMap).filter((v) => v.includes("素材")).length} 条导入素材，
            {Object.values(doneMap).filter((v) => v.includes("选题")).length} 条生成选题
          </p>
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/intelligence/inbox")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
