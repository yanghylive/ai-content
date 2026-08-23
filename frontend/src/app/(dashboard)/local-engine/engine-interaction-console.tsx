"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  MessageSquareText,
  RefreshCcw,
  Send,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2Textarea,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EngineInteractionConsole({
  title = "客户互动",
  subtitle = "AI 已写好回复草稿，你确认后才会发出去",
  backHref = "/local-engine",
  typeKeywords,
}: {
  title?: string;
  subtitle?: string;
  backHref?: string;
  /** 只显示任务类型/对象包含这些关键词的互动（频道页用） */
  typeKeywords?: string[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<InteractionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.tasks(50);
      const pending = (Array.isArray(data) ? data : []).filter((t) => {
        if (t.status !== "waiting_for_send_confirmation") return false;
        if (!typeKeywords || typeKeywords.length === 0) return true;
        const haystack = `${t.typeLabel || ""} ${t.type || ""} ${t.targetName || ""}`.toLowerCase();
        return typeKeywords.some((k) => haystack.includes(k.toLowerCase()));
      });
      setTasks(pending);
      // 初始化草稿为系统生成的回复
      const initial: Record<string, string> = {};
      pending.forEach((t) => {
        initial[t.id] = t.replyText || "";
      });
      setDrafts(initial);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载互动失败"));
    } finally {
      setLoading(false);
    }
  }, [typeKeywords]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleApprove = async (task: InteractionTask) => {
    setActingId(task.id);
    setError(null);
    try {
      await localEngineApi.approveTask(task.id, {
        contentConfirmed: true,
        targetConfirmed: true,
        checklistConfirmed: true,
        replyText: drafts[task.id]?.trim() || undefined,
      });
      await fetchTasks();
    } catch (err: unknown) {
      setError(toPublicError(err, "确认失败，请稍后重试"));
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
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {title}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {subtitle}
            </p>
          </div>
          <V2StatusChip tone={tasks.length > 0 ? "warning" : "success"}>
            {loading ? "加载中" : tasks.length > 0 ? `${tasks.length} 条待确认` : "全部处理完"}
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
          <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
        </div>
      ) : tasks.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={CheckCircle2}
            title="没有待确认的互动"
            description="有新消息需要回复时，会出现在这里"
          />
        </V2Section>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <V2Section key={task.id} padding={false}>
              <div className="p-5">
                {/* 来源消息 */}
                <div className="flex items-start gap-3">
                  <div className="kaypal-v3-icon-tile">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {task.targetName || task.accountName || "客户"}
                      </p>
                      <span className="text-xs text-[var(--kaypal-v3-muted)]">
                        {task.typeLabel}
                      </span>
                    </div>
                    <p className="mt-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
                      {task.sourceText || "（无内容）"}
                    </p>
                  </div>
                </div>

                {/* AI 回复草稿 */}
                <div className="mt-4">
                  <p className="text-sm font-medium text-[var(--kaypal-v3-muted)]">
                    AI 回复草稿（可修改）：
                  </p>
                  <div className="mt-2">
                    <V2Textarea
                      rows={3}
                      value={drafts[task.id] || ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [task.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                {/* 操作 */}
                <div className="mt-4 flex items-center justify-end gap-2">
                  <V2PrimaryButton
                    icon={Send}
                    loading={actingId === task.id}
                    onClick={() => void handleApprove(task)}
                  >
                    确认并发送
                  </V2PrimaryButton>
                </div>
              </div>
            </V2Section>
          ))}
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push(backHref)}>
          返回
        </V2GhostButton>
        <V2GhostButton icon={RefreshCcw} onClick={() => void fetchTasks()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}
