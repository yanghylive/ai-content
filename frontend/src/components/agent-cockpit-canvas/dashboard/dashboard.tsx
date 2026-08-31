import { cn } from "@/lib/agent-cockpit-canvas/utils";
import {
  useChartActions,
  useSearchActions,
} from "@/components/agent-cockpit-canvas/chat/actions";
import { Charts } from "@/components/agent-cockpit-canvas/dashboard/layout/charts";
import { PinnedMetrics } from "@/components/agent-cockpit-canvas/dashboard/layout/metrics";
import { useKaypalCockpitState } from "@/components/agent-cockpit-canvas/dashboard/use-kaypal-cockpit-state";
import { Card, CardContent } from "@/components/agent-cockpit-canvas/ui/card";

export function MainLayout({ className }: { className?: string }) {
  const { state, setState } = useKaypalCockpitState();

  // Setup tool rendering and front-end tools
  useChartActions();
  useSearchActions();

  return (
    <div
      className={cn("min-h-screen bg-background text-foreground", className)}
    >
      <div className="mx-auto grid max-w-6xl gap-4 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            持续工作区
          </p>
          <h1 className="mt-1 kx-greet text-foreground">
            当前任务工作区
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            保留 GitHub 对话 +
            持续工作区骨架；右侧只放当前任务草稿、预览、确认、证据和交付物，不做全局状态看板。
          </p>
        </div>
        {state.cockpit?.error ? (
          <Card className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <CardContent className="p-4 text-sm">
              部分状态暂时无法显示。你仍可继续对话；开始任务前，系统会提示需要完成的准备事项。
            </CardContent>
          </Card>
        ) : null}
        <PinnedMetrics state={state} setState={setState} />
        <Charts state={state} setState={setState} />
      </div>
    </div>
  );
}
