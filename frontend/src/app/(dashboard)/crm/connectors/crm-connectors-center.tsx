"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

interface ConnectorItem {
  connectorKey: string;
  connectorName: string;
  status: string;
  summary?: string;
  nextActions?: string[];
}

/** 数据连接——真实连接器就绪状态（不再写死） */
export function CrmConnectorsCenter() {
  const router = useRouter();
  const [items, setItems] = useState<ConnectorItem[]>([]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await api.get("/crm/connectors/readiness").catch(() => null)) as {
        connectors?: ConnectorItem[];
        summary?: string;
      } | null;
      setItems(result?.connectors || []);
      setSummary(result?.summary || "");
    } catch (err: unknown) {
      setError(toPublicError(err, "连接状态读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readyCount = items.filter((i) => i.status === "ready" || i.status === "connected").length;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Plug className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">数据连接</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {summary || "把你的客户数据源接到系统里，自动同步"}
            </p>
          </div>
        </div>
        <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
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
          icon={Plug}
          title="还没有数据源连接"
          description="客户数据可以从导入开始，先不用急着接外部系统"
          action={
            <V2GhostButton onClick={() => router.push("/crm-import-v2")}>
              去导入客户
            </V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`数据源（${readyCount}/${items.length} 就绪）`}>
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.connectorKey} className="kaypal-v3-surface p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--kaypal-v3-ink)]">{item.connectorName}</h3>
                  <V2StatusChip tone={item.status === "ready" || item.status === "connected" ? "success" : "warning"}>
                    {item.status === "ready" ? "就绪" : item.status === "connected" ? "已连接" : "待配置"}
                  </V2StatusChip>
                </div>
                {item.summary ? (
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">{item.summary}</p>
                ) : null}
                {item.nextActions && item.nextActions.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--kaypal-v3-accent-ink)]">
                    下一步:{item.nextActions[0]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
