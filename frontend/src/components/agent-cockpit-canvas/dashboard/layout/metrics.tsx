import { PinnedMetricCard } from "@/components/agent-cockpit-canvas/dashboard/metrics";
import {
  AgentState,
  AgentSetState,
  Metric,
} from "@/lib/agent-cockpit-canvas/types";
import { Button } from "@/components/agent-cockpit-canvas/ui/button";
import { Plus } from "@/components/iconpark";

interface PinnedMetricsProps {
  state: AgentState;
  setState: AgentSetState<AgentState>;
}

const CreateDefaultMetric = (): Metric => {
  return {
    id: `metric_${Math.floor(Math.random() * 100000)}`,
    title: "新要点",
    value: "0",
    hint: "",
    icon: "custom" as const,
  };
};
export const PinnedMetrics = ({ state, setState }: PinnedMetricsProps) => {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">当前任务要点</h2>
        <Button
          size="sm"
          variant="suggestion"
          onClick={() => {
            setState((prev) => ({
              title: prev?.title ?? "操作驾驶台",
              charts: prev?.charts ?? [],
              pinnedMetrics: [
                ...(prev?.pinnedMetrics ?? []),
                CreateDefaultMetric(),
              ],
            }));
          }}
        >
          <Plus className="size-4 mr-1" /> 添加要点
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.pinnedMetrics?.map((m, i) => (
          <PinnedMetricCard key={i} pinnedMetric={m} setState={setState} />
        ))}
      </div>
    </>
  );
};
