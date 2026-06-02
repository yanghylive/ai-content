"use client";

import { useState, useCallback } from 'react';
import { localEngineApi } from '@/lib/api/local-engine';

type AgentSStatus = Awaited<ReturnType<typeof localEngineApi.agentSStatus>>;
type AgentSEventResult = Awaited<ReturnType<typeof localEngineApi.agentSGetEvents>>;
type AgentSEvent = AgentSEventResult['events'][number];
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
  'local.app.open',
  'local.window.list',
  'local.window.focus',
  'local.input.click',
  'local.input.type',
  'local.screen.screenshot',
  'local.clipboard.read',
  'local.clipboard.write',
] as const;

function normalizeLocalControllerMode(mode?: 'restricted' | 'custom' | 'full') {
  if (mode === 'full') return 'full';
  if (mode === 'custom' || mode === 'restricted') return 'custom';
  return undefined;
}

export function useAgentSState() {
  const [agentSStatus, setAgentSStatus] = useState<AgentSStatus | null>(null);
  const [agentSSession, setAgentSSession] = useState<AgentSSession | null>(null);
  const [agentSEvents, setAgentSEvents] = useState<AgentSEvent[]>([]);
  const [agentSBusy, setAgentSBusy] = useState(false);
  const [agentSApprovalBusy, setAgentSApprovalBusy] = useState(false);
  const [agentSError, setAgentSError] = useState<string | null>(null);
  const [agentSArtifactsCount, setAgentSArtifactsCount] = useState(0);

  const refreshAgentSStatus = useCallback(async () => {
    try {
      const status = await localEngineApi.agentSStatus();
      setAgentSStatus(status);
      setAgentSError(null);
    } catch (error) {
      setAgentSError(error instanceof Error ? error.message : '无法读取本机助手状态');
    }
  }, []);

  const startAgentS = useCallback(async () => {
    setAgentSBusy(true);
    try {
      await localEngineApi.agentSEnsureRunning();
      await refreshAgentSStatus();
    } catch (error) {
      setAgentSError(error instanceof Error ? error.message : '本机助手启动失败');
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
      setAgentSError(error instanceof Error ? error.message : '本机助手停止失败');
    } finally {
      setAgentSBusy(false);
    }
  }, [refreshAgentSStatus]);

  const runAgentSTask = useCallback(async (input: {
    skillId?: string;
    sessionName?: string | null;
    taskType?: string;
    instruction: string;
    metadata?: Record<string, unknown>;
    labels?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    requiresApproval?: boolean;
    localControllerPermissionMode?: 'restricted' | 'custom' | 'full';
    localControllerAllowedCapabilities?: string[];
    commercialExecutionRequested?: boolean;
  }) => {
    setAgentSBusy(true);
    try {
      await localEngineApi.agentSEnsureRunning();
      const created = await localEngineApi.agentSCreateSession({
        session_name: input.sessionName || null,
        task_type: input.taskType || 'ops-workbench.task',
        metadata: input.commercialExecutionRequested
          ? { ...(input.metadata || {}), skill_id: input.skillId || input.metadata?.skill_id, commercialExecutionRequested: true }
          : input.metadata,
        labels: input.labels,
      });
      const rawSession = created.session as AgentSSession;
      const sessionId = String(rawSession.session_id || rawSession.id || '');
      if (!sessionId) {
        throw new Error('Agent-S 未返回会话 ID');
      }

      const localControllerPermissionMode = normalizeLocalControllerMode(
        input.localControllerPermissionMode,
      );
      const localControllerAllowedCapabilities =
        input.localControllerAllowedCapabilities || [...DESKTOP_APP_CONTROL_CAPABILITIES];
      const runMetadata =
        localControllerPermissionMode
          ? {
              ...(input.metadata || {}),
              ...(input.skillId ? { skill_id: input.skillId } : {}),
              ...(input.commercialExecutionRequested ? { commercialExecutionRequested: true } : {}),
              localControllerPermissionMode,
              localControllerAllowedCapabilities,
              approvedTools: ['browser-automation', 'local-controller'],
            }
          : input.metadata;

      const run = await localEngineApi.agentSRunTask(sessionId, {
        instruction: input.instruction,
        task_type: input.taskType,
        metadata: runMetadata,
        risk_level: input.riskLevel || 'medium',
        requires_approval: input.requiresApproval ?? false,
      });
      const session = {
        ...rawSession,
        id: sessionId,
        session_id: sessionId,
        run_id: run.run_id,
        status: run.status || rawSession.status || 'running',
      };
      setAgentSSession(session);
      setAgentSEvents([]);
      await refreshAgentSStatus();
      return { session, run };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent-S 任务启动失败';
      setAgentSError(message);
      throw error;
    } finally {
      setAgentSBusy(false);
    }
  }, [refreshAgentSStatus]);

  const getAgentSEvents = useCallback(async (sessionId: string, afterSeq?: number) => {
    const result = await localEngineApi.agentSGetEvents(sessionId, afterSeq);
    const latestEvent = [...(result.events || [])]
      .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0))[0];
    if (latestEvent?.status) {
      setAgentSSession((previous) => {
        if (!previous) return previous;
        const previousId = String(previous.session_id || previous.id || '');
        if (previousId !== sessionId) return previous;
        return {
          ...previous,
          status: latestEvent.status,
          last_event_seq: latestEvent.seq,
          updated_at: latestEvent.created_at,
          completed_at: ['completed', 'failed', 'cancelled'].includes(String(latestEvent.status))
            ? latestEvent.created_at
            : previous.completed_at,
        };
      });
    }
    return result;
  }, []);

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
  };
}
