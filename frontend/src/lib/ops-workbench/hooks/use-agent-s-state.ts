"use client";

import { useState, useCallback } from "react";
import {
  localEngineApi,
  type AgentSConversationArtifact,
  type AgentSConversationAttachment,
  type AgentSConversationPurpose,
  type AgentSConversationSession,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

type AgentSStatus = Awaited<ReturnType<typeof localEngineApi.agentSStatus>>;
type AgentSEventResult = Awaited<
  ReturnType<typeof localEngineApi.agentSGetEvents>
>;
type AgentSEvent = AgentSEventResult["events"][number];
type AgentSSession = {
  id: string;
  session_id: string;
  run_id?: string;
  status: string;
  last_event_seq?: number;
  updated_at?: string;
  completed_at?: string;
  [key: string]: unknown;
};

const DESKTOP_APP_CONTROL_CAPABILITIES = [
  "local.app.open",
  "local.window.list",
  "local.window.focus",
  "local.input.click",
  "local.input.type",
  "local.screen.screenshot",
  "local.clipboard.read",
  "local.clipboard.write",
] as const;

function normalizeLocalControllerMode(mode?: "restricted" | "custom" | "full") {
  if (mode === "full") return "full";
  if (mode === "custom" || mode === "restricted") return "custom";
  return undefined;
}

export function useAgentSState() {
  const [agentSStatus, setAgentSStatus] = useState<AgentSStatus | null>(null);
  const [agentSSession, setAgentSSession] = useState<AgentSSession | null>(
    null,
  );
  const [agentSEvents, setAgentSEvents] = useState<AgentSEvent[]>([]);
  const [agentSBusy, setAgentSBusy] = useState(false);
  const [agentSApprovalBusy, setAgentSApprovalBusy] = useState(false);
  const [agentSError, setAgentSError] = useState<string | null>(null);
  const [agentSArtifactsCount, setAgentSArtifactsCount] = useState(0);
  const [agentSConversations, setAgentSConversations] = useState<
    AgentSConversationSession[]
  >([]);
  const [agentSConversation, setAgentSConversation] =
    useState<AgentSConversationSession | null>(null);
  const [agentSConversationArtifacts, setAgentSConversationArtifacts] =
    useState<AgentSConversationArtifact[]>([]);
  const [agentSConversationBusy, setAgentSConversationBusy] = useState(false);

  const refreshAgentSStatus = useCallback(async () => {
    try {
      const status = await localEngineApi.agentSStatus();
      setAgentSStatus(status);
      setAgentSError(null);
    } catch (error) {
      setAgentSError(
        toPublicError(error, "无法读取本机助手状态"),
      );
    }
  }, []);

  const startAgentS = useCallback(async () => {
    setAgentSBusy(true);
    try {
      await localEngineApi.agentSEnsureRunning();
      await refreshAgentSStatus();
    } catch (error) {
      setAgentSError(
        toPublicError(error, "本机助手启动失败"),
      );
    } finally {
      setAgentSBusy(false);
    }
  }, [refreshAgentSStatus]);

  const stopAgentS = useCallback(async () => {
    setAgentSBusy(true);
    try {
      await localEngineApi.agentSStop();
      await refreshAgentSStatus();
    } catch (error) {
      setAgentSError(
        toPublicError(error, "本机助手停止失败"),
      );
    } finally {
      setAgentSBusy(false);
    }
  }, [refreshAgentSStatus]);

  const runAgentSTask = useCallback(
    async (input: {
      skillId?: string;
      sessionName?: string | null;
      taskType?: string;
      instruction: string;
      metadata?: Record<string, unknown>;
      labels?: string[];
      riskLevel?: "low" | "medium" | "high";
      requiresApproval?: boolean;
      localControllerPermissionMode?: "restricted" | "custom" | "full";
      localControllerAllowedCapabilities?: string[];
      commercialExecutionRequested?: boolean;
      onSessionCreated?: (sessionId: string) => Promise<void> | void;
    }) => {
      setAgentSBusy(true);
      try {
        await localEngineApi.agentSEnsureRunning();
        const created = await localEngineApi.agentSCreateSession({
          session_name: input.sessionName || null,
          task_type: input.taskType || "ops-workbench.task",
          metadata: input.commercialExecutionRequested
            ? {
                ...(input.metadata || {}),
                skill_id: input.skillId || input.metadata?.skill_id,
                commercialExecutionRequested: true,
              }
            : input.metadata,
          labels: input.labels,
        });
        const rawSession = created.session as unknown as AgentSSession;
        const sessionId = String(rawSession.session_id || rawSession.id || "");
        if (!sessionId) {
          throw new Error("Agent-S 未返回会话 ID");
        }
        await input.onSessionCreated?.(sessionId);

        const localControllerPermissionMode = normalizeLocalControllerMode(
          input.localControllerPermissionMode,
        );
        const localControllerAllowedCapabilities =
          input.localControllerAllowedCapabilities || [
            ...DESKTOP_APP_CONTROL_CAPABILITIES,
          ];
        const runMetadata = localControllerPermissionMode
          ? {
              ...(input.metadata || {}),
              ...(input.skillId ? { skill_id: input.skillId } : {}),
              ...(input.commercialExecutionRequested
                ? { commercialExecutionRequested: true }
                : {}),
              localControllerPermissionMode,
              localControllerAllowedCapabilities,
              approvedTools: ["browser-automation", "local-controller"],
            }
          : input.metadata;

        const run = await localEngineApi.agentSRunTask(sessionId, {
          instruction: input.instruction,
          task_type: input.taskType,
          metadata: runMetadata,
          risk_level: input.riskLevel || "medium",
          requires_approval: input.requiresApproval ?? false,
        });
        const session = {
          ...rawSession,
          id: sessionId,
          session_id: sessionId,
          run_id: run.run_id,
          status: run.status || rawSession.status || "running",
        };
        setAgentSSession(session);
        setAgentSEvents([]);
        await refreshAgentSStatus();
        return { session, run };
      } catch (error) {
        const message =
          toPublicError(error, "Agent-S 任务启动失败");
        setAgentSError(message);
        throw error;
      } finally {
        setAgentSBusy(false);
      }
    },
    [refreshAgentSStatus],
  );

  const getAgentSEvents = useCallback(
    async (sessionId: string, afterSeq?: number) => {
      const result = await localEngineApi.agentSGetEvents(sessionId, afterSeq);
      const latestEvent = [...(result.events || [])].sort(
        (a, b) => Number(b.seq || 0) - Number(a.seq || 0),
      )[0];
      if (latestEvent?.status) {
        setAgentSSession((previous) => {
          if (!previous) return previous;
          const previousId = String(previous.session_id || previous.id || "");
          if (previousId !== sessionId) return previous;
          return {
            ...previous,
            status: latestEvent.status,
            last_event_seq: latestEvent.seq,
            updated_at: latestEvent.created_at,
            completed_at: ["completed", "failed", "cancelled"].includes(
              String(latestEvent.status),
            )
              ? latestEvent.created_at
              : previous.completed_at,
          };
        });
      }
      return result;
    },
    [],
  );

  const refreshAgentSConversations = useCallback(async () => {
    try {
      const result = await localEngineApi.agentSListSessions(80);
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      setAgentSConversations(sessions);
      setAgentSError(null);
      return sessions;
    } catch (error) {
      const message =
        toPublicError(error, "无法读取 Agent 对话");
      setAgentSError(message);
      throw error;
    }
  }, []);

  const refreshAgentSConversation = useCallback(async (sessionId: string) => {
    try {
      const [conversation, artifactResult] = await Promise.all([
        localEngineApi.agentSGetSession(sessionId),
        localEngineApi.agentSGetArtifacts(sessionId),
      ]);
      setAgentSConversation(conversation);
      setAgentSConversationArtifacts(artifactResult.artifacts || []);
      setAgentSArtifactsCount(artifactResult.artifacts?.length || 0);
      setAgentSError(null);
      return conversation;
    } catch (error) {
      const message =
        toPublicError(error, "无法读取 Agent 对话");
      setAgentSError(message);
      throw error;
    }
  }, []);

  const createAgentSConversation = useCallback(
    async (input: {
      modelId?: string | null;
      purpose?: AgentSConversationPurpose;
      sessionName?: string | null;
    }) => {
      setAgentSConversationBusy(true);
      try {
        await localEngineApi.agentSEnsureRunning();
        const purpose = input.purpose || "general";
        const created = await localEngineApi.agentSCreateSession({
          session_name: input.sessionName || "新对话",
          task_type:
            purpose === "execute"
              ? "agent.conversation.execute"
              : "agent.conversation",
          metadata: {
            source: "agent-workbench",
            conversation_mode: true,
            conversation_purpose: purpose,
            ...(input.modelId
              ? { conversation_model_id: input.modelId }
              : {}),
          },
          labels: ["agent-workbench", "conversation"],
        });
        const sessionId = created.session.session_id;
        const conversation = await refreshAgentSConversation(sessionId);
        await refreshAgentSConversations();
        return conversation;
      } catch (error) {
        const message =
          toPublicError(error, "Agent 对话创建失败");
        setAgentSError(message);
        throw error;
      } finally {
        setAgentSConversationBusy(false);
      }
    },
    [refreshAgentSConversation, refreshAgentSConversations],
  );

  const sendAgentSMessage = useCallback(
    async (input: {
      sessionId?: string | null;
      instruction: string;
      modelId?: string | null;
      purpose?: AgentSConversationPurpose;
      attachments?: AgentSConversationAttachment[];
    }) => {
      const instruction = input.instruction.trim();
      if (!instruction) throw new Error("请输入消息后再发送");
      setAgentSConversationBusy(true);
      setAgentSError(null);
      let sessionId = input.sessionId || "";
      const purpose = input.purpose || "general";
      try {
        await localEngineApi.agentSEnsureRunning();
        if (!sessionId) {
          const created = await localEngineApi.agentSCreateSession({
            session_name: instruction.slice(0, 40),
            task_type:
              purpose === "execute"
                ? "agent.conversation.execute"
                : "agent.conversation",
            metadata: {
              source: "agent-workbench",
              conversation_mode: true,
              conversation_purpose: purpose,
              ...(input.modelId
                ? { conversation_model_id: input.modelId }
                : {}),
            },
            labels: ["agent-workbench", "conversation"],
          });
          sessionId = created.session.session_id;
        }

        setAgentSConversation((current) =>
          current && current.session.session_id === sessionId
            ? {
                ...current,
                session: { ...current.session, status: "running" },
              }
            : current,
        );
        const run = await localEngineApi.agentSRunTask(sessionId, {
          instruction,
          task_type:
            purpose === "execute"
              ? "agent.conversation.execute"
              : "agent.conversation",
          metadata: {
            source: "agent-workbench",
            conversation_mode: true,
            conversation_purpose: purpose,
            ...(input.modelId
              ? { conversation_model_id: input.modelId }
              : {}),
          },
          risk_level: purpose === "execute" ? "high" : "low",
          requires_approval: purpose === "execute",
          attachments: input.attachments || [],
        });
        const conversation = await refreshAgentSConversation(sessionId);
        await refreshAgentSConversations();
        return { sessionId, run, conversation };
      } catch (error) {
        if (sessionId) {
          await refreshAgentSConversation(sessionId).catch(() => undefined);
          await refreshAgentSConversations().catch(() => undefined);
        }
        const message =
          toPublicError(error, "Agent 消息发送失败");
        setAgentSError(message);
        throw error;
      } finally {
        setAgentSConversationBusy(false);
      }
    },
    [refreshAgentSConversation, refreshAgentSConversations],
  );

  const cancelAgentSConversation = useCallback(
    async (sessionId: string) => {
      await localEngineApi.agentSCancelSession(sessionId);
      const conversation = await refreshAgentSConversation(sessionId);
      await refreshAgentSConversations();
      return conversation;
    },
    [refreshAgentSConversation, refreshAgentSConversations],
  );

  const retryAgentSConversation = useCallback(
    async (sessionId: string) => {
      setAgentSConversationBusy(true);
      try {
        const run = await localEngineApi.agentSRetrySession(sessionId);
        const conversation = await refreshAgentSConversation(sessionId);
        await refreshAgentSConversations();
        return { run, conversation };
      } finally {
        setAgentSConversationBusy(false);
      }
    },
    [refreshAgentSConversation, refreshAgentSConversations],
  );

  const decideAgentSConversation = useCallback(
    async (
      sessionId: string,
      decision: "approved" | "rejected",
      comment?: string,
    ) => {
      setAgentSApprovalBusy(true);
      try {
        const result = await localEngineApi.agentSApproveSession(sessionId, {
          decision,
          comment,
        });
        const conversation = await refreshAgentSConversation(sessionId);
        await refreshAgentSConversations();
        return { result, conversation };
      } finally {
        setAgentSApprovalBusy(false);
      }
    },
    [refreshAgentSConversation, refreshAgentSConversations],
  );

  return {
    agentSStatus,
    agentSSession,
    setAgentSSession,
    agentSEvents,
    setAgentSEvents,
    agentSBusy,
    agentSApprovalBusy,
    setAgentSApprovalBusy,
    agentSError,
    agentSArtifactsCount,
    setAgentSArtifactsCount,
    refreshAgentSStatus,
    startAgentS,
    stopAgentS,
    runAgentSTask,
    getAgentSEvents,
    agentSConversations,
    agentSConversation,
    setAgentSConversation,
    agentSConversationArtifacts,
    agentSConversationBusy,
    refreshAgentSConversations,
    refreshAgentSConversation,
    createAgentSConversation,
    sendAgentSMessage,
    cancelAgentSConversation,
    retryAgentSConversation,
    decideAgentSConversation,
  };
}
