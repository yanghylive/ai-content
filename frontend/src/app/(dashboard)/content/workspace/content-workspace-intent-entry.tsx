"use client";

import { Button, Card, CardBody, Input } from "@heroui/react";
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
  const [goal, setGoal] = useState(() => {
    if (typeof window !== "undefined") {
      const preset = new URLSearchParams(window.location.search)
        .get("goal")
        ?.trim();
      if (preset) return preset.slice(0, 120);
    }
    return definition.defaultGoal;
  });
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
      <div className="flex items-center justify-center w-full min-h-[560px]">
        <section className="w-full max-w-[1120px] mx-auto p-6">
          <div
            className="grid gap-6 w-full"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            }}
          >
            <Card className="p-6 bg-default-100">
              <CardBody>
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-0.5">
                    <h1 className="text-2xl font-bold">{definition.label}</h1>
                    <p className="text-sm text-default-500">
                      {definition.description}
                    </p>
                  </div>

                  <dl className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <dt className="w-[92px] shrink-0 text-sm text-default-500">
                        提交后
                      </dt>
                      <dd className="text-sm text-foreground">
                        自动进入简报页，继续把目标和平台说清楚。
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[92px] shrink-0 text-sm text-default-500">
                        默认目标
                      </dt>
                      <dd className="text-sm text-foreground">
                        {definition.defaultGoal}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-[92px] shrink-0 text-sm text-default-500">
                        首发平台
                      </dt>
                      <dd className="text-sm text-foreground">
                        先选一个，后续版本可在工作室继续补齐。
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-col gap-1 rounded-lg border border-primary-200 bg-primary-50 p-4">
                    <p className="font-semibold text-primary-700">先开工，再细化</p>
                    <p className="text-sm text-primary-600">
                      如果你还没想好怎么写，直接用默认目标也可以，先把草稿建起来。
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card className="p-6">
              <CardBody>
                <form noValidate onSubmit={submit}>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5">
                      <h2 className="text-xl font-bold">先创建工作草稿</h2>
                      <p className="text-sm text-default-500">
                        只需先填目标和首发平台，提交后就会进入工作室继续推进。
                      </p>
                    </div>

                    <Input
                      description="说明这次内容要解决的问题或希望读者完成的行动。默认值已经填好。"
                      autoFocus
                      isRequired
                      label="内容目标"
                      isInvalid={Boolean(error && goalMissing)}
                      errorMessage={error && goalMissing ? error : undefined}
                      value={goal}
                      onValueChange={(value) => {
                        setGoal(value);
                        if (error) setError("");
                      }}
                    />

                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-default-500">
                        先选择一个首发平台，其他平台版本可以稍后在工作室继续生成。
                      </p>
                      <div
                        className="grid gap-3"
                        style={{
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(150px, 1fr))",
                        }}
                      >
                        {WORKSPACE_INTENT_PLATFORMS.map((option) => (
                          <div
                            key={option.id}
                            role="radio"
                            aria-checked={platform === option.id}
                            aria-label={option.label}
                            onClick={() => {
                              setPlatform(option.id);
                              if (error) setError("");
                            }}
                            className={`cursor-pointer rounded-lg border p-3 ${
                              platform === option.id
                                ? "border-primary ring-2 ring-primary/30 bg-primary-50"
                                : "border-divider hover:border-default-300"
                            }`}
                          >
                            <div className="flex flex-col gap-0.5">
                              <p className="text-sm">{option.label}</p>
                              <p className="text-sm text-default-500">
                                {option.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {error && !goalMissing ? (
                      <div className="flex flex-col gap-1 rounded-lg border border-danger-200 bg-danger-50 p-4">
                        <p className="font-semibold text-danger-600">草稿未创建</p>
                        <p className="text-sm text-danger-600">
                          {`${error} 输入已保留，可以直接重试。`}
                        </p>
                      </div>
                    ) : null}

                    <Button
                      isDisabled={goalMissing}
                      isLoading={submitting}
                      type="submit"
                      color="primary"
                      className="w-full"
                    >
                      {definition.submitLabel}
                    </Button>
                    <NextLink
                      href="/content/optimization"
                      className="text-sm text-primary hover:text-primary-600"
                    >
                      打开旧版内容改写
                    </NextLink>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
