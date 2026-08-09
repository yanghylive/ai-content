"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Folder,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineFileAccessItem } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EngineFiles() {
  const router = useRouter();
  const [items, setItems] = useState<LocalEngineFileAccessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setError(null);
    try {
      const data = await localEngineApi.fileAccessStatus();
      const list = Array.isArray(data)
        ? data
        : (data as { items?: LocalEngineFileAccessItem[] }).items || [];
      setItems(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载文件状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchItems();
    setChecking(false);
  };

  const okCount = items.filter((i) => i.exists && i.readable).length;
  const failCount = items.length - okCount;

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/local-engine")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              文件与凭证
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统需要的文件和目录是否可访问
            </p>
          </div>
          <V2StatusChip tone={failCount > 0 ? "warning" : "success"}>
            {loading ? "检查中" : failCount > 0 ? `${failCount} 项异常` : "全部可访问"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section title="访问状态" padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <V2EmptyState icon={Folder} title="没有需要检查的文件" />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {items.map((item) => {
              const ok = item.exists && item.readable;
              return (
                <div key={item.key} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    {item.kind === "directory" ? (
                      <Folder className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                    ) : (
                      <FileText className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                    )}
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {item.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--kaypal-v3-muted)]">
                        {item.path}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ok ? (
                      <span className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-success)]">
                        <CheckCircle2 className="h-4 w-4" />
                        可访问{item.fileCount !== undefined ? `（${item.fileCount} 个文件）` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-danger)]">
                        <XCircle className="h-4 w-4" />
                        {!item.exists ? "不存在" : !item.readable ? "不可读" : "异常"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={RefreshCcw} loading={checking} onClick={() => void handleRecheck()}>
          {checking ? "正在检查..." : "重新检查"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
