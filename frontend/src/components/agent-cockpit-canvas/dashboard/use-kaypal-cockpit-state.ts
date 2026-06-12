"use client";

import { useEffect, useState } from "react";
import {
  localEngineApi,
  type AgentConfirmation,
  type AgentEvidence,
  type AgentSession,
  type AgentSessionEvent,
  type LocalEngineBrowserStatus,
  type LocalEngineHealth,
} from "@/lib/api/local-engine";
import {
  type AgentTaskDraft,
  type Chart,
  type CurrentTaskProjection,
  type AgentSetState,
  type AgentState,
  type KaypalAgentSurface,
  type KaypalCockpitProjection,
  type Metric,
  initialState,
} from "@/lib/agent-cockpit-canvas/types";

const USER_MESSAGE_EVENT = "kaypal-cockpit:user-message";

export function useKaypalCockpitState(): {
  state: AgentState;
  setState: AgentSetState<AgentState>;
} {
  const [state, setState] = useState<AgentState>(initialState);
  const [chatInstruction, setChatInstruction] = useState("");

  useEffect(() => {
    const handleUserMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ content?: string }>).detail;
      const content = detail?.content?.trim();
      if (content) setChatInstruction(content);
    };

    window.addEventListener(USER_MESSAGE_EVENT, handleUserMessage);
    return () => {
      window.removeEventListener(USER_MESSAGE_EVENT, handleUserMessage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      setState((current) => ({
        ...current,
        cockpit: {
          loading: true,
          health: current?.cockpit?.health ?? null,
          browserStatus: current?.cockpit?.browserStatus ?? null,
          sessions: current?.cockpit?.sessions ?? [],
          confirmations: current?.cockpit?.confirmations ?? [],
          currentTask: current?.cockpit?.currentTask ?? null,
          updatedAt: current?.cockpit?.updatedAt,
        },
      }));

      const [healthResult, browserResult, sessionsResult, confirmationsResult] =
        await Promise.allSettled([
          localEngineApi.health(),
          localEngineApi.browserStatus(),
          localEngineApi.agentSessions({ limit: 12 }),
          localEngineApi.confirmations("pending"),
        ]);

      if (cancelled) return;

      const errors = [
        healthResult,
        browserResult,
        sessionsResult,
        confirmationsResult,
      ]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : "状态接口读取失败",
        );

      const projection: KaypalCockpitProjection = {
        loading: false,
        error: errors[0],
        updatedAt: new Date().toISOString(),
        health: valueOrNull<LocalEngineHealth>(healthResult),
        browserStatus: valueOrNull<LocalEngineBrowserStatus>(browserResult),
        sessions: valueOrEmpty<AgentSession>(sessionsResult),
        confirmations: valueOrEmpty<AgentConfirmation>(confirmationsResult),
        currentTask: null,
      };
      projection.currentTask = buildCurrentTaskProjection(
        projection,
        chatInstruction,
      );

      setState((current) => ({
        ...current,
        title: "Kaypal Agent 操作驾驶台",
        pinnedMetrics: buildCanvasMetrics(projection.currentTask),
        charts: buildCanvasCharts(projection.currentTask),
        cockpit: projection,
      }));
    };

    void refresh();
    const timer = window.setInterval(refresh, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatInstruction]);

  return {
    state,
    setState,
  };
}

function valueOrNull<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function valueOrEmpty<T>(result: PromiseSettledResult<T[]>): T[] {
  return result.status === "fulfilled" ? result.value : [];
}

function buildCurrentTaskProjection(
  projection: KaypalCockpitProjection,
  chatInstruction: string,
): CurrentTaskProjection | null {
  const currentSession = projection.sessions[0] ?? null;
  const draft = chatInstruction
    ? createDraftFromInstruction(chatInstruction)
    : currentSession
      ? createDraftFromSession(currentSession)
      : null;
  const activeSession = chatInstruction ? null : currentSession;

  if (!activeSession && !draft) return null;

  const relatedConfirmations = activeSession
    ? projection.confirmations.filter(
        (item) => item.sessionId === activeSession.id || item.session?.id === activeSession.id,
      )
    : [];
  const evidenceItems = activeSession
    ? activeSession.events.flatMap((event) =>
        event.evidence ? [{ event, evidence: event.evidence }] : [],
      )
    : [];
  const surfaces = buildSurfaces({
    draft,
    session: activeSession,
    confirmations: relatedConfirmations,
    evidenceItems,
    projection,
  });
  const status =
    activeSession?.status ?? (draft?.executionScope === "chat-only" ? "chat_only" : "ready_to_run");

  return {
    scope: "current_task",
    title: activeSession?.title ?? draft?.title ?? "当前任务草稿",
    status,
    statusLabel: activeSession?.statusLabel ?? statusLabel(status),
    instruction: activeSession?.instruction ?? draft?.originalInstruction ?? "",
    draft,
    session: activeSession,
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
    nextActions: surfaces.flatMap((surface) => surface.actions ?? []),
  };
}

function buildSurfaces(input: {
  draft: AgentTaskDraft | null;
  session: AgentSession | null;
  confirmations: AgentConfirmation[];
  evidenceItems: Array<{ event: AgentSessionEvent; evidence: AgentEvidence }>;
  projection: KaypalCockpitProjection;
}): KaypalAgentSurface[] {
  const { draft, session, confirmations, evidenceItems, projection } = input;
  const surfaces: KaypalAgentSurface[] = [];

  if (draft) {
    surfaces.push({
      schemaVersion: "kaypal.agent.surface.v1",
      id: "surface-task-draft",
      surface: "task_draft",
      props: draft,
      actions: [
        { id: "edit-draft", kind: "edit_field", label: "调整任务草稿" },
        {
          id: "create-session",
          kind: "create_session",
          label: draft.executionScope === "chat-only" ? "保持聊天" : "创建本机任务",
          requiresConfirmation: draft.riskLevel === "high",
        },
      ],
    });
  }

  if (draft?.executionScope === "browser" || session?.executionScope === "browser") {
    const browserReady = Boolean(
      projection.browserStatus?.engineOnline && projection.browserStatus.readyAccounts > 0,
    );
    surfaces.push({
      schemaVersion: "kaypal.agent.surface.v1",
      id: "surface-browser-preview",
      surface: browserReady ? "browser_preview" : "browser_status",
      props: {
        online: projection.browserStatus?.engineOnline ?? projection.health?.online ?? false,
        readyAccounts: projection.browserStatus?.readyAccounts ?? 0,
        expiredAccounts: projection.browserStatus?.expiredAccounts ?? 0,
        targetApp: draft?.targetApp ?? session?.targetApp ?? "待选择平台",
        pageTitle: draft?.targetApp ?? session?.targetApp ?? "浏览器任务",
        objectSummary: session?.targetUrl ?? draft?.originalInstruction,
        nextStep: browserReady ? "打开目标页面并读取当前任务对象" : "先选择可用账号或完成登录",
        blockingReason: browserReady ? undefined : "当前任务需要可用浏览器账号",
      },
      actions: [
        { id: "select-account", kind: "select_account", label: "选择账号" },
        { id: "refresh-browser", kind: "refresh", label: "刷新预检" },
      ],
    });
  }

  if (draft?.taskType === "publishing" || draft?.taskType === "comment_reply") {
    surfaces.push({
      schemaVersion: "kaypal.agent.surface.v1",
      id: "surface-publishing-preview",
      surface: "publishing_preview",
      props: {
        platform: draft.targetApp ?? session?.targetApp ?? "待选择平台",
        account: "待选择账号",
        title: draft.taskType === "comment_reply" ? "评论/私信回复草稿" : "发布内容预览",
        contentPreview: draft.originalInstruction,
        visibility: "发送或发布前必须确认",
        riskLevel: draft.riskLevel,
      },
      actions: [
        { id: "edit-preview", kind: "edit_field", label: "修改内容" },
        {
          id: "approve-preview",
          kind: "approve",
          label: "确认后执行",
          requiresConfirmation: true,
        },
      ],
    });
  }

  confirmations.forEach((item) => {
    surfaces.push({
      schemaVersion: "kaypal.agent.surface.v1",
      id: `surface-confirmation-${item.id}`,
      surface: "approval_panel",
      props: {
        title: item.title,
        description: item.description,
        riskLevel: item.riskLevel,
        target: item.session?.targetApp ?? session?.targetApp ?? "当前任务",
        consequence: item.actionLabel,
        requiredChecks: item.requiredChecks,
      },
      actions: [
        { id: `approve-${item.id}`, kind: "approve", label: item.actionLabel, requiresConfirmation: true },
        { id: `reject-${item.id}`, kind: "reject", label: "拒绝" },
        { id: `open-confirmations-${item.id}`, kind: "open_confirmations", label: "打开确认页" },
      ],
    });
  });

  surfaces.push({
    schemaVersion: "kaypal.agent.surface.v1",
    id: "surface-evidence",
    surface: "evidence_list",
    props: {
      sessionId: session?.id,
      exportable: evidenceItems.length > 0,
      items: evidenceItems.map(({ event, evidence }) => ({
        id: evidence.id ?? event.id,
        type: evidence.type,
        label: evidence.label || event.title,
        value: evidence.value,
        createdAt: evidence.createdAt ?? event.createdAt,
      })),
    },
    actions: [
      { id: "open-evidence", kind: "open_evidence", label: "打开证据页" },
      { id: "export-evidence", kind: "export_evidence", label: "导出当前证据" },
    ],
  });

  surfaces.push({
    schemaVersion: "kaypal.agent.surface.v1",
    id: "surface-delivery",
    surface: "delivery_result",
    props: {
      title: session?.status === "completed" ? "任务已完成" : "交付物等待生成",
      summary:
        session?.status === "completed"
          ? session.nextAction || "可以查看结果、导出证据或继续任务。"
          : "当前任务完成后，报告、文件、发布结果或回复建议会显示在这里。",
      links: [],
      artifacts: [],
    },
    actions: [{ id: "continue-task", kind: "continue_task", label: "继续这个任务" }],
  });

  return surfaces;
}

function createDraftFromSession(session: AgentSession): AgentTaskDraft {
  return {
    schemaVersion: "agent.task-draft.v1",
    id: `draft-${session.id}`,
    source: "manual",
    originalInstruction: session.instruction,
    title: session.title,
    taskType: inferTaskType(session.instruction, session.executionScope),
    executionScope:
      session.executionScope === "local-files"
        ? "local-files"
        : session.executionScope,
    targetApp: session.targetApp,
    riskLevel: session.riskLevel,
    requiresConfirmation:
      session.riskLevel !== "low" || session.status === "waiting_for_confirmation",
    steps: session.events.length
      ? session.events.map((event) => ({
          id: event.id,
          title: event.title,
          description: event.message,
          requiresConfirmation: event.level === "warning",
        }))
      : defaultSteps(session.instruction),
    missingFields: session.targetApp ? [] : ["targetApp"],
  };
}

function createDraftFromInstruction(instruction: string): AgentTaskDraft {
  const executionScope = inferExecutionScope(instruction);
  const taskType = inferTaskType(instruction, executionScope);
  const targetApp = inferTargetApp(instruction);
  const riskLevel = inferRiskLevel(instruction);

  return {
    schemaVersion: "agent.task-draft.v1",
    id: `draft-${hashInstruction(instruction)}`,
    source: "chat",
    originalInstruction: instruction,
    title: buildDraftTitle(instruction, taskType),
    taskType,
    executionScope,
    targetApp,
    riskLevel,
    requiresConfirmation: riskLevel !== "low",
    steps: defaultSteps(instruction, taskType),
    missingFields: [
      ...(executionScope !== "chat-only" && !targetApp ? (["targetApp"] as const) : []),
      ...(executionScope === "browser" ? (["account"] as const) : []),
    ],
  };
}

function inferExecutionScope(instruction: string): AgentTaskDraft["executionScope"] {
  if (/(浏览器|后台|打开|抖音|微信|发布|评论|私信)/.test(instruction)) return "browser";
  if (/(文件|表格|下载|整理文件|本地)/.test(instruction)) return "local-files";
  return "chat-only";
}

function inferTaskType(
  instruction: string,
  scope: AgentTaskDraft["executionScope"],
): AgentTaskDraft["taskType"] {
  if (/(评论|私信|回复)/.test(instruction)) return "comment_reply";
  if (/(发布|发送|上传)/.test(instruction)) return "publishing";
  if (/(文件|表格|下载|整理文件)/.test(instruction)) return "file_operation";
  if (scope === "browser") return "browser_operation";
  if (/(写|生成|文案|文章|脚本)/.test(instruction)) return "content_generation";
  return "general_chat";
}

function inferTargetApp(instruction: string): string | undefined {
  if (/抖音/.test(instruction)) return "抖音后台";
  if (/微信|视频号/.test(instruction)) return "微信/视频号后台";
  if (/小红书/.test(instruction)) return "小红书后台";
  return undefined;
}

function inferRiskLevel(instruction: string): AgentTaskDraft["riskLevel"] {
  if (/(直接发布|直接发送|删除|覆盖|批量|付款|改文件)/.test(instruction)) return "high";
  if (/(发布|发送|评论|私信|后台|浏览器|文件)/.test(instruction)) return "medium";
  return "low";
}

function defaultSteps(
  instruction: string,
  taskType: AgentTaskDraft["taskType"] = "general_chat",
): AgentTaskDraft["steps"] {
  if (taskType === "general_chat" || taskType === "content_generation") {
    return [
      { id: "understand", title: "理解目标", description: instruction },
      { id: "draft", title: "生成可编辑结果" },
      { id: "deliver", title: "给出交付内容" },
    ];
  }

  return [
    { id: "preflight", title: "预检平台、账号和权限" },
    { id: "read-target", title: "打开目标并读取当前对象" },
    { id: "prepare", title: "生成草稿或操作预览" },
    {
      id: "confirm",
      title: "等待用户确认后执行高风险动作",
      requiresConfirmation: true,
    },
    { id: "evidence", title: "沉淀证据和交付结果" },
  ];
}

function buildDraftTitle(
  instruction: string,
  taskType: AgentTaskDraft["taskType"],
): string {
  if (taskType === "comment_reply") return "处理评论/私信回复";
  if (taskType === "publishing") return "准备发布任务";
  if (taskType === "file_operation") return "处理本地文件任务";
  if (taskType === "browser_operation") return "准备浏览器操作任务";
  return instruction.length > 24 ? `${instruction.slice(0, 24)}...` : instruction;
}

function statusLabel(status: CurrentTaskProjection["status"]) {
  const labels: Record<CurrentTaskProjection["status"], string> = {
    draft: "任务草稿",
    running: "Agent 正在执行",
    waiting_for_confirmation: "等待你确认",
    completed: "任务已完成",
    failed: "任务失败",
    cancelled: "任务已取消",
    drafting: "正在形成任务",
    ready_to_run: "任务已准备好",
    chat_only: "普通聊天",
  };
  return labels[status];
}

function buildCanvasMetrics(currentTask: CurrentTaskProjection | null): Metric[] {
  if (!currentTask) {
    return [
      {
        id: "empty-task",
        title: "当前任务",
        value: "等待输入",
        hint: "在对话里说清目标后，这里显示本轮任务对象。",
        icon: "custom",
      },
      {
        id: "empty-scope",
        title: "执行范围",
        value: "聊天",
        hint: "普通问答留在聊天，需要本机动作时才生成任务草稿。",
        icon: "custom",
      },
      {
        id: "empty-surface",
        title: "工作区面板",
        value: "0",
        hint: "草稿、预览、确认、交付物会作为当前任务面板出现。",
        icon: "custom",
      },
    ];
  }

  return [
    {
      id: "task-status",
      title: "当前任务",
      value: currentTask.statusLabel,
      hint: currentTask.title,
      icon: "custom",
    },
    {
      id: "task-scope",
      title: "执行范围",
      value: formatExecutionScope(
        currentTask.draft?.executionScope ?? currentTask.session?.executionScope ?? "chat-only",
      ),
      hint: currentTask.draft?.targetApp ?? currentTask.session?.targetApp ?? "未指定平台",
      icon: "custom",
    },
    {
      id: "task-actions",
      title: "下一步动作",
      value: String(currentTask.nextActions.length),
      hint: currentTask.nextActions[0]?.label ?? "继续在对话里补充要求",
      icon: "custom",
    },
  ];
}

function formatExecutionScope(scope: AgentTaskDraft["executionScope"] | string) {
  const labels: Record<string, string> = {
    browser: "浏览器",
    desktop: "桌面",
    "local-files": "本地文件",
    remote: "远程",
    mixed: "混合",
    "chat-only": "聊天",
  };
  return labels[scope] ?? scope;
}

function buildCanvasCharts(currentTask: CurrentTaskProjection | null): Chart[] {
  if (!currentTask?.draft?.steps.length) return [];

  return [
    {
      type: "bar",
      title: "任务步骤",
      x: "step",
      y: "items",
      data: currentTask.draft.steps.map((step, index) => ({
        step: `${index + 1}. ${step.title}`,
        items: 1,
      })),
    },
  ];
}

function hashInstruction(instruction: string) {
  let hash = 0;
  for (let index = 0; index < instruction.length; index += 1) {
    hash = (hash * 31 + instruction.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
