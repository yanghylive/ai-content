import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/agent-cockpit-canvas/ui/card";
import { Button } from "@/components/agent-cockpit-canvas/ui/button";
import type { ChartSpec, ChartDataMap } from "@/lib/agent-cockpit-canvas/types";
import { ChartRenderer } from "./chart-renderer";
import { ChartTypeIcon } from "./chart-type-icon";

type RenderFunctionStatus = "complete" | "inProgress" | "executing" | string;

interface ChartCardProps {
  spec: ChartSpec;
  onHumanInput?: (shouldProceed: boolean) => void;
  status?: RenderFunctionStatus;
  chartData?: ChartDataMap;
  actionButtonText?: string;
}

export const ChartCard = ({
  spec,
  onHumanInput,
  status,
  chartData,
  actionButtonText = "添加",
}: ChartCardProps) => {
  const title = "title" in spec ? spec.title : undefined;
  const data = (title && chartData?.[title]) || [];
  return (
    <>
      <Card className="group">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <ChartTypeIcon spec={spec} />
            {"title" in spec ? spec.title : "未命名"}
          </CardTitle>
          {status !== "complete" && onHumanInput && (
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              title="删除视图"
            ></button>
          )}
        </CardHeader>
        <CardContent>
          <ChartRenderer spec={spec} data={data} />
        </CardContent>
      </Card>
      {status !== "complete" && onHumanInput && (
        <div className="flex justify-end gap-2 py-4">
          <Button variant="outline" onClick={() => onHumanInput(false)}>
            取消
          </Button>
          <Button
            className="bg-accent/10 border border-accent/40 text-foreground hover:bg-accent/20"
            onClick={() => onHumanInput(true)}
          >
            {actionButtonText}
          </Button>
        </div>
      )}
    </>
  );
};
