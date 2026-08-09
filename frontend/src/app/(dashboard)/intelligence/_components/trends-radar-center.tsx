"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Radar, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

interface HotTopic {
  title: string;
  platform: string;
  heat?: string;
  url?: string;
}

const PLATFORM_TINT: Record<string, "accent" | "success" | "warning" | "danger"> = {
  知乎: "accent",
  抖音: "danger",
  快手: "warning",
  B站: "success",
};

/** 趋势雷达——真实全网热榜（RedFox 热榜技能，30 分钟缓存），不再写死 */
export function TrendsRadarCenter() {
  const router = useRouter();
  const [items, setItems] = useState<HotTopic[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ items?: HotTopic[]; fetchedAt?: number }>(
        "/redfox/hot-topics",
      );
      setItems(result?.items || []);
      setFetchedAt(result?.fetchedAt || null);
    } catch (err: unknown) {
      setError(toPublicError(err, "热榜读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Radar className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">趋势雷达</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              全网实时热榜（知乎/抖音/快手/头条/B站）
              {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 更新` : ""}
            </p>
          </div>
        </div>
        <V2GhostButton icon={RefreshCcw} loading={loading} onClick={() => void load()}>
          刷新
        </V2GhostButton>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <V2EmptyState
          icon={Radar}
          title="热榜暂时没有内容"
          description="数据服务拉取失败或还没有同步，点右上角刷新重试；也可先去「数据服务连接」检查"
          action={
            <V2GhostButton onClick={() => router.push("/intelligence/redfox")}>
              去检查连接
            </V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`实时热榜 TOP ${items.length}`}>
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <div
                key={`${item.title}-${i}`}
                className="kaypal-v3-surface flex items-center gap-4 p-4"
              >
                <span className="w-6 text-center text-lg font-bold text-[var(--kaypal-v3-muted)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                    {item.heat ? `热度 ${item.heat}` : "实时热榜"}
                  </p>
                </div>
                <V2StatusChip tone={PLATFORM_TINT[item.platform] || "accent"}>
                  {item.platform}
                </V2StatusChip>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-accent)]"
                    title="查看原文"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
