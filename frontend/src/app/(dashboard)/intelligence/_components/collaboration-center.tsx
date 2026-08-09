"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, Users } from "lucide-react";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

/** 协作复核室——等待人工处理的真实任务（不再写死） */
export function CollaborationCenter() {
  const router = useRouter();
  const [waiting, setWaiting] = useState<InteractionTask[]>([]);
  const [failed, setFailed] = useState<InteractionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tasks = await localEngineApi.tasks(50);
      const list = Array.isArray(tasks) ? tasks : [];
      setWaiting(list.filter((t) => t.status === "waiting_for_send_confirmation"));
      setFailed(list.filter((t) => t.status === "failed").slice(0, 5));
    } catch (err: unknown) {
      setError(toPublicError(err, "复核任务读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = waiting.length + failed.length;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">协作复核室</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              需要人工处理的任务 · 待确认 {waiting.length} · 失败 {failed.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
          {total > 0 && (
            <V2PrimaryButton onClick={() => router.push("/tasks/confirmations")}>
              去处理
            </V2PrimaryButton>
          )}
        </div>
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
      ) : total === 0 ? (
        <V2EmptyState
          icon={Users}
          title="没有需要复核的任务"
          description="等待人工确认的互动任务和失败任务会出现在这里"
        />
      ) : (
        <>
          {waiting.length > 0 && (
            <V2Section title={`等你确认（${waiting.length}）`}>
              <div className="flex flex-col gap-2">
                {waiting.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="kaypal-v3-surface flex items-center justify-between p-4 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                    onClick={() => router.push("/tasks/confirmations")}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {t.targetName || "未命名客户"}：{t.sourceText || "（无原文）"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-muted)]">
                        AI 准备回复：{t.replyText || "（无草稿）"}
                      </p>
                    </div>
                    <V2StatusChip tone="warning">待确认</V2StatusChip>
                  </button>
                ))}
              </div>
            </V2Section>
          )}
          {failed.length > 0 && (
            <V2Section title={`执行失败（${failed.length}）`}>
              <div className="flex flex-col gap-2">
                {failed.map((t) => (
                  <div
                    key={t.id}
                    className="kaypal-v3-surface flex items-center justify-between p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {t.targetName || `任务 ${t.id.slice(0, 8)}`}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-danger)]">
                        {t.failureReason || "执行失败"}
                      </p>
                    </div>
                    <V2StatusChip tone="danger">失败</V2StatusChip>
                  </div>
                ))}
              </div>
            </V2Section>
          )}
        </>
      )}
    </div>
  );
}
