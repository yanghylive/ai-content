"use client";

import { useSearchParams } from "next/navigation";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { ContentWorkspaceClient } from "./content-workspace-client";
import { ContentWorkspaceIntentEntry } from "./content-workspace-intent-entry";
import { useContentWorkspaceRollout } from "@/lib/content-workspace/rollout";
import {
  parseWorkspaceIntent,
  shouldShowWorkspaceIntent,
} from "./workspace-intent";

export function ContentWorkspaceRoute() {
  const searchParams = useSearchParams();
  const intent = parseWorkspaceIntent(searchParams);
  const showIntent = Boolean(intent && shouldShowWorkspaceIntent(searchParams));
  const rollout = useContentWorkspaceRollout(showIntent);

  const content =
    intent && showIntent && rollout.status === "enabled" ? (
      <ContentWorkspaceIntentEntry intent={intent} rollout={rollout} />
    ) : (
      <ContentWorkspaceClient />
    );

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
        <VStack gap={2}>
          <Text color="secondary" type="supporting">
            商业增长 · 内容工作室
          </Text>
          <Heading level={1}>内容工作室</Heading>
          <Text color="secondary">
            从情报发现到内容生成、合规检查、发布管理——一体化创作中心。
          </Text>
        </VStack>
      </LayoutContent>
      {content}
    </Layout>
  );
}