import { Card, CardHeader, CardTitle, CardContent } from "@/components/agent-cockpit-canvas/ui/card";
import { Button } from "@/components/agent-cockpit-canvas/ui/button";
import { Plus } from "lucide-react";
import { ChartSpec, Chart, ChartDataMap } from "@/lib/agent-cockpit-canvas/types";
import { AgentState, AgentSetState } from "@/lib/agent-cockpit-canvas/types";
import { ChartGrid } from "@/components/agent-cockpit-canvas/dashboard/charts";

interface ChartsProps {
  state: AgentState;
  setState: AgentSetState<AgentState>;
}

export const Charts = ({ state, setState }: ChartsProps) => {
  const handleRemoveChart = (index: number) => {
    setState((prev) => {
      const charts = [...(prev?.charts ?? [])];
      charts.splice(index, 1);
      return {
        title: prev?.title ?? "操作驾驶台",
        charts,
        pinnedMetrics: prev?.pinnedMetrics ?? [],
      } as AgentState;
    });
  };

  const handleEditChart = (index: number, newSpec: ChartSpec) => {
    setState((prev) => {
      const charts = [...(prev?.charts ?? [])];
      // Preserve the data when editing
      const existingData = charts[index]?.data ?? [];
      charts[index] = { ...newSpec, data: existingData } as Chart;
      return {
        title: prev?.title ?? "操作驾驶台",
        charts,
        pinnedMetrics: prev?.pinnedMetrics ?? [],
      } as AgentState;
    });
  };

  const handleAddChart = () => {
    const newChart: Chart = {
      type: "line",
      title: "新任务视图",
      x: "x",
      y: "y",
      data: [],
    } as Chart;
    setState((prev) => ({
      title: prev?.title ?? "操作驾驶台",
      charts: [...(prev?.charts ?? []), newChart],
      pinnedMetrics: prev?.pinnedMetrics ?? [],
    }));
  };

  return (
    <div className="grid gap-4">
      <CockpitOverview state={state} />
      <Card className="shadow-none border-none pt-4 m-0 bg-transparent">
      <CardHeader className="flex flex-row items-center justify-between p-0 m-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-xl">当前任务 Canvas</CardTitle>
        </div>
        <Button
          size="sm"
          variant="suggestion"
          onClick={handleAddChart}
          title="添加任务视图"
        >
          <Plus className="size-4 mr-1" /> 添加视图
        </Button>
      </CardHeader>
      <CardContent className="p-0 m-0">
        {!state?.charts?.length && (
          <p className="text-sm italic">
            对话产生任务后，当前任务的步骤、草稿、确认和交付面板会映射到这块 GitHub 持续工作区。
          </p>
        )}
        {state?.charts?.length > 0 && (
          <ChartGrid
            charts={state.charts}
            chartData={
              (state as AgentState & { chartData?: ChartDataMap }).chartData
            }
            onRemoveChart={handleRemoveChart}
            onEditChart={handleEditChart}
          />
        )}
      </CardContent>
      </Card>
    </div>
  );
};

function CockpitOverview({ state }: { state: AgentState }) {
  const currentTask = state.cockpit?.currentTask ?? null;
  const activeSurface = currentTask?.surfaces.find(
    (surface) => surface.id === currentTask.activeSurfaceId,
  ) ?? currentTask?.surfaces[0];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {currentTask ? (
            <>
              <p className="font-medium text-foreground">{currentTask.title}</p>
              <p className="text-muted-foreground">{currentTask.statusLabel}</p>
              <p className="text-muted-foreground">
                {currentTask.instruction || "等待下一条对话指令"}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              先在对话里输入目标。普通问答不会创建本机任务，需要动作时才进入工作区。
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前面板</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {activeSurface ? (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="font-medium text-foreground">{formatSurfaceName(activeSurface.surface)}</p>
              <p className="text-muted-foreground">
                {activeSurface.actions?.[0]?.label ?? "等待当前任务继续产生可操作对象"}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              暂无面板。输入任务后会生成草稿、预览或交付对象。
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">下一步</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {currentTask?.nextActions.length ? (
            currentTask.nextActions.slice(0, 3).map((action) => (
              <div key={action.id} className="rounded-md border bg-muted/40 p-2">
                <p className="font-medium text-foreground">{action.label}</p>
                <p className="text-muted-foreground">
                  {action.requiresConfirmation ? "执行前需要你确认" : "可继续推进当前任务"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">
              继续在对话里补充目标，工作区会跟随当前任务变化。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatSurfaceName(surface: string) {
  const labels: Record<string, string> = {
    task_draft: "任务草稿",
    approval_panel: "确认面板",
    evidence_list: "当前证据",
    browser_status: "浏览器预检",
    browser_preview: "浏览器预览",
    publishing_preview: "发布预览",
    file_analysis_result: "文件分析结果",
    execution_timeline: "执行时间线",
    delivery_result: "交付结果",
  };
  return labels[surface] ?? "当前任务面板";
}
