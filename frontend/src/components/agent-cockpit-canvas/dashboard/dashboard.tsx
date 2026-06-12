import { cn } from "@/lib/agent-cockpit-canvas/utils";
import { useChartActions, useSearchActions } from "@/components/agent-cockpit-canvas/chat/actions";
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
      <div className="max-w-6xl mx-auto p-4 grid gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            持续工作区
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            当前任务工作区
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            保留 GitHub 对话 + 持续工作区骨架；右侧只放当前任务草稿、预览、确认、证据和交付物，不做全局状态看板。
          </p>
        </div>
        {state.cockpit?.error ? (
          <Card className="border-amber-300 bg-amber-50 text-amber-950">
            <CardContent className="p-4 text-sm">
              状态接口未完全可用：{state.cockpit.error}。普通聊天仍可继续，真实任务会在预检/登录完成后接入。
            </CardContent>
          </Card>
        ) : null}
        <PinnedMetrics state={state} setState={setState} />
        <Charts state={state} setState={setState} />
      </div>
    </div>
  );
}
