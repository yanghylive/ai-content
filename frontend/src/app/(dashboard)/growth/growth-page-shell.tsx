"use client";

import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { BusinessToolResultContext } from "../components/business-tool-result-context";
import { GrowthConsoleEntry } from "./growth-console-entry";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type GrowthPageShellProps = {
  view?:
    | "overview"
    | "acquisition"
    | "strategies"
    | "leads"
    | "account-health"
    | "reports"
    | "workflows";
};

export function GrowthPageShell({ view }: GrowthPageShellProps) {
  const isMobile = useIsMobile();

  // 移动端（<768px）：跳过桌面 Astryx 壳，直接渲染移动只读工作台
  if (isMobile) {
    return <GrowthConsoleEntry view={view} />;
  }

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={2}>
          <Text color="secondary" type="supporting">
            商业增长 · 增长运营
          </Text>
          <Heading level={1}>增长获客</Heading>
          <Text color="secondary">
            达人筛选、账号诊断、策略规划——从机会到动作。
          </Text>
        </VStack>
      </LayoutContent>
      <div className="growth-page-shell flex min-w-0 max-w-full flex-col gap-4">
        <BusinessToolResultContext allowedTools={["account-diagnosis", "kol-screening"]} />
        <GrowthConsoleEntry view={view} />
      </div>
    </Layout>
  );
}
