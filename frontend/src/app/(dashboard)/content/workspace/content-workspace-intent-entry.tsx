"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { Grid } from "@astryxdesign/core/Grid";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { articlesApi } from "@/lib/api/articles";
import { toPublicError } from "@/lib/public-error";
import {
  recordContentWorkspaceMetric,
  type ContentWorkspaceRolloutState,
} from "@/lib/content-workspace/rollout";
import {
  WORKSPACE_INTENT_PLATFORMS,
  buildWorkspaceIntentDraftInput,
  getWorkspaceIntentDefinition,
  type WorkspaceIntent,
  type WorkspaceIntentPlatform,
} from "./workspace-intent";

type ContentWorkspaceIntentEntryProps = {
  intent: WorkspaceIntent;
  rollout: Extract<ContentWorkspaceRolloutState, { status: "enabled" }>;
};

export function ContentWorkspaceIntentEntry({
  intent,
  rollout,
}: ContentWorkspaceIntentEntryProps) {
  const router = useRouter();
  const definition = getWorkspaceIntentDefinition(intent);
  const [goal, setGoal] = useState(definition.defaultGoal);
  const [platform, setPlatform] = useState<WorkspaceIntentPlatform>(
    definition.defaultPlatform,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const goalMissing = !goal.trim();
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    recordContentWorkspaceMetric("intent_form_viewed", rollout, { task: intent });
  }, [intent, rollout]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (goalMissing) {
      setError("请先填写这次内容任务要达成的目标。");
      return;
    }

    setSubmitting(true);
    setError("");
    recordContentWorkspaceMetric("intent_submitted", rollout, {
      task: intent,
      platform,
    });
    try {
      const article = await articlesApi.createDraft(
        buildWorkspaceIntentDraftInput(intent, goal, platform),
      );
      router.replace(
        `/content/workspace?articleId=${encodeURIComponent(article.id)}&step=brief`,
      );
      recordContentWorkspaceMetric("draft_created", rollout, {
        task: intent,
        platform,
      });
    } catch (cause) {
      setError(toPublicError(cause, "草稿创建失败，请重试。"));
      recordContentWorkspaceMetric("draft_create_failed", rollout, {
        task: intent,
        platform,
        errorCode: "draft_create_failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main aria-label={`${definition.label}任务设置`}>
      <Center axis="horizontal" minHeight={560} width="100%">
        <Section maxWidth={1120} padding={6} variant="section" width="100%">
          <Grid columns={{ minWidth: 340, max: 2 }} gap={6} width="100%">
            <Card padding={6} variant="muted">
              <VStack gap={5}>
                <VStack gap={0.5}>
                  <Heading level={1}>{definition.label}</Heading>
                  <Text as="p" color="secondary" type="supporting">
                    {definition.description}
                  </Text>
                </VStack>

                <MetadataList columns="single" label={{ position: "start", width: 92 }}>
                  <MetadataListItem label="提交后">
                    自动进入简报页，继续把目标和平台说清楚。
                  </MetadataListItem>
                  <MetadataListItem label="默认目标">
                    {definition.defaultGoal}
                  </MetadataListItem>
                  <MetadataListItem label="首发平台">
                    先选一个，后续版本可在工作室继续补齐。
                  </MetadataListItem>
                </MetadataList>

                <Banner
                  container="section"
                  description="如果你还没想好怎么写，直接用默认目标也可以，先把草稿建起来。"
                  status="info"
                  title="先开工，再细化"
                />
              </VStack>
            </Card>

            <Card padding={6}>
              <form noValidate onSubmit={submit}>
                <FormLayout direction="vertical">
                  <VStack gap={0.5}>
                    <Heading level={2}>先创建工作草稿</Heading>
                    <Text as="p" color="secondary" type="supporting">
                      只需先填目标和首发平台，提交后就会进入工作室继续推进。
                    </Text>
                  </VStack>

                  <TextInput
                    description="说明这次内容要解决的问题或希望读者完成的行动。默认值已经填好。"
                    hasAutoFocus
                    isRequired
                    label="内容目标"
                    status={
                      error && goalMissing
                        ? { type: "error", message: error }
                        : undefined
                    }
                    value={goal}
                    onChange={(value) => {
                      setGoal(value);
                      if (error) setError("");
                    }}
                  />

                  <VStack gap={2}>
                    <Text as="p" color="secondary" type="supporting">
                      先选择一个首发平台，其他平台版本可以稍后在工作室继续生成。
                    </Text>
                    <Grid columns={{ minWidth: 150, max: 3 }} gap={3}>
                      {WORKSPACE_INTENT_PLATFORMS.map((option) => (
                        <SelectableCard
                          key={option.id}
                          label={option.label}
                          isSelected={platform === option.id}
                          padding={3}
                          onChange={(isSelected) => {
                            if (!isSelected) return;
                            setPlatform(option.id);
                            if (error) setError("");
                          }}
                        >
                          <VStack gap={0.5}>
                            <Text as="p" type="label">
                              {option.label}
                            </Text>
                            <Text as="p" color="secondary" type="supporting">
                              {option.description}
                            </Text>
                          </VStack>
                        </SelectableCard>
                      ))}
                    </Grid>
                  </VStack>

                  {error && !goalMissing ? (
                    <Banner
                      container="section"
                      description={`${error} 输入已保留，可以直接重试。`}
                      status="error"
                      title="草稿未创建"
                    />
                  ) : null}

                  <Button
                    isDisabled={goalMissing}
                    isLoading={submitting}
                    label={definition.submitLabel}
                    type="submit"
                    variant="primary"
                    width="100%"
                  />
                  <AstryxLink
                    as={NextLink}
                    href="/content/optimization"
                    isStandalone
                  >
                    打开旧版内容改写
                  </AstryxLink>
                </FormLayout>
              </form>
            </Card>
          </Grid>
        </Section>
      </Center>
    </main>
  );
}
