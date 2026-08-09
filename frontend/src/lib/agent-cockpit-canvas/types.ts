import type {
  AgentConfirmation,
  AgentSession,
  AgentSessionStatus,
  LocalEngineBrowserStatus,
  LocalEngineHealth,
} from "@/lib/api/local-engine";

export type LineChartSpec = {
  type: "line";
  title: string;
  x: string;
  y: string;
};
export type BarChartSpec = { type: "bar"; title: string; x: string; y: string };
export type PieChartSpec = { type: "pie"; title: string; x: string; y: string };
export type ChartSpec = LineChartSpec | BarChartSpec | PieChartSpec;

// Data records supplied by the agent for charts
export type ChartDataRecord = Record<string, string | number>;
export type ChartDataMap = Record<string, ChartDataRecord[]>; // keyed by chart title

export type Metric = {
  id: string;
  title: string;
  value: string;
  hint?: string;
  icon?: "users" | "mrr" | "conversion" | "churn" | "custom";
};

export type Chart = ChartSpec & {
  data: ChartDataRecord[];
};

export type AgentState = {
  title: string;
  charts: Chart[];
  pinnedMetrics: Metric[];
  cockpit?: KaypalCockpitProjection;
};

export type AgentSetState<T extends AgentState> = (
  newState: T | ((prevState: T | undefined) => T),
) => void;

export const initialState: AgentState = {
  title: "JIUZHANG AI Agent 操作驾驶台",
  charts: [],
  pinnedMetrics: [],
};

export type KaypalCockpitProjection = {
  loading: boolean;
  error?: string;
  updatedAt?: string;
  health: LocalEngineHealth | null;
  browserStatus: LocalEngineBrowserStatus | null;
  sessions: AgentSession[];
  confirmations: AgentConfirmation[];
  currentTask: CurrentTaskProjection | null;
};

export type AgentTaskDraft = {
  schemaVersion: "agent.task-draft.v1";
  id: string;
  source: "chat" | "preset" | "manual";
  originalInstruction: string;
  title: string;
  taskType:
    | "general_chat"
    | "content_generation"
    | "comment_reply"
    | "browser_operation"
    | "file_operation"
    | "remote_check"
    | "publishing";
  executionScope:
    | "browser"
    | "desktop"
    | "local-files"
    | "remote"
    | "mixed"
    | "chat-only";
  targetApp?: string;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    requiresConfirmation?: boolean;
  }>;
  missingFields: Array<
    "targetApp" | "account" | "permission" | "file" | "instruction_detail"
  >;
};

export type AgentSurfaceAction = {
  id: string;
  kind:
    | "edit_field"
    | "select_account"
    | "create_session"
    | "approve"
    | "reject"
    | "open_confirmations"
    | "open_evidence"
    | "export_evidence"
    | "open_browser"
    | "refresh"
    | "open_result"
    | "continue_task";
  label: string;
  requiresConfirmation?: boolean;
};

export type KaypalAgentSurface = {
  schemaVersion: "kaypal.agent.surface.v1";
  id: string;
  surface:
    | "task_draft"
    | "approval_panel"
    | "evidence_list"
    | "browser_status"
    | "browser_preview"
    | "publishing_preview"
    | "file_analysis_result"
    | "execution_timeline"
    | "delivery_result";
  props: Record<string, unknown>;
  actions?: AgentSurfaceAction[];
};

export type CurrentTaskProjection = {
  scope: "current_task";
  title: string;
  status: AgentSessionStatus | "drafting" | "ready_to_run" | "chat_only";
  statusLabel: string;
  instruction: string;
  draft: AgentTaskDraft | null;
  session: AgentSession | null;
  surfaces: KaypalAgentSurface[];
  activeSurfaceId: string | null;
  nextActions: AgentSurfaceAction[];
};
