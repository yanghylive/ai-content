"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Save, RotateCcw, ArrowLeft, Loader2, Workflow, Play, Settings2 } from "lucide-react";
import NodePanel from "./NodePanel";
import { FLOW_NODE_TYPES, NODE_TYPE_META, type GrowthCanvasNode, type GrowthCanvasEdge, type GrowthCanvasNodeType } from "./nodeTypes";
import { growthApi, type GrowthWorkflow } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

function generateNodeId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 流水线布局常量：单列 x、起始 y、步距 */
const COLUMN_X = 260;
const START_Y = 90;
const STEP_GAP = 180;

/** 画布 → 步骤数组（按 y 排序 = 执行顺序 + 用户手动连线作为额外依赖） */
export function buildWorkflowSteps(nodes: GrowthCanvasNode[], edges: GrowthCanvasEdge[]) {
  // 只收集用户手动连线（seq- 前缀是自动顺序边，不写入依赖）
  const dependencies = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.id.startsWith("seq-")) continue;
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
    config: { acquisitionConfigId: (node.data?.config as Record<string, unknown> | undefined)?.acquisitionConfigId },
  }));
}

/** 步骤数组 → 画布（单列纵向流水线：从上到下 = 执行顺序，节点自动串联） */
type CanvasStepSource = {
  id: string;
  name?: string;
  type?: string;
  riskMode?: string;
  status?: string;
  description?: string;
  nodeType?: string;
  dependencies?: string[];
  config?: unknown;
};

export function buildCanvasFromSteps(steps: CanvasStepSource[]): { nodes: GrowthCanvasNode[]; edges: GrowthCanvasEdge[] } {
  const nodes: GrowthCanvasNode[] = steps.map((step, index) => {
    const nodeType = (step.nodeType as GrowthCanvasNodeType) || (step.type as GrowthCanvasNodeType) || "strategy";
    return {
      id: step.id,
      type: nodeType,
      // 单列纵向：x 固定，y 按步骤顺序递增 → 顺序一眼可见
      position: { x: 260, y: 90 + index * 180 },
      data: {
        label: step.name,
        description: step.description,
        riskMode: step.riskMode,
        status: step.status,
        stepIndex: index + 1,
        config: (step.config as Record<string, unknown> | undefined) ?? undefined,
      },
    };
  });
  // 自动顺序连线：第 i 步 → 第 i+1 步（主流程线）
  const edges: GrowthCanvasEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    edges.push({ id: `seq-${i}-${i + 1}`, source: steps[i].id, target: steps[i + 1].id });
  }
  // 用户手动依赖边（补充依赖）
  for (const step of steps) {
    for (const dep of step.dependencies ?? []) {
      const exists = edges.some((e) => e.source === dep && e.target === step.id);
      if (!exists) edges.push({ id: `edge-${dep}-${step.id}`, source: dep, target: step.id });
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

  /** 拖入新节点：按放置位置插入流水线，统一 x 列并重排序号 */
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;
      try {
        const { type, label } = JSON.parse(raw) as { type: GrowthCanvasNodeType; label: string };
        const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const current = getNodes() as GrowthCanvasNode[];
        const sorted = [...current].sort((a, b) => a.position.y - b.position.y);
        let insertIdx = sorted.findIndex((n) => n.position.y > flowPos.y);
        if (insertIdx === -1) insertIdx = sorted.length;
        const newNode: GrowthCanvasNode = {
          id: generateNodeId(),
          type,
          position: { x: COLUMN_X, y: 0 },
          data: { label: label || NODE_TYPE_META[type]?.label || type, riskMode: "confirm-first", status: "pending" },
        };
        const all = [...sorted.slice(0, insertIdx), newNode, ...sorted.slice(insertIdx)];
        // 统一 x 列 + 重排 y 与序号
        const relaid = all.map((n, i) => ({
          ...n,
          position: { x: COLUMN_X, y: START_Y + i * STEP_GAP },
          data: { ...n.data, stepIndex: i + 1 },
        }));
        setNodes(relaid as never);
        // 重建自动顺序边，保留手动依赖边
        setEdges((eds) => {
          const manual = (eds as GrowthCanvasEdge[]).filter((e) => !e.id.startsWith("seq-"));
          const seq: GrowthCanvasEdge[] = [];
          for (let i = 0; i < relaid.length - 1; i++) {
            seq.push({ id: `seq-${i}-${i + 1}`, source: relaid[i].id, target: relaid[i + 1].id });
          }
          return [...seq, ...manual] as never;
        });
      } catch {
        // 忽略无效拖放
      }
    },
    [screenToFlowPosition, setNodes, setEdges, getNodes],
  );

  /** x 轴锁定：拖拽只改变 y（重排顺序），x 始终对齐流水线列 */
  const onNodesChangeAligned = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const aligned = changes.map((c) => {
        if (c.type === "position" && c.position) {
          return { ...c, position: { x: COLUMN_X, y: c.position.y } };
        }
        return c;
      });
      onNodesChange(aligned);
    },
    [onNodesChange],
  );

  /** 节点被删除（Delete 键）后：重排流水线 y/序号 + 重建自动顺序边 */
  const onNodesDelete = useCallback(
    (deleted: GrowthCanvasNode[]) => {
      const deletedIds = new Set(deleted.map((d) => d.id));
      const rest = (getNodes() as GrowthCanvasNode[]).filter((n) => !deletedIds.has(n.id));
      const relaid = rest.map((n, i) => ({
        ...n,
        position: { x: COLUMN_X, y: START_Y + i * STEP_GAP },
        data: { ...n.data, stepIndex: i + 1 },
      }));
      setNodes(relaid as never);
      const manual = (getEdges() as GrowthCanvasEdge[]).filter(
        (e) => !e.id.startsWith("seq-") && !deletedIds.has(e.source) && !deletedIds.has(e.target),
      );
      const seq: GrowthCanvasEdge[] = [];
      for (let i = 0; i < relaid.length - 1; i++) {
        seq.push({ id: `seq-${i}-${i + 1}`, source: relaid[i].id, target: relaid[i + 1].id });
      }
      setEdges([...seq, ...manual] as never);
    },
    [setNodes, setEdges, getNodes, getEdges],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const steps = buildWorkflowSteps(getNodes() as GrowthCanvasNode[], getEdges() as GrowthCanvasEdge[]);
      await growthApi.updateWorkflow(workflow.id, { name, steps: steps as never });
      // 保存后按新顺序重建画布（序号 / 自动连线 / 布局对齐）
      const { nodes: n, edges: e } = buildCanvasFromSteps(steps);
      setNodes(n);
      setEdges(e);
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

  // ===== 执行引擎支持：状态轮询 + 节点配置 + 确认 =====
  const [configTarget, setConfigTarget] = useState<GrowthCanvasNode | null>(null);
  const [configs, setConfigs] = useState<Array<{ id: string; name: string; mode: string; platform: string }>>([]);
  const [confirming, setConfirming] = useState(false);
  const [hasWaiting, setHasWaiting] = useState(false);
  const [liveStatus, setLiveStatus] = useState(workflow.status);

  // 轮询工作流状态（执行引擎推进后实时着色 + 等待确认提示）
  useEffect(() => {
    const poll = async () => {
      try {
        const latest = await growthApi.listWorkflows();
        const found = (Array.isArray(latest) ? latest : []).find((w) => w.id === workflow.id);
        if (!found) return;
        setLiveStatus(found.status);
        setHasWaiting(found.steps.some((s) => s.status === "waiting-confirmation"));
        setNodes((nds) =>
          (nds as GrowthCanvasNode[]).map((n) => {
            const step = found.steps.find((s) => s.id === n.id);
            if (!step) return n;
            return {
              ...n,
              data: {
                ...n.data,
                status: step.status,
                label: n.data.label || step.name,
                riskMode: step.riskMode,
              },
            };
          }) as never,
        );
      } catch {
        // 忽略轮询错误
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => clearInterval(timer);
  }, [workflow.id, setNodes]);

  // 加载获客配置（节点配置弹窗用）
  useEffect(() => {
    void (async () => {
      try {
        const data = await growthApi.listConfigs();
        setConfigs(
          (Array.isArray(data) ? data : []).map((c) => ({
            id: c.id,
            name: (c as { name?: string }).name || c.taskName || "未命名获客任务",
            mode: c.mode || "",
            platform: c.platform || "",
          })),
        );
      } catch {
        // 忽略
      }
    })();
  }, []);

  /** 节点点击 → 打开配置面板 */
  const onNodeClick = useCallback(
    (_event: unknown, node: GrowthCanvasNode) => {
      setConfigTarget(node);
    },
    [],
  );

  /** 保存节点配置（获客配置绑定）→ 更新画布 */
  const handleSaveNodeConfig = async (nodeId: string, acquisitionConfigId: string) => {
    try {
      // 先构造新节点数组（避免异步 state 竞态），再更新画布并保存
      const newNodes = (getNodes() as GrowthCanvasNode[]).map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...((n.data.config as object) || {}), acquisitionConfigId } } }
          : n,
      );
      setNodes(newNodes as never);
      setConfigTarget(null);
      setError(null);
      const steps = buildWorkflowSteps(newNodes, getEdges() as GrowthCanvasEdge[]);
      await growthApi.updateWorkflow(workflow.id, { steps: steps as never });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(toPublicError(err, "保存节点配置失败"));
    }
  };

  /** 确认当前等待确认的步骤（执行引擎：确认后执行动作并推进） */
  const handleConfirmStep = async () => {
    setConfirming(true);
    setError(null);
    try {
      await growthApi.workflowAction(workflow.id, "confirm-step", {});
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(toPublicError(err, "确认失败，请稍后重试"));
    } finally {
      setConfirming(false);
    }
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
        {hasWaiting && (
          <button
            type="button"
            onClick={() => void handleConfirmStep()}
            disabled={confirming}
            className="flex items-center gap-1 rounded bg-[var(--kaypal-v3-amber)] px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            确认继续
          </button>
        )}
        {liveStatus === "running" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--kaypal-v3-success)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--kaypal-v3-success)]" />
            执行中
          </span>
        )}
        {savedAt && <span className="text-xs text-[var(--kaypal-v3-muted)]">已保存 {savedAt}</span>}
      </div>

      {error && (
        <div className="rounded border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </div>
      )}

      {/* 流水线场景条：说明这是什么流程、怎么读顺序 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-xs text-[var(--kaypal-v3-muted)]">
        <span className="flex items-center gap-1.5 font-medium text-[var(--kaypal-v3-ink)]">
          <Workflow className="h-3.5 w-3.5 text-[var(--kaypal-v3-accent)]" />
          自动化获客流水线
        </span>
        <span>·</span>
        <span>共 {nodes.length} 步</span>
        <span>·</span>
        <span>从上到下按序执行（①→②→③），上下拖动节点调整顺序</span>
      </div>

      {/* 画布区 */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        <NodePanel />
        <div className="relative flex-1 overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]">
          <ReactFlow
            nodes={nodes as never}
            edges={edges as never}
            onNodesChange={onNodesChangeAligned}
            onNodesDelete={onNodesDelete as never}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick as never}
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
          {/* 操作提示 */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] text-[var(--kaypal-v3-muted)] shadow-sm">
            点击节点配置执行动作 · 上下拖动调整顺序 · Delete 删除 · 拖拽连线设置依赖
          </div>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-[var(--kaypal-v3-muted)]">从左侧拖拽节点添加步骤，编排获客流水线</p>
            </div>
          )}
        </div>
      </div>

      {/* 节点配置弹窗：绑定执行动作（获客配置） */}
      {configTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfigTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
              <h3 className="text-base font-bold text-[var(--kaypal-v3-ink)]">
                配置步骤：{(configTarget.data?.label as string) || "未命名"}
              </h3>
            </div>
            <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              绑定执行动作后，运行到该步骤会自动执行（auto）或确认后执行（先确认）
            </p>
            {configTarget.type === "acquisition" ? (
              <div className="mt-4">
                <label className="text-sm font-medium text-[var(--kaypal-v3-ink)]">获客任务（评论/私信触达）</label>
                <select
                  value={
                    ((configTarget.data?.config as Record<string, unknown> | undefined)?.acquisitionConfigId as string) || ""
                  }
                  onChange={(e) => void handleSaveNodeConfig(configTarget.id, e.target.value)}
                  className="mt-1.5 w-full rounded border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] focus:border-[var(--kaypal-v3-accent)] focus:outline-none"
                >
                  <option value="">不执行获客（人工处理）</option>
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.platform} · {c.mode}）
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">
                  选择后运行到此步骤将按对应获客任务处理（需账号已授权）
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
                此步骤类型（{configTarget.type}）当前无需绑定执行资源：{configTarget.type === "strategy" && "目标确认后由人工推进"}
                {configTarget.type === "content" && "内容准备完成后由人工确认推进"}
                {configTarget.type === "publish" && "发布动作将在后续版本接入发布引擎"}
                {configTarget.type === "follow-up" && "线索跟进需在获客完成后人工执行"}
                {configTarget.type === "crm" && "线索将随获客执行自动沉淀 CRM"}
                {configTarget.type === "report" && "复盘数据在流程完成后查看"}
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setConfigTarget(null)}
                className="rounded bg-[var(--kaypal-v3-paper-soft)] px-4 py-1.5 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:opacity-80"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
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
