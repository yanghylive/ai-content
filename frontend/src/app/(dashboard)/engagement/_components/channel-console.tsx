"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  Play,
  RefreshCcw,
  Send,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2Select,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type InteractionTask,
  type InteractionBusinessRouteKey,
} from "@/lib/api/local-engine";
import {
  autoUploadApi,
  type AutoUploadAccount,
} from "@/lib/api/auto-upload";
import {
  getCrmWelcomeMessagePreparation,
  linkCrmCustomerConversation,
  type CrmWelcomeMessagePreparation,
} from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { useCdpSessionStatus } from "../../workbench/use-cdp-session-status";

/* ============ 频道配置（4 个页面共用此组件） ============ */

export type ChannelConsoleConfig = {
  title: string;
  subtitle: string;
  taskTypeLabel: string;
  taskType: InteractionTask["type"];
  businessRoute: InteractionBusinessRouteKey;
  accountType: number;
  platformName: string;
  entryType: string; // douyin:comment / douyin:message / wechat-channel:comment / wechat-channel:message
  cdpPlatform: "douyin" | "wechat-channel";
  startButtonLabel: string;
  emptyHint: string;
};

type Step = {
  label: string;
  status: "pending" | "running" | "blocked" | "completed" | "skipped";
  message?: string;
};

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/engine:\s*/gi, "")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/browser-cdp/gi, "本机浏览器")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/sendMode=auto-send/g, "自动发送")
    .replace(/sendMode=approval-send/g, "确认后发送")
    .replace(/\/Users\/[^\s；,，。)）]+/g, "本机文件")
    .replace(/\s+/g, " ")
    .trim();
}

function taskStatusChip(status?: string): {
  label: string;
  tone: "success" | "warning" | "danger" | "accent" | "muted";
} {
  const s = (status || "").toLowerCase();
  if (s === "completed") return { label: "已完成", tone: "success" };
  if (s === "running" || s === "queued") return { label: "进行中", tone: "accent" };
  if (s === "waiting_for_send_confirmation") return { label: "待确认", tone: "warning" };
  if (s === "failed") return { label: "失败", tone: "danger" };
  if (s === "blocked") return { label: "已阻断", tone: "danger" };
  if (s === "paused") return { label: "已暂停", tone: "warning" };
  return { label: status || "未知", tone: "muted" };
}

export function ChannelConsole({ config }: { config: ChannelConsoleConfig }) {
  const router = useRouter();

  // 账号
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // 任务
  const [activeTask, setActiveTask] = useState<InteractionTask | null>(null);
  const [recentTasks, setRecentTasks] = useState<InteractionTask[]>([]);
  const [taskBusy, setTaskBusy] = useState(false);
  const [openBackendBusy, setOpenBackendBusy] = useState(false);

  // 消息
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // CRM 测试发送（从客户档案带消息过来）
  const [crmHandoff, setCrmHandoff] = useState<{
    customerId: string;
    preparationId: string;
  } | null>(null);
  const [crmPreparation, setCrmPreparation] = useState<CrmWelcomeMessagePreparation | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3500);
  };

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  // 真实 CDP 会话检测（替代之前的假连接确认）
  const cdpStatus = useCdpSessionStatus(config.cdpPlatform, selectedAccount);
  const backendReady = cdpStatus.sessionReady;
  const backendMessage = backendReady
    ? `已连接${config.platformName}后台，可以开始任务了`
    : "";

  // 切账号时清空当前任务（避免 A 账号的任务显示在 B 账号视图）
  useEffect(() => {
    setActiveTask(null);
  }, [selectedAccountId]);

  /* 加载账号（平台类型过滤 + 登录态） */
  const loadAccounts = useCallback(async () => {
    try {
      const all = await autoUploadApi.accounts();
      const list = (Array.isArray(all) ? all : []).filter(
        (a) => a.type === config.accountType,
      );
      setAccounts(list);
      setSelectedAccountId((current) => {
        if (current && list.some((a) => a.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch {
      setAccounts([]);
    }
  }, [config.accountType]);

  /* 加载最近任务 */
  const refreshTasks = useCallback(async () => {
    try {
      const tasks = await localEngineApi.businessTasks(config.businessRoute, 20);
      setRecentTasks(tasks);
      setActiveTask((current) => {
        if (current?.id) {
          return tasks.find((t) => t.id === current.id) || current;
        }
        return tasks[0] || null;
      });
    } catch (err: unknown) {
      console.error(toPublicError(err, "加载任务失败"));
    }
  }, [config.businessRoute]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadAccounts(), refreshTasks()]).finally(() =>
      setLoading(false),
    );
  }, [loadAccounts, refreshTasks]);

  /* 读取 URL 里的 CRM 测试发送参数 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get("crmCustomerId")?.trim();
    const preparationId = params.get("crmPreparationId")?.trim();
    if (customerId && preparationId) {
      setCrmHandoff({ customerId, preparationId });
    }
  }, []);

  /* 加载 CRM 准备的消息 */
  useEffect(() => {
    if (!crmHandoff) return;
    getCrmWelcomeMessagePreparation(crmHandoff.customerId, crmHandoff.preparationId)
      .then(setCrmPreparation)
      .catch((err: unknown) => {
        setError(toPublicError(err, "CRM 测试发送准备记录无法加载"));
      });
  }, [crmHandoff]);

  /* 任务 2 秒轮询（与旧版一致） */
  useEffect(() => {
    if (!activeTask?.id) return;
    const timer = setInterval(async () => {
      try {
        const task = await localEngineApi.task(activeTask.id);
        setActiveTask(task);
        setRecentTasks((current) =>
          current.map((item) => (item.id === task.id ? task : item)),
        );
      } catch {
        // 轮询失败静默
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeTask?.id]);

  /* 打开平台后台（与旧版一致：打开后真实复查会话状态） */
  const handleOpenBackend = async () => {
    if (!selectedAccount?.id) {
      router.push("/platforms");
      return;
    }
    setOpenBackendBusy(true);
    setError(null);
    try {
      const result = await autoUploadApi.openInteractionEntry({
        accountId: selectedAccount.id,
        entryType: config.entryType,
      });
      // 真实复查（与旧版一致：立即 + 1.2s + 2.5s 三次），不是假装连接成功
      await cdpStatus.refreshAndGetSession();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const session = await cdpStatus.refreshAndGetSession();
      await new Promise((resolve) => setTimeout(resolve, 1300));
      await cdpStatus.refreshAndGetSession();
      if (session?.status === "ready") {
        flash(`已连接${result.entryName || config.platformName + "后台"}，可以开始任务了`);
      } else {
        flash(
          `已打开${result.entryName || config.platformName + "后台"}，请在里面完成登录后再开始任务`,
        );
      }
    } catch (err: unknown) {
      setError(
        toPublicError(
          err,
          `打开${config.platformName}后台失败，请到平台账号页重新登录`,
        ),
      );
    } finally {
      setOpenBackendBusy(false);
    }
  };

  /* 开始任务（与旧版 createBusinessTask 一致） */
  const handleStart = async () => {
    if (!selectedAccount?.id) {
      setError(`没有可用的${config.platformName}账号，请先到「平台账号」登录`);
      return;
    }
    if (!backendReady) {
      setError(`${config.platformName}后台未连接，请先点「打开${config.platformName}后台」并确认登录`);
      return;
    }
    setTaskBusy(true);
    setError(null);
    try {
      // CRM 测试发送：把准备好的消息作为任务内容传入
      const crmMessage = crmPreparation
        ? ((crmPreparation as { message?: string }).message ||
          (crmPreparation as { content?: string }).content ||
          undefined)
        : undefined;
      const task = await localEngineApi.createBusinessTask(config.businessRoute, {
        type: config.taskType,
        accountId: String(selectedAccount.id),
        accountName:
          selectedAccount.profileName ||
          selectedAccount.userName ||
          `账号 ${selectedAccount.id}`,
        platformType: config.accountType,
        platformName: config.platformName,
        ...(crmMessage
          ? {
              sourceText: crmMessage,
              replyText: crmMessage,
              metadata: {
                crmCustomerId: crmHandoff?.customerId,
                crmPreparationId: crmHandoff?.preparationId,
                messageKind: "welcome-test-send",
              },
            }
          : {}),
      });
      setActiveTask(task);
      setRecentTasks((current) => [task, ...current]);
      // CRM 测试发送：把任务关联回客户档案
      if (crmHandoff) {
        try {
          await linkCrmCustomerConversation(crmHandoff.customerId, {
            interactionTaskId: task.id,
            preparationId: crmHandoff.preparationId,
          });
        } catch {
          // 关联失败不阻断任务
        }
        flash("测试发送任务已创建，并记录到客户档案");
      } else {
        flash("任务已创建，正在读取真实内容");
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "创建任务失败，请稍后重试"));
    } finally {
      setTaskBusy(false);
    }
  };

  /* 任务确认发送 */
  const handleApprove = async (task: InteractionTask) => {
    try {
      await localEngineApi.approveTask(task.id, {
        contentConfirmed: true,
        targetConfirmed: true,
      });
      flash("已确认发送");
      void refreshTasks();
    } catch (err: unknown) {
      setError(toPublicError(err, "确认失败，请稍后重试"));
    }
  };

  const liveEvents = (activeTask?.events || [])
    .filter((e) => e.message && !e.message.includes("已保存"))
    .slice(-8)
    .reverse();

  const statusChip = activeTask ? taskStatusChip(activeTask.status) : null;

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/engagement")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              {config.title}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {config.subtitle}
            </p>
          </div>
          {statusChip && (
            <V2StatusChip tone={statusChip.tone}>{statusChip.label}</V2StatusChip>
          )}
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 第 1 步：选账号 */}
      <V2Section title="第 1 步：用哪个账号？">
        {accounts.length === 0 ? (
          <V2EmptyState
            icon={MonitorSmartphone}
            title={`还没有已登录的${config.platformName}账号`}
            description="先到「平台账号」扫码登录一个"
            action={
              <V2PrimaryButton onClick={() => router.push("/platforms")}>
                去登录账号
              </V2PrimaryButton>
            }
          />
        ) : (
          <V2Select
            value={String(selectedAccountId ?? "")}
            onChange={(e) => setSelectedAccountId(Number(e.target.value))}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.profileName || account.userName || `账号 ${account.id}`}
                {account.sessionStatus === "logged_in" ? "（已登录）" : ""}
              </option>
            ))}
          </V2Select>
        )}
      </V2Section>

      {/* 第 2 步：连接平台后台 */}
      <V2Section
        title={`第 2 步：连接${config.platformName}后台`}
        description="系统会在本机打开平台后台并确认登录状态"
      >
        {backendReady ? (
          <div className="flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--kaypal-v3-success)]">
              <CheckCircle2 className="h-5 w-5" />
              {backendMessage}
            </span>
            <V2GhostButton
              icon={RefreshCcw}
              onClick={() => void handleOpenBackend()}
            >
              重新连接
            </V2GhostButton>
          </div>
        ) : (
          <V2PrimaryButton
            icon={openBackendBusy ? Loader2 : ExternalLink}
            loading={openBackendBusy}
            disabled={!selectedAccount}
            onClick={() => void handleOpenBackend()}
          >
            {openBackendBusy ? "正在打开..." : `打开${config.platformName}后台`}
          </V2PrimaryButton>
        )}
      </V2Section>

      {/* 第 3 步：开始任务 */}
      <V2Section title={`第 3 步：${crmPreparation ? "测试发送" : config.startButtonLabel}`}>
        {/* CRM 测试发送横幅 */}
        {crmPreparation && (
          <div className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-4">
            <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
              CRM 测试发送
            </p>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              给客户发的消息：
            </p>
            <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
              {(crmPreparation as { message?: string }).message ||
                (crmPreparation as { content?: string }).content ||
                "（准备的消息）"}
            </p>
            <button
              type="button"
              className="mt-2 text-xs text-[var(--kaypal-v3-accent-ink)] hover:underline"
              onClick={() => router.push(`/crm/detail?id=${crmHandoff?.customerId}`)}
            >
              返回客户档案 →
            </button>
          </div>
        )}
        <V2PrimaryButton
          icon={taskBusy ? Loader2 : Play}
          loading={taskBusy}
          disabled={!backendReady}
          onClick={() => void handleStart()}
        >
          {taskBusy
            ? "正在创建..."
            : crmPreparation
              ? "开始测试发送"
              : config.startButtonLabel}
        </V2PrimaryButton>
        {!backendReady && (
          <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
            先完成第 2 步连接后台，才能开始任务
          </p>
        )}
      </V2Section>

      {/* 当前任务：实时状态 + 事件流 */}
      {activeTask && (
        <V2Section
          title="当前任务"
          description={`${activeTask.targetName || config.taskTypeLabel} · ${statusChip?.label}`}
        >
          {/* 待确认时给发送按钮 */}
          {activeTask.status === "waiting_for_send_confirmation" && (
            <div className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-4">
              <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                AI 已写好回复，确认后发送：
              </p>
              {activeTask.replyText && (
                <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
                  {activeTask.replyText}
                </p>
              )}
              <div className="mt-3 flex justify-end">
                <V2PrimaryButton icon={Send} onClick={() => void handleApprove(activeTask)}>
                  确认发送
                </V2PrimaryButton>
              </div>
            </div>
          )}

          {/* 实时事件流 */}
          {liveEvents.length > 0 ? (
            <div className="space-y-2">
              {liveEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  {event.level === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]" />
                  ) : event.level === "error" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-danger)]" />
                  ) : event.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]" />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--kaypal-v3-accent)]" />
                  )}
                  <span className="text-[var(--kaypal-v3-soft-ink)]">
                    {cleanText(event.message)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--kaypal-v3-muted)]">
              任务已创建，等待系统处理...
            </p>
          )}
        </V2Section>
      )}

      {/* 最近任务 */}
      {recentTasks.length > 0 && (
        <V2Section title={`最近任务（${recentTasks.length}）`} padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {recentTasks.slice(0, 8).map((task) => {
              const chip = taskStatusChip(task.status);
              return (
                <button
                  key={task.id}
                  type="button"
                  className="flex w-full items-center justify-between p-4 text-left transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                  onClick={() => setActiveTask(task)}
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {task.targetName || config.taskTypeLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      {task.updatedAt
                        ? new Date(task.updatedAt).toLocaleString("zh-CN")
                        : ""}
                    </p>
                  </div>
                  <V2StatusChip tone={chip.tone}>{chip.label}</V2StatusChip>
                </button>
              );
            })}
          </div>
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/engagement")}>
          返回
        </V2GhostButton>
        <V2GhostButton icon={RefreshCcw} onClick={() => void refreshTasks()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}
