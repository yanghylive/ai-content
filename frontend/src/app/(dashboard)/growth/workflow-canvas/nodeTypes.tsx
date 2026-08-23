import type { NodeTypes } from "reactflow";
import type { ComponentType } from "react";
import type { NodeProps } from "reactflow";
import BaseNodeWrapper from "./nodes/BaseNodeWrapper";
import { Bot, FileText, Send, Target, MessageSquare, Users, BarChart3 } from "lucide-react";

/**
 * ai-content 增长工作流画布节点类型
 * 与后端 GrowthWorkflowStep.type 对齐：strategy/content/publish/acquisition/follow-up/crm/report
 */
export type GrowthCanvasNodeType =
  | "strategy"
  | "content"
  | "publish"
  | "acquisition"
  | "follow-up"
  | "crm"
  | "report";

export interface GrowthNodeData {
  label?: string;
  description?: string;
  riskMode?: string;
  status?: string;
  /** 流水线中的步骤序号（1 起） */
  stepIndex?: number;
  /** 步骤执行配置（如获客配置 ID） */
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GrowthCanvasNode {
  id: string;
  type: GrowthCanvasNodeType;
  position: { x: number; y: number };
  data: GrowthNodeData;
}

export interface GrowthCanvasEdge {
  id: string;
  source: string;
  target: string;
}

export const NODE_TYPE_LABELS: Record<GrowthCanvasNodeType, string> = {
  strategy: "策略",
  content: "内容",
  publish: "发布",
  acquisition: "获客",
  "follow-up": "跟进",
  crm: "CRM",
  report: "复盘",
};

export const NODE_TYPE_META: Record<
  GrowthCanvasNodeType,
  { label: string; icon: ComponentType<{ className?: string }>; accent: string; description: string }
> = {
  strategy: { label: "策略", icon: Target, accent: "var(--kaypal-v3-purple)", description: "确认目标、人群、渠道与成功指标" },
  content: { label: "内容", icon: FileText, accent: "var(--kaypal-v3-amber)", description: "准备内容素材、话术与落地页" },
  publish: { label: "发布", icon: Send, accent: "var(--kaypal-v3-success)", description: "发布内容到目标平台" },
  acquisition: { label: "获客", icon: Bot, accent: "#ec4899", description: "采集线索、执行触达动作" },
  "follow-up": { label: "跟进", icon: MessageSquare, accent: "var(--kaypal-v3-cobalt)", description: "跟进高意向线索" },
  crm: { label: "CRM", icon: Users, accent: "var(--kaypal-v3-purple)", description: "沉淀线索到 CRM 客户库" },
  report: { label: "复盘", icon: BarChart3, accent: "var(--kaypal-v3-danger)", description: "汇总数据、复盘效果、调优策略" },
};

/** 通用节点组件：所有业务步骤用同一套壳（图标 + 标签 + 描述 + 状态着色） */
function GrowthNodeComponent(props: NodeProps) {
  const { data, type } = props as NodeProps & { data: GrowthNodeData; type: GrowthCanvasNodeType };
  const meta = NODE_TYPE_META[type] ?? NODE_TYPE_META.strategy;
  const Icon = meta.icon;
  const status = (data.status as string) || "pending";
  const statusColor =
    status === "completed" ? "var(--kaypal-v3-success)" : status === "running" ? "var(--kaypal-v3-cobalt)" : status === "failed" ? "var(--kaypal-v3-danger)" : undefined;
  return (
    <BaseNodeWrapper
      label={data.label || meta.label}
      icon={<Icon className="h-3.5 w-3.5" />}
      accentColor={meta.accent}
      statusColor={statusColor}
      stepIndex={typeof data.stepIndex === "number" ? data.stepIndex : undefined}
    >
      <div className="space-y-1">
        <p className="leading-4 text-[var(--kaypal-v3-muted)]">
          {typeof data.description === "string" && data.description
            ? data.description
            : meta.description}
        </p>
        {typeof data.riskMode === "string" && data.riskMode && (
          <p className="text-11 font-medium text-[var(--kaypal-v3-muted)]">
            风控：{data.riskMode === "auto" ? "自动执行" : data.riskMode === "confirm-first" ? "先确认" : data.riskMode === "draft-only" ? "仅草稿" : data.riskMode}
          </p>
        )}
      </div>
    </BaseNodeWrapper>
  );
}

export const FLOW_NODE_TYPES: NodeTypes = {
  strategy: GrowthNodeComponent,
  content: GrowthNodeComponent,
  publish: GrowthNodeComponent,
  acquisition: GrowthNodeComponent,
  "follow-up": GrowthNodeComponent,
  crm: GrowthNodeComponent,
  report: GrowthNodeComponent,
};
