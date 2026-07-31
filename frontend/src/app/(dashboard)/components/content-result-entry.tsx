"use client";

import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  ArrowRight,
  FileCheck2,
  FilePenLine,
  Files,
  RefreshCw,
} from "lucide-react";
import {
  WORKSPACE_INTENTS,
  buildWorkspaceIntentHref,
  type WorkspaceIntent,
} from "../content/workspace/workspace-intent";
import {
  recordContentWorkspaceMetric,
  useContentWorkspaceRollout,
} from "@/lib/content-workspace/rollout";
import { useEffect, useRef } from "react";

const intentIcons: Record<WorkspaceIntent, typeof FilePenLine> = {
  create: FilePenLine,
  rewrite: RefreshCw,
  multiplatform: Files,
  prepare: FileCheck2,
};

export function ContentResultEntry() {
  const rollout = useContentWorkspaceRollout();
  const viewed = useRef(false);

  useEffect(() => {
    if (rollout.status !== "enabled" || viewed.current) return;
    viewed.current = true;
    recordContentWorkspaceMetric("result_entry_viewed", rollout);
  }, [rollout]);

  if (rollout.status !== "enabled") return null;

  return (
    <Section padding={4} variant="muted">
      <VStack gap={3}>
        <VStack gap={0.5}>
          <Heading level={2}>直接开始内容工作</Heading>
          <Text as="p" color="secondary" type="supporting">
            选择想要的结果，确认目标和平台后即可进入可编辑简报。
          </Text>
        </VStack>
        <List
          density="balanced"
          hasDividers
          header={
            <Text as="span" type="label" weight="semibold">
              选择结果
            </Text>
          }
        >
          {WORKSPACE_INTENTS.map((intent) => {
            const Icon = intentIcons[intent.id];
            return (
              <ListItem
                key={intent.id}
                description={intent.description}
                endContent={<ArrowRight aria-hidden="true" size={16} />}
                href={buildWorkspaceIntentHref(intent.id)}
                label={intent.label}
                startContent={<Icon aria-hidden="true" size={18} />}
              />
            );
          })}
        </List>
      </VStack>
    </Section>
  );
}
