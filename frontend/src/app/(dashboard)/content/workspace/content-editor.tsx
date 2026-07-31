"use client";

import Link from "next/link";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Chip,
  Input,
  Spinner,
  Textarea,
  Tooltip,
} from "@heroui/react";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Item } from "@astryxdesign/core/Item";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  GitCompareArrows,
  ListChecks,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { WorkflowSteps } from "./workflow-steps";
import { canEnterWorkspaceStep } from "./content-workspace-state";
import {
  getVersionRowActionAppearance,
  resolveContentEditorPrimaryAction,
  shouldShowRulePreview,
} from "./workspace-action-state";
import type { ArticleWorkspaceBriefField } from "@/lib/api/articles";
import {
  WORKSPACE_STEPS,
  buildReviewChecks,
  type EditorValue,
  type RulePreviewCandidate,
  type SaveState,
  type WorkspaceCandidatePlatform,
  type WorkspaceStepId,
  type WorkspaceVersionView,
} from "./workspace-types";

type ContentEditorProps = {
  activeStep: WorkspaceStepId;
  value: EditorValue;
  versions: WorkspaceVersionView[];
  candidate: RulePreviewCandidate | null;
  loading: boolean;
  mobilePanelOpen: boolean;
  hasUnsavedChanges: boolean;
  officialLoadingVersionId: string;
  saveState: SaveState;
  canPrepare: boolean;
  preparing: boolean;
  confirmingOutline: boolean;
  prepareHint: string;
  onStepChange: (step: WorkspaceStepId) => void;
  onChange: (value: EditorValue) => void;
  onPreviewRules: () => void;
  onApplyRulePreview: () => void;
  onDismissCandidate: () => void;
  onConfirmOutline: () => void;
  onPrepare: () => void;
  onSetOfficialVersion: (versionId: string) => void;
  onSave: () => void;
};

const PLATFORM_OPTIONS: Array<{
  id: Exclude<WorkspaceCandidatePlatform, "all">;
  label: string;
}> = [
  { id: "xiaohongshu", label: "小红书" },
  { id: "wechat", label: "公众号" },
  { id: "douyin", label: "短视频" },
];

type StepGuidance = {
  title: string;
  body: string;
  checkpoints: string[];
  progressLabel: string;
  completionLabel: string;
  nextActionLabel: string;
  handoffLabel: string;
};

function buildStepGuidance(
  activeStep: WorkspaceStepId,
  value: EditorValue,
  versions: WorkspaceVersionView[],
): StepGuidance {
  if (activeStep === "brief") {
    const filledCount = [
      value.title,
      value.brief.goal,
      value.brief.audience,
      value.brief.platforms.join(","),
      value.brief.action,
    ].filter((item) => item.trim()).length;
    return {
      title: "先把任务说清楚",
      body: "这一页只负责明确目标、读者和平台，别急着写正文。",
      checkpoints: ["标题", "目标", "受众/平台"],
      progressLabel: `${filledCount}/5 项已填写`,
      completionLabel:
        filledCount >= 4 ? "简报已基本完整" : "先补齐标题、目标、受众和行动",
      nextActionLabel: "继续：内容大纲",
      handoffLabel: "交给大纲页整理结构",
    };
  }

  if (activeStep === "outline") {
    const readyCount = value.outline.items.filter((item) =>
      item.title.trim(),
    ).length;
    const confirmed = Boolean(
      value.outline.confirmedAt && value.outline.confirmedItemsHash,
    );
    return {
      title: "先确认结构再写正文",
      body: "大纲确认后才进入正文，避免边写边改导致主线散掉。",
      checkpoints: ["添加节点", "补标题", "确认大纲"],
      progressLabel: confirmed
        ? "大纲已确认"
        : `${readyCount}/${value.outline.items.length || 1} 个节点可用`,
      completionLabel: confirmed
        ? "大纲已确认，可进入正文"
        : "先把节点标题和顺序补齐",
      nextActionLabel: confirmed ? "继续：正文编辑" : "先确认大纲",
      handoffLabel: confirmed ? "交给正文页写主稿" : "先锁定结构再交接",
    };
  }

  if (activeStep === "draft") {
    const contentLength = value.content.trim().length;
    return {
      title: "集中完成主稿",
      body: "正文会自动保存。先写完整，再用规则建议做轻量修订。",
      checkpoints: ["标题", "正文", "规则建议"],
      progressLabel: `${contentLength} 字`,
      completionLabel:
        contentLength >= 120 ? "正文已达到可审基线" : "正文建议至少写到 120 字",
      nextActionLabel: "继续：多平台版本",
      handoffLabel: "交给版本页挑正式版",
    };
  }

  if (activeStep === "versions") {
    const officialVersion = versions.find((item) => item.isOfficial);
    return {
      title: "检查不同平台版本",
      body: "这里不直接发布，只选择或查看可交接的渠道版本。",
      checkpoints: ["小红书", "公众号", "短视频"],
      progressLabel: `${versions.length} 个版本`,
      completionLabel: officialVersion
        ? `正式版：${officialVersion.title}`
        : "先确认一个正式版",
      nextActionLabel: "继续：发布准备",
      handoffLabel: "交给审核页做最终检查",
    };
  }

  const checks = buildReviewChecks(value);
  const blockedCount = checks.filter((item) => item.status === "blocked").length;
  return {
    title: "发布前最后检查",
    body: "工作室只生成发布准备，真正发布仍在发布中心确认和执行。",
    checkpoints: ["完整性", "风险词", "素材授权"],
    progressLabel: blockedCount ? `${blockedCount} 个阻塞项` : "已达基线",
    completionLabel: blockedCount ? `${blockedCount} 个阻塞项未清` : "已可进入发布准备",
    nextActionLabel: blockedCount ? "先处理阻塞项" : "进入发布准备",
    handoffLabel: blockedCount ? "修完后再回到审核页" : "交给发布中心确认发布",
  };
}

function StepGuidanceBanner({
  guidance,
}: {
  guidance: StepGuidance;
}) {
  return (
    <section
      aria-label="当前步骤提示"
      className="border-b border-divider bg-default-50 px-4 py-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip color="primary" radius="sm" size="sm" variant="flat">
              当前要做
            </Chip>
            <h2 className="text-sm font-semibold text-foreground">
              {guidance.title}
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-default-500">
            {guidance.body}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {guidance.checkpoints.map((item) => (
            <Chip key={item} radius="sm" size="sm" variant="bordered">
              {item}
            </Chip>
          ))}
          <Chip color="success" radius="sm" size="sm" variant="flat">
            {guidance.progressLabel}
          </Chip>
        </div>
      </div>
      <div className="mt-3">
        <Card padding={4} variant="muted">
          <MetadataList columns="single" label={{ position: "start", width: 88 }}>
            <MetadataListItem label="完成标准">
              {guidance.completionLabel}
            </MetadataListItem>
            <MetadataListItem label="下一步">
              {guidance.nextActionLabel}
            </MetadataListItem>
            <MetadataListItem label="交接结果">
              {guidance.handoffLabel}
            </MetadataListItem>
          </MetadataList>
        </Card>
      </div>
    </section>
  );
}

function RulePreviewDiff({
  value,
  candidate,
  onAccept,
  onDismiss,
}: {
  value: EditorValue;
  candidate: RulePreviewCandidate;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="本地规则建议差异"
      className="border-b border-primary-200 bg-primary-50/60 px-4 py-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary-800">
            <GitCompareArrows aria-hidden="true" className="h-4 w-4" />
            本地规则建议待确认
          </div>
          <p className="mt-1 text-xs leading-5 text-default-600">
            这是固定文本规则预览，不是模型生成。应用前不会改写正文，应用后仍会经过自动保存。
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="min-w-0 border-l-2 border-default-300 pl-2">
              <p className="text-[11px] font-medium text-default-400">当前标题</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-default-600">
                {value.title || "未命名内容"}
              </p>
            </div>
            <div className="min-w-0 border-l-2 border-primary pl-2">
              <p className="text-[11px] font-medium text-primary-600">建议标题</p>
              <p className="mt-0.5 line-clamp-2 text-xs font-medium text-foreground">
                {candidate.title}
              </p>
            </div>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-default-500">
            {candidate.changes.map((change) => (
              <li key={change} className="flex items-center gap-1">
                <Check aria-hidden="true" className="h-3 w-3 text-success-600" />
                {change}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button radius="sm" size="sm" variant="light" onPress={onDismiss}>
            保留原文
          </Button>
          <Button
            color="primary"
            data-workspace-primary-action="rule-preview"
            radius="sm"
            size="sm"
            onPress={onAccept}
          >
            应用规则建议
          </Button>
        </div>
      </div>
    </section>
  );
}

function briefFieldSourcesAfterEdit(
  brief: EditorValue["brief"],
  field: ArticleWorkspaceBriefField,
) {
  return {
    ...brief.fieldSources,
    [field]: { source: "user", label: "已由你修改", edited: true },
  };
}

function briefFieldDescription(
  brief: EditorValue["brief"],
  field: ArticleWorkspaceBriefField,
) {
  const source = brief.fieldSources?.[field];
  if (source) return source.edited ? "已由你修改" : source.label;
  const value = brief[field];
  const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
  return hasValue ? "历史简报，来源未记录" : "尚未关联来源";
}

type BriefPreset = {
  id: string;
  title: string;
  description: string;
  contentTitle: string;
  goal: string;
  audience: string;
  platforms: string[];
  action: string;
  constraints: string;
};

const BRIEF_PRESETS: BriefPreset[] = [
  {
    id: "launch",
    title: "新品种草",
    description: "适合新品首发、活动前预热、需要快速建立信任的内容。",
    contentTitle: "新品首发真实体验笔记",
    goal: "让用户快速理解新品价值，建立信任并产生咨询或收藏意愿。",
    audience: "对新品体验、效率提升和真实使用感受敏感的潜在用户。",
    platforms: ["xiaohongshu"],
    action: "收藏笔记、评论咨询或进入私信了解详情。",
    constraints: "避免绝对化承诺；必须保留真实体验、使用场景和适用人群边界。",
  },
  {
    id: "conversion",
    title: "转化复盘",
    description: "适合已有内容表现一般，需要重写标题、结构和行动指令。",
    contentTitle: "内容转化复盘优化稿",
    goal: "提升读者理解效率，把泛泛浏览转化为明确咨询或下一步行动。",
    audience: "已经对主题有兴趣，但还缺少充分理由采取行动的读者。",
    platforms: ["xiaohongshu", "wechat"],
    action: "引导读者留言问题、领取资料或预约进一步沟通。",
    constraints: "保留事实来源；不夸大结果；先讲问题，再讲方法和证据。",
  },
  {
    id: "education",
    title: "教程科普",
    description: "适合解释复杂能力、降低理解成本、增强专业可信度。",
    contentTitle: "一篇讲清核心方法的教程内容",
    goal: "把复杂主题拆成可理解、可执行的步骤，降低读者决策门槛。",
    audience: "第一次接触该主题，需要清晰解释和具体操作建议的用户。",
    platforms: ["wechat", "douyin"],
    action: "让读者按步骤尝试，并继续关注后续案例或服务说明。",
    constraints: "避免术语堆叠；每段都要有清晰结论；必要时补充案例和注意事项。",
  },
];

const BRIEF_TEMPLATE_FIELDS: ArticleWorkspaceBriefField[] = [
  "goal",
  "audience",
  "platforms",
  "action",
  "constraints",
];

function briefTemplateFieldSources(
  brief: EditorValue["brief"],
  preset: BriefPreset,
) {
  const fieldSources = { ...(brief.fieldSources || {}) };
  for (const field of BRIEF_TEMPLATE_FIELDS) {
    fieldSources[field] = {
      source: "scenario_template",
      label: `由“${preset.title}”模板填充，可修改`,
      edited: true,
    };
  }
  return fieldSources;
}

function BriefStep({ value, onChange }: Pick<ContentEditorProps, "value" | "onChange">) {
  const applyPreset = (preset: BriefPreset) => {
    onChange({
      ...value,
      title: preset.contentTitle,
      brief: {
        ...value.brief,
        goal: preset.goal,
        audience: preset.audience,
        platforms: preset.platforms,
        action: preset.action,
        constraints: preset.constraints,
        fieldSources: briefTemplateFieldSources(value.brief, preset),
      },
    });
  };

  return (
    <FormLayout direction="vertical">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-default-400">任务定义</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">选题简报</h2>
        </div>
        <Chip radius="sm" size="sm" variant="flat">
          当前草稿
        </Chip>
      </div>
      <div className="rounded-[8px] border border-divider bg-default-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <ListChecks aria-hidden="true" className="h-4 w-4 text-primary" />
              先选一个业务场景
            </div>
            <p className="mt-1 text-xs leading-5 text-default-500">
              模板只负责预填简报，后面仍按大纲、正文、审核的真实流程推进。
            </p>
          </div>
          <Chip color="primary" radius="sm" size="sm" variant="flat">
            可改
          </Chip>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {BRIEF_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              className="h-auto justify-start px-3 py-3 text-left"
              radius="sm"
              variant="bordered"
              onPress={() => applyPreset(preset)}
            >
              <span className="flex w-full flex-col items-start gap-1">
                <span className="text-[13px] font-semibold text-foreground">
                  {preset.title}
                </span>
                <span className="text-[11px] leading-5 text-default-500">
                  {preset.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
      <Input
        isRequired
        label="选题标题"
        labelPlacement="outside"
        placeholder="用一句话说明要解决的问题"
        radius="sm"
        value={value.title}
        variant="bordered"
        onValueChange={(title) => onChange({ ...value, title })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Textarea
          classNames={{ input: "min-h-24" }}
          description={briefFieldDescription(value.brief, "goal")}
          label="内容目标"
          labelPlacement="outside"
          minRows={3}
          placeholder="这篇内容需要解决什么业务问题？"
          radius="sm"
          value={value.brief.goal}
          variant="bordered"
          onValueChange={(goal) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                goal,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "goal"),
              },
            })
          }
        />
        <Textarea
          classNames={{ input: "min-h-24" }}
          description={briefFieldDescription(value.brief, "audience")}
          label="目标受众"
          labelPlacement="outside"
          minRows={3}
          placeholder="谁会阅读，以及他们当前最关心什么？"
          radius="sm"
          value={value.brief.audience}
          variant="bordered"
          onValueChange={(audience) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                audience,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "audience"),
              },
            })
          }
        />
        <CheckboxGroup
          classNames={{ wrapper: "flex-row flex-wrap gap-x-4 gap-y-2" }}
          description={briefFieldDescription(value.brief, "platforms")}
          label="目标平台"
          value={value.brief.platforms}
          onValueChange={(platforms) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                platforms,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "platforms"),
              },
            })
          }
        >
          {PLATFORM_OPTIONS.map((platform) => (
            <Checkbox key={platform.id} value={platform.id}>
              {platform.label}
            </Checkbox>
          ))}
        </CheckboxGroup>
        <Input
          description={briefFieldDescription(value.brief, "deadline")}
          label="截止日期"
          labelPlacement="outside"
          radius="sm"
          type="date"
          value={value.brief.deadline || ""}
          variant="bordered"
          onValueChange={(deadline) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                deadline: deadline || null,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "deadline"),
              },
            })
          }
        />
        <Input
          description={briefFieldDescription(value.brief, "action")}
          label="期望行动"
          labelPlacement="outside"
          placeholder="读者看完后应采取什么行动？"
          radius="sm"
          value={value.brief.action}
          variant="bordered"
          onValueChange={(action) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                action,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "action"),
              },
            })
          }
        />
        <Textarea
          className="md:col-span-2"
          classNames={{ input: "min-h-24" }}
          description={briefFieldDescription(value.brief, "constraints")}
          label="表达约束"
          labelPlacement="outside"
          minRows={3}
          placeholder="必须包含或避免的表达、事实与承诺"
          radius="sm"
          value={value.brief.constraints}
          variant="bordered"
          onValueChange={(constraints) =>
            onChange({
              ...value,
              brief: {
                ...value.brief,
                constraints,
                fieldSources: briefFieldSourcesAfterEdit(value.brief, "constraints"),
              },
            })
          }
        />
      </div>
    </FormLayout>
  );
}

type OutlinePreset = {
  id: string;
  title: string;
  description: string;
  items: Array<{
    title: string;
    summary: string;
  }>;
};

const OUTLINE_PRESETS: OutlinePreset[] = [
  {
    id: "problem-solution",
    title: "问题-方案型",
    description: "适合种草、转化和结果导向内容。",
    items: [
      {
        title: "先讲清用户问题",
        summary: "交代读者为什么会关注这个主题，先把痛点说透。",
      },
      {
        title: "给出解决方法",
        summary: "说明产品、方法或经验如何帮助用户解决问题。",
      },
      {
        title: "收束到下一步行动",
        summary: "告诉读者该收藏、咨询、试用还是继续阅读。",
      },
    ],
  },
  {
    id: "step-guide",
    title: "步骤教程型",
    description: "适合科普、教程和方法讲解。",
    items: [
      {
        title: "先给出结论",
        summary: "一句话说明这篇内容最终要帮助读者做到什么。",
      },
      {
        title: "拆成关键步骤",
        summary: "按顺序展开每一步，让读者能跟着执行。",
      },
      {
        title: "补充案例和注意事项",
        summary: "加入常见错误、边界条件和真实例子。",
      },
      {
        title: "最后总结动作",
        summary: "收束成可直接执行的一步建议。",
      },
    ],
  },
  {
    id: "case-review",
    title: "案例复盘型",
    description: "适合经验分享、复盘和信任建立。",
    items: [
      {
        title: "交代场景",
        summary: "说明任务背景、对象和触发原因。",
      },
      {
        title: "拆解过程",
        summary: "讲清过程中的关键判断和动作。",
      },
      {
        title: "总结经验",
        summary: "提炼可复用的结论、方法和边界。",
      },
    ],
  },
];

function OutlineStep({
  value,
  confirmingOutline,
  onChange,
  onConfirmOutline,
}: Pick<
  ContentEditorProps,
  "value" | "confirmingOutline" | "onChange" | "onConfirmOutline"
>) {
  const outlineConfirmed = Boolean(
    value.outline.confirmedAt && value.outline.confirmedItemsHash,
  );
  const outlineSubject = value.title.trim() || value.brief.goal.trim() || "当前主题";
  const applyPreset = (preset: OutlinePreset) => {
    const items = preset.items.map((item) => ({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `outline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: item.title,
      summary: item.summary,
    }));
    onChange({
      ...value,
      outline: { items, confirmedAt: null, confirmedItemsHash: null },
      legacyBodyEditable: false,
    });
  };
  const updateItems = (items: EditorValue["outline"]["items"]) => {
    onChange({
      ...value,
      outline: { items, confirmedAt: null, confirmedItemsHash: null },
      legacyBodyEditable: false,
    });
  };

  const addItem = () => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `outline-${Date.now().toString(36)}`;
    updateItems([
      ...value.outline.items,
      { id, title: "", summary: "" },
    ]);
  };

  const moveItem = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= value.outline.items.length) return;
    const items = [...value.outline.items];
    [items[index], items[target]] = [items[target], items[index]];
    updateItems(items);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-default-400">结构校准</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">内容大纲</h2>
          <p className="mt-1 text-xs text-default-500">
            {outlineConfirmed
              ? `已确认 ${new Date(value.outline.confirmedAt || "").toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
              : `${value.outline.items.length} 个结构节点 · 未确认 · 先为「${outlineSubject}」选一种结构`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            isDisabled={confirmingOutline}
            radius="sm"
            size="sm"
            startContent={<Plus aria-hidden="true" className="h-4 w-4" />}
            variant="bordered"
            onPress={addItem}
          >
            添加节点
          </Button>
          {outlineConfirmed ? (
            <Chip
              color="success"
              size="sm"
              startContent={<CircleCheck aria-hidden="true" className="h-4 w-4" />}
              variant="flat"
            >
              当前大纲已确认
            </Chip>
          ) : (
            <Button
              color="primary"
              data-workspace-primary-action="confirm-outline"
              isLoading={confirmingOutline}
              isDisabled={
                confirmingOutline ||
                !value.outline.items.length ||
                value.outline.items.some((item) => !item.title.trim())
              }
              radius="sm"
              size="sm"
              startContent={<CircleCheck aria-hidden="true" className="h-4 w-4" />}
              variant="flat"
              onPress={onConfirmOutline}
            >
              确认大纲
            </Button>
          )}
        </div>
      </div>
      <div className="rounded-[8px] border border-divider bg-default-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <ListChecks aria-hidden="true" className="h-4 w-4 text-primary" />
              先选一个结构模板
            </div>
            <p className="mt-1 text-xs leading-5 text-default-500">
              模板会覆盖当前未确认的大纲节点，但不会改正文。你可以随后逐项修改。
            </p>
          </div>
          <Chip color="primary" radius="sm" size="sm" variant="flat">
            可随时修改
          </Chip>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {OUTLINE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              className="h-auto justify-start px-3 py-3 text-left"
              radius="sm"
              variant="bordered"
              onPress={() => applyPreset(preset)}
            >
              <span className="flex w-full flex-col items-start gap-1">
                <span className="text-[13px] font-semibold text-foreground">
                  {preset.title}
                </span>
                <span className="text-[11px] leading-5 text-default-500">
                  {preset.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
      {value.outline.items.length ? (
        <ol
          aria-label="内容大纲节点"
          className="divide-y divide-divider rounded-[6px] border border-divider bg-content1"
        >
          {value.outline.items.map((item, index) => (
            <li key={item.id} className="p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-default-500">
                  第 {index + 1} 节
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label={`上移第 ${index + 1} 节`}
                    isDisabled={confirmingOutline || index === 0}
                    isIconOnly
                    radius="sm"
                    size="sm"
                    variant="light"
                    onPress={() => moveItem(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`下移第 ${index + 1} 节`}
                    isDisabled={
                      confirmingOutline ||
                      index === value.outline.items.length - 1
                    }
                    isIconOnly
                    radius="sm"
                    size="sm"
                    variant="light"
                    onPress={() => moveItem(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`删除第 ${index + 1} 节`}
                    color="danger"
                    isDisabled={confirmingOutline}
                    isIconOnly
                    radius="sm"
                    size="sm"
                    variant="light"
                    onPress={() =>
                      updateItems(
                        value.outline.items.filter(
                          (outlineItem) => outlineItem.id !== item.id,
                        ),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <Input
                  aria-label={`第 ${index + 1} 节标题`}
                  isDisabled={confirmingOutline}
                  label="节点标题"
                  labelPlacement="outside"
                  placeholder="例如：先给出结论"
                  radius="sm"
                  value={item.title}
                  variant="bordered"
                  onValueChange={(title) =>
                    updateItems(
                      value.outline.items.map((outlineItem) =>
                        outlineItem.id === item.id
                          ? { ...outlineItem, title }
                          : outlineItem,
                      ),
                    )
                  }
                />
                <Textarea
                  aria-label={`第 ${index + 1} 节要点`}
                  classNames={{ input: "min-h-20" }}
                  isDisabled={confirmingOutline}
                  label="核心要点"
                  labelPlacement="outside"
                  minRows={2}
                  placeholder="这一节需要讲清的事实、案例或行动"
                  radius="sm"
                  value={item.summary}
                  variant="bordered"
                  onValueChange={(summary) =>
                    updateItems(
                      value.outline.items.map((outlineItem) =>
                        outlineItem.id === item.id
                          ? { ...outlineItem, summary }
                          : outlineItem,
                      ),
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="border-y border-dashed border-divider px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">还没有结构节点</p>
          <Button
            className="mt-4"
            color="primary"
            data-workspace-primary-action="add-first-outline-node"
            isDisabled={confirmingOutline}
            radius="sm"
            size="sm"
            startContent={<Plus aria-hidden="true" className="h-4 w-4" />}
            variant="flat"
            onPress={addItem}
          >
            添加第一个节点
          </Button>
        </div>
      )}
    </div>
  );
}

function DraftStep({
  value,
  onChange,
  onPreviewRules,
}: Pick<ContentEditorProps, "value" | "onChange" | "onPreviewRules">) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-default-400">主稿</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">正文编辑</h2>
          <p className="mt-1 text-sm text-default-500">停止输入 800ms 后自动保存。</p>
        </div>
        <Tooltip content="固定文本规则预览，不调用模型，也不会直接覆盖正文">
          <Button
            radius="sm"
            size="sm"
            startContent={<ListChecks aria-hidden="true" className="h-4 w-4" />}
            variant="flat"
            onPress={onPreviewRules}
          >
            预览规则建议
          </Button>
        </Tooltip>
      </div>
      <Input
        isRequired
        label="标题"
        labelPlacement="outside"
        placeholder="输入内容标题"
        radius="sm"
        value={value.title}
        variant="bordered"
        onValueChange={(title) => onChange({ ...value, title })}
      />
      <Textarea
        classNames={{ input: "min-h-[420px] text-[15px] leading-7" }}
        label="正文"
        labelPlacement="outside"
        minRows={17}
        placeholder="从结论或读者问题开始写作。"
        radius="sm"
        value={value.content}
        variant="bordered"
        onValueChange={(content) => onChange({ ...value, content })}
      />
      <div className="flex items-center justify-between text-xs text-default-400">
        <span>支持纯文本与 Markdown 结构</span>
        <span>{value.content.length} 字</span>
      </div>
    </div>
  );
}

function VersionsStep({
  value,
  versions,
  hasUnsavedChanges,
  officialLoadingVersionId,
  onSetOfficialVersion,
}: Pick<
  ContentEditorProps,
  | "value"
  | "versions"
  | "hasUnsavedChanges"
  | "officialLoadingVersionId"
  | "onSetOfficialVersion"
>) {
  const [selectedPlatform, setSelectedPlatform] = useState<
    Exclude<WorkspaceCandidatePlatform, "all">
  >("xiaohongshu");
  const selectedOption = PLATFORM_OPTIONS.find(
    (item) => item.id === selectedPlatform,
  )!;
  const platformCounts = useMemo(
    () =>
      PLATFORM_OPTIONS.reduce(
        (counts, platform) => {
          counts[platform.id] = versions.filter(
            (version) =>
              version.platform === platform.id || version.platform === "all",
          ).length;
          return counts;
        },
        {} as Record<Exclude<WorkspaceCandidatePlatform, "all">, number>,
      ),
    [versions],
  );
  const visibleVersions = versions.filter(
    (version) =>
      version.platform === selectedPlatform || version.platform === "all",
  );
  const officialVersion = versions.find((item) => item.isOfficial);
  const visibleOfficialVersion = visibleVersions.find((item) => item.isOfficial);
  const rowActionAppearance = getVersionRowActionAppearance();
  const versionCountLabel = `${visibleVersions.length} 个版本`;
  const nextStepLabel = hasUnsavedChanges
    ? "先保存当前修改，再切换正式版"
    : visibleVersions.length
      ? "点选任一版本卡即可设为正式版"
      : "前往内容优化创建版本";

  return (
    <div className="space-y-4">
      <Card padding={5}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-primary" />
                多平台版本概览
              </div>
              <p className="mt-1 text-xs leading-5 text-default-500">
                先看当前平台、正式版和下一步，再进入版本选择。
              </p>
            </div>
            <Chip color="primary" radius="sm" size="sm" variant="flat">
              {selectedOption.label}
            </Chip>
          </div>
          <MetadataList columns="single" label={{ position: "start", width: 96 }}>
            <MetadataListItem label="当前平台">
              {selectedOption.label}
            </MetadataListItem>
            <MetadataListItem label="可见版本">
              {versionCountLabel}
            </MetadataListItem>
            <MetadataListItem label="正式版">
              {visibleOfficialVersion?.title || officialVersion?.title || "暂无正式版"}
            </MetadataListItem>
            <MetadataListItem label="下一步">{nextStepLabel}</MetadataListItem>
          </MetadataList>
        </div>
      </Card>
      <TabList
        hasDivider
        layout="fill"
        size="sm"
        value={selectedPlatform}
        onChange={(value) =>
          setSelectedPlatform(value as Exclude<WorkspaceCandidatePlatform, "all">)
        }
      >
        {PLATFORM_OPTIONS.map((platform) => (
          <Tab
            key={platform.id}
            endContent={
              <Chip
                className="h-5 px-1 text-[10px]"
                radius="sm"
                size="sm"
                variant="flat"
              >
                {platformCounts[platform.id]}
              </Chip>
            }
            label={platform.label}
            value={platform.id}
          />
        ))}
      </TabList>
      {visibleVersions.length ? (
        <div className="space-y-3">
          {visibleVersions.map((version) => {
            const matchesCurrent =
              version.title === value.title && version.content === value.content;
            const actionLabel = matchesCurrent
              ? hasUnsavedChanges
                ? "保存并设为正式版"
                : "设为正式版"
              : version.isOfficial
                ? "采用正式版"
                : "采用并设为正式版";
            const settingOfficial = officialLoadingVersionId === version.id;
            return (
              <SelectableCard
                key={version.id}
                aria-busy={settingOfficial}
                label={`版本卡：${version.title}`}
                isDisabled={Boolean(officialLoadingVersionId)}
                isSelected={version.isOfficial}
                padding={4}
                onChange={(isSelected) => {
                  if (isSelected && !version.isOfficial) {
                    onSetOfficialVersion(version.id);
                  }
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {version.title}
                      </h3>
                      {version.isOfficial ? (
                        <Chip color="success" radius="sm" size="sm" variant="flat">
                          正式版
                        </Chip>
                      ) : null}
                      {matchesCurrent ? (
                        <Chip radius="sm" size="sm" variant="bordered">
                          当前编辑版本
                        </Chip>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-default-400">
                      {version.platformLabel} · {version.versionLabel} · {version.updatedAt}
                    </p>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-default-600">
                      {version.content}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {!version.isOfficial || !matchesCurrent ? (
                      <Button
                        aria-label={`${actionLabel}：${version.title}`}
                        color={rowActionAppearance.color}
                        isDisabled={Boolean(officialLoadingVersionId)}
                        isLoading={settingOfficial}
                        radius="sm"
                        size="sm"
                        variant={rowActionAppearance.variant}
                        onPress={() => onSetOfficialVersion(version.id)}
                      >
                        {actionLabel}
                      </Button>
                    ) : null}
                    <span className="text-[11px] leading-5 text-default-400">
                      点击卡片可直接切换正式版
                    </span>
                  </div>
                </div>
              </SelectableCard>
            );
          })}
        </div>
      ) : (
        <Card padding={5}>
          <EmptyState
            actions={
              <Button
                as={Link}
                color="primary"
                href="/content/optimization"
                radius="sm"
                size="sm"
                variant="flat"
              >
                打开内容优化
              </Button>
            }
            description={`${selectedOption.label}还没有已保存版本。主稿当前为 ${value.content.length} 字，可前往内容优化创建真实版本。`}
            headingLevel={3}
            icon={<GitCompareArrows aria-hidden="true" className="h-6 w-6" />}
            isCompact
            title="这个平台还没有已保存版本"
          />
        </Card>
      )}
    </div>
  );
}

function ReviewStep({ value }: Pick<ContentEditorProps, "value">) {
  const checks = buildReviewChecks(value);
  const blockingCount = checks.filter((item) => item.status === "blocked").length;
  const passCount = checks.filter((item) => item.status === "pass").length;
  const summaryLabel = blockingCount
    ? "还有阻塞项"
    : "已达到发布准备基线";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-default-400">交接前检查</p>
        <h2 className="mt-1 text-base font-semibold text-foreground">审核准备</h2>
        <p className="mt-1 text-sm leading-6 text-default-500">
          工作室只创建发布准备记录，真正发布仍在发布中心确认和执行。
        </p>
      </div>
      <Card padding={5}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldAlert
                  aria-hidden="true"
                  className={`h-4 w-4 ${blockingCount ? "text-danger-600" : "text-success-600"}`}
                />
                发布准备摘要
              </div>
              <p className="mt-1 text-xs leading-5 text-default-500">
                先看整体状态，再进入下方逐项检查。
              </p>
            </div>
            <Chip
              color={blockingCount ? "danger" : "success"}
              radius="sm"
              size="sm"
              variant="flat"
            >
              {summaryLabel}
            </Chip>
          </div>
          <MetadataList columns="single" label={{ position: "start", width: 96 }}>
            <MetadataListItem label="内容标题">
              {value.title || "未命名内容"}
            </MetadataListItem>
            <MetadataListItem label="当前状态">
              {blockingCount ? `${blockingCount} 个阻塞项` : "可进入发布准备"}
            </MetadataListItem>
            <MetadataListItem label="通过项">
              {passCount} / {checks.length}
            </MetadataListItem>
            <MetadataListItem label="正文长度">
              {value.content.trim().length} 字
            </MetadataListItem>
            <MetadataListItem label="下一步">
              {blockingCount
                ? "先修复阻塞项，再进入发布准备"
                : "可以继续进入发布中心"}
            </MetadataListItem>
          </MetadataList>
        </div>
      </Card>
      <Card padding={5}>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">检查清单</p>
            <p className="mt-1 text-xs leading-5 text-default-500">
              这些项决定是否可以进入下一步，不做额外编辑。
            </p>
          </div>
          <div className="divide-y divide-divider">
            {checks.map((check) => (
              <Item
                key={check.id}
                align="start"
                density="compact"
                description={check.detail}
                descriptionLines={2}
                endContent={
                  <Chip
                    color={
                      check.status === "pass"
                        ? "success"
                        : check.status === "blocked"
                          ? "danger"
                          : "warning"
                    }
                    radius="sm"
                    size="sm"
                    variant="flat"
                  >
                    {check.status === "pass"
                      ? "通过"
                      : check.status === "blocked"
                        ? "阻塞"
                        : "提醒"}
                  </Chip>
                }
                label={check.label}
                startContent={
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      check.status === "pass"
                        ? "bg-success"
                        : check.status === "blocked"
                          ? "bg-danger"
                          : "bg-warning"
                    }`}
                  />
                }
              />
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

export function ContentEditor({
  activeStep,
  value,
  versions,
  candidate,
  loading,
  mobilePanelOpen,
  hasUnsavedChanges,
  officialLoadingVersionId,
  saveState,
  canPrepare,
  preparing,
  confirmingOutline,
  prepareHint,
  onStepChange,
  onChange,
  onPreviewRules,
  onApplyRulePreview,
  onDismissCandidate,
  onConfirmOutline,
  onPrepare,
  onSetOfficialVersion,
  onSave,
}: ContentEditorProps) {
  const activeIndex = WORKSPACE_STEPS.findIndex((item) => item.id === activeStep);
  const previousStep = WORKSPACE_STEPS[activeIndex - 1];
  const nextStep = WORKSPACE_STEPS[activeIndex + 1];
  const workspaceRef = useRef<HTMLElement>(null);
  const isNextStepBlocked = Boolean(
    nextStep && !canEnterWorkspaceStep(value, nextStep.id),
  );
  const showRulePreview = shouldShowRulePreview(
    activeStep,
    Boolean(candidate),
  );
  const primaryAction = resolveContentEditorPrimaryAction({
    activeStep,
    hasCandidate: Boolean(candidate),
    hasNextStep: Boolean(nextStep),
    nextStepBlocked: isNextStepBlocked,
  });
  const stepGuidance = buildStepGuidance(activeStep, value, versions);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const syncFooterBounds = () => {
      const bounds = workspace.getBoundingClientRect();
      workspace.style.setProperty(
        "--workspace-footer-left",
        `${Math.round(bounds.left)}px`,
      );
      workspace.style.setProperty(
        "--workspace-footer-width",
        `${Math.round(bounds.width)}px`,
      );
    };
    syncFooterBounds();
    const observer = new ResizeObserver(syncFooterBounds);
    observer.observe(workspace);
    window.addEventListener("resize", syncFooterBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncFooterBounds);
    };
  }, []);

  return (
    <section
      ref={workspaceRef}
      aria-label="内容编辑工作区"
      className="order-1 min-w-0 overflow-hidden rounded-[6px] border border-divider bg-content1 xl:order-2"
    >
      <WorkflowSteps
        activeStep={activeStep}
        isStepDisabled={(step) => !canEnterWorkspaceStep(value, step)}
        onStepChange={onStepChange}
      />
      <StepGuidanceBanner guidance={stepGuidance} />
      {showRulePreview && candidate ? (
        <RulePreviewDiff
          candidate={candidate}
          value={value}
          onAccept={onApplyRulePreview}
          onDismiss={onDismissCandidate}
        />
      ) : null}
      {loading ? (
        <div className="flex min-h-[520px] items-center justify-center">
          <Spinner label="加载内容" size="sm" />
        </div>
      ) : (
        <div className="p-4 pb-24 sm:p-5 sm:pb-24 xl:pb-5">
          {activeStep === "brief" ? <BriefStep value={value} onChange={onChange} /> : null}
          {activeStep === "outline" ? (
            <OutlineStep
              confirmingOutline={confirmingOutline}
              value={value}
              onChange={onChange}
              onConfirmOutline={onConfirmOutline}
            />
          ) : null}
          {activeStep === "draft" ? (
            <DraftStep
              value={value}
              onChange={onChange}
              onPreviewRules={onPreviewRules}
            />
          ) : null}
          {activeStep === "versions" ? (
            <VersionsStep
              hasUnsavedChanges={hasUnsavedChanges}
              officialLoadingVersionId={officialLoadingVersionId}
              value={value}
              versions={versions}
              onSetOfficialVersion={onSetOfficialVersion}
            />
          ) : null}
          {activeStep === "review" ? <ReviewStep value={value} /> : null}
        </div>
      )}
      {!loading ? (
        <footer
          className={`${mobilePanelOpen ? "hidden xl:flex" : "flex"} fixed inset-x-0 bottom-0 z-20 min-h-16 items-center justify-between gap-2 border-t border-divider bg-content1 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_14px_rgba(0,0,0,0.08)] max-sm:pl-14 md:left-[var(--workspace-footer-left)] md:right-auto md:w-[var(--workspace-footer-width)] md:min-h-0 md:px-4 md:py-3 xl:static xl:left-auto xl:w-auto xl:shadow-none`}
        >
          <Button
            className="hidden xl:inline-flex"
            isDisabled={!previousStep}
            radius="sm"
            size="sm"
            startContent={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
            variant="light"
            onPress={() => previousStep && onStepChange(previousStep.id)}
          >
            {previousStep?.label || "上一步"}
          </Button>
          <Button
            className="xl:hidden"
            isDisabled={saveState === "saving"}
            isLoading={saveState === "saving"}
            radius="sm"
            size="sm"
            startContent={
              saveState === "saving" ? null : (
                <Save aria-hidden="true" className="h-4 w-4" />
              )
            }
            variant="bordered"
            onPress={onSave}
          >
            {saveState === "error" ? "重试保存" : "保存"}
          </Button>
          {primaryAction === "resolve-rule-preview" ? (
            <span className="text-right text-xs text-default-500">
              先处理规则建议再继续
            </span>
          ) : primaryAction === "advance" && nextStep ? (
            <Button
              color="primary"
              data-workspace-primary-action="advance"
              endContent={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
              radius="sm"
              size="sm"
              variant="flat"
              onPress={() => onStepChange(nextStep.id)}
            >
              继续：{nextStep.label}
            </Button>
          ) : primaryAction === "blocked" ? (
            <span className="text-right text-xs text-default-500">
              {activeStep === "outline"
                ? "确认大纲后可继续"
                : "完成前置步骤后可继续"}
            </span>
          ) : (
            <Tooltip content={prepareHint}>
              <span className="inline-flex">
                    <Button
                      color="primary"
                      data-workspace-primary-action="prepare"
                      isDisabled={!canPrepare}
                  isLoading={preparing}
                  radius="sm"
                  size="sm"
                  variant="flat"
                  onPress={onPrepare}
                >
                  {preparing ? "检查并准备中" : "进入发布准备"}
                </Button>
              </span>
            </Tooltip>
          )}
        </footer>
      ) : null}
    </section>
  );
}
