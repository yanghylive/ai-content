"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import { Save, RotateCcw, Trash2, ArrowLeft, Loader2 } from "lucide-react";
import NodePanel from "./NodePanel";
import { FLOW_NODE_TYPES, NODE_TYPE_META, type GrowthCanvasNode, type GrowthCanvasEdge, type GrowthCanvasNodeType } from "./nodeTypes";
import { growthApi, type GrowthWorkflow } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

function generateNodeId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 画布 → 步骤数组（按 y 排序 + 依赖边） */
export function buildWorkflowSteps(nodes: GrowthCanvasNode[], edges: GrowthCanvasEdge[]) {
  const dependencies = new Map<string, string[]>();
  for (const edge of edges) {
    const next = dependencies.get(edge.target) ?? [];
    next.push(edge.source);
    dependencies.set(edge.target, Array.from(new Set(next)));
  }
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  return ordered.map((node) => ({
    id: node.id,
    name: node.data?.label ?? NODE_TYPE_META[node.type]?.label ?? "未命名步骤",
    type: node.type,
    riskMode: (node.data?.riskMode as string) || "confirm-first",
    status: "pending",
    description: node.data?.description as string | undefined,
    nodeType: node.type,
    dependencies: dependencies.get(node.id) ?? [],
    config: { ...(node.data ?? {}) },
  }));
}

/** 步骤数组 → 画布 */
export function buildCanvasFromSteps(steps: GrowthWorkflow["steps"]): { nodes: GrowthCanvasNode[]; edges: GrowthCanvasEdge[] } {
  const nodes: GrowthCanvasNode[] = steps.map((step, index) => {
    const nodeType = (step.nodeType as GrowthCanvasNodeType) || (step.type as GrowthCanvasNodeType) || "strategy";
    return {
      id: step.id,
      type: nodeType,
      position: { x: 120 + (index % 3) * 280, y: 120 + Math.floor(index / 3) * 200 },
      data: {
        label: step.name,
        description: step.description,
        riskMode: step.riskMode,
        status: step.status,
      },
    };
  });
  const edges: GrowthCanvasEdge[] = [];
  for (const step of steps) {
    for (const dep of step.dependencies ?? []) {
      edges.push({ id: `edge-${dep}-${step.id}`, source: dep, target: step.id });
    }
  }
  return { nodes, edges };
}

interface FlowCanvasProps {
  workflow: GrowthWorkflow;
  onBack: () => void;
  onSaved: () => void;
}

function FlowCanvasInner({ workflow, onBack, onSaved }: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<GrowthCanvasNode["data"]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GrowthCanvasEdge>([]);
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow();
  const [name, setName] = useState(workflow.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 初始加载：从工作流步骤构建画布
  useEffect(() => {
    const { nodes: n, edges: e } = buildCanvasFromSteps(workflow.steps);
    setNodes(n);
    setEdges(e);
    setName(workflow.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds as GrowthCanvasEdge[])),
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;
      try {
        const { type, label } = JSON.parse(raw) as { type: GrowthCanvasNodeType; label: string };
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const newNode: GrowthCanvasNode = {
          id: generateNodeId(),
          type,
          position,
          data: { label: label || NODE_TYPE_META[type]?.label || type, riskMode: "confirm-first", status: "pending" },
        };
        setNodes((nds) => nds.concat(newNode as never));
      } catch {
        // 忽略无效拖放
      }
    },
    [screenToFlowPosition, setNodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const steps = buildWorkflowSteps(getNodes() as GrowthCanvasNode[], getEdges() as GrowthCanvasEdge[]);
      await growthApi.updateWorkflow(workflow.id, { name, steps: steps as never });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (err) {
      setError(toPublicError(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const { nodes: n, edges: e } = buildCanvasFromSteps(workflow.steps);
    setNodes(n);
    setEdges(e);
    setError(null);
  };

  const nodeTypes = useMemo(() => FLOW_NODE_TYPES, []);

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
        >
          <ArrowLeft className="h-4 w-4" /> 返回列表
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-1.5 text-sm text-[var(--kaypal-v3-ink)] focus:border-[var(--kaypal-v3-accent)] focus:outline-none"
          placeholder="工作流名称"
        />
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
        >
          <RotateCcw className="h-4 w-4" /> 重置
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1 rounded bg-[var(--kaypal-v3-accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存
        </button>
        {savedAt && <span className="text-xs text-[var(--kaypal-v3-muted)]">已保存 {savedAt}</span>}
      </div>

      {error && (
        <div className="rounded border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </div>
      )}

      {/* 画布区 */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        <NodePanel />
        <div className="relative flex-1 overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]">
          <ReactFlow
            nodes={nodes as never}
            edges={edges as never}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls />
          </ReactFlow>
          {/* 节点删除提示 */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] text-[var(--kaypal-v3-muted)] shadow-sm">
            选中节点按 Delete 删除 · 拖拽连线设置依赖
          </div>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-[var(--kaypal-v3-muted)]">从左侧拖拽节点，编排获客流程</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
