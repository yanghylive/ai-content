"use client";

import { Button, Chip, Input, ScrollShadow, Tab, Tabs } from "@heroui/react";
import { useMemo } from "react";
import { FilePlus2, Search, X } from "@/components/iconpark";
import {
  WORKSPACE_STEPS,
  buildReviewChecks,
  type EditorValue,
  type WorkspaceQueueItemView,
  type WorkspaceStepId,
} from "./workspace-types";
import { SkeletonList } from "@/components/skeleton";

export type ContentQueueStatusFilter =
  | "all"
  | "draft"
  | "writing"
  | "review"
  | "ready"
  | "published";

type ContentQueueProps = {
  items: WorkspaceQueueItemView[];
  selectedId: string;
  activeStep: WorkspaceStepId;
  value: EditorValue;
  keyword: string;
  statusFilter: ContentQueueStatusFilter;
  loading: boolean;
  creating: boolean;
  onKeywordChange: (value: string) => void;
  onStatusFilterChange: (value: ContentQueueStatusFilter) => void;
  onSelect: (item: WorkspaceQueueItemView) => void;
  onCreate: () => void;
  variant?: "panel" | "drawer";
};

const STATUS_COLOR: Record<
  string,
  "default" | "primary" | "success" | "warning"
> = {
  draft: "default",
  writing: "primary",
  ready: "success",
  review: "warning",
  published: "success",
};

const STATUS_FILTER_LABELS: Record<ContentQueueStatusFilter, string> = {
  all: "全部",
  draft: "草稿",
  writing: "编辑中",
  review: "待审核",
  ready: "已就绪",
  published: "已发布",
};

function isOutlineConfirmed(value: EditorValue) {
  return Boolean(
    value.outline.items.length &&
      value.outline.items.every((item) => item.title.trim()) &&
      value.outline.confirmedAt &&
      !Number.isNaN(Date.parse(value.outline.confirmedAt)) &&
      /^[a-f0-9]{64}$/.test(value.outline.confirmedItemsHash || ""),
  );
}

function resolveCurrentWorkspaceSummary(
  value: EditorValue,
  activeStep: WorkspaceStepId,
  selectedItem: WorkspaceQueueItemView | null,
) {
  if (!selectedItem) {
    return {
      currentStatus: "先点选一篇内容",
      nextAction: "新建草稿后进入简报",
      handoff: "从队列进入下一步工作台",
    };
  }

  const stepLabel =
    WORKSPACE_STEPS.find((step) => step.id === activeStep)?.label || "当前步骤";
  const contentLength = value.content.trim().length;
  const blockedCount = buildReviewChecks(value).filter(
    (item) => item.status === "blocked",
  ).length;

  if (activeStep === "brief") {
    return {
      currentStatus: `${stepLabel} · ${selectedItem.statusLabel}`,
      nextAction: "补齐标题、目标、受众和行动",
      handoff: "交给大纲页整理结构",
    };
  }

  if (activeStep === "outline") {
    const confirmed = isOutlineConfirmed(value);
    return {
      currentStatus: `${stepLabel} · ${confirmed ? "已确认" : "待确认"}`,
      nextAction: confirmed ? "继续正文编辑" : "先确认大纲",
      handoff: confirmed ? "交给正文页写主稿" : "先锁定结构再交接",
    };
  }

  if (activeStep === "draft") {
    return {
      currentStatus: `${stepLabel} · ${contentLength} 字`,
      nextAction:
        contentLength >= 120 ? "继续多平台版本" : "先把正文补到 120 字",
      handoff: contentLength >= 120 ? "交给版本页挑正式版" : "正文达标后再交接",
    };
  }

  if (activeStep === "versions") {
    return {
      currentStatus: `${stepLabel} · ${selectedItem.statusLabel}`,
      nextAction: "确认一个正式版",
      handoff: "交给审核页做最终检查",
    };
  }

  return {
    currentStatus: blockedCount
      ? `${stepLabel} · ${blockedCount} 个阻塞项`
      : `${stepLabel} · 可进入发布准备`,
    nextAction: blockedCount
      ? contentLength < 120
        ? "先回正文补到 120 字"
        : "先处理审核阻塞项"
      : "进入发布准备",
    handoff: blockedCount ? "修完阻塞后再回审核页" : "交给发布中心确认发布",
  };
}

export function ContentQueue({
  items,
  selectedId,
  activeStep,
  value,
  keyword,
  statusFilter,
  loading,
  creating,
  onKeywordChange,
  onStatusFilterChange,
  onSelect,
  onCreate,
  variant = "panel",
}: ContentQueueProps) {
  const statusOptions = useMemo(
    () =>
      (Object.keys(STATUS_FILTER_LABELS) as ContentQueueStatusFilter[]).map(
        (value) => ({
          value,
          label: STATUS_FILTER_LABELS[value],
          count:
            value === "all"
              ? items.length
              : items.filter((item) => item.status === value).length,
        }),
      ),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      statusFilter === "all"
        ? items
        : items.filter((item) => item.status === statusFilter),
    [items, statusFilter],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || visibleItems[0] || null,
    [items, selectedId, visibleItems],
  );
  const currentSummary = useMemo(
    () => resolveCurrentWorkspaceSummary(value, activeStep, selectedItem),
    [activeStep, selectedItem, value],
  );
  const activeFilterLabel = STATUS_FILTER_LABELS[statusFilter];
  const hasStatusFilter = statusFilter !== "all";
  const hasKeyword = Boolean(keyword);
  const hasResetAction = hasKeyword || hasStatusFilter;
  const emptyTitle =
    items.length === 0 && !hasKeyword
      ? "内容队列为空"
      : hasStatusFilter && !hasKeyword
        ? `没有${activeFilterLabel}内容`
        : "没有匹配的内容";
  const emptyDescription =
    hasKeyword && hasStatusFilter
      ? `在“${activeFilterLabel}”里没有找到匹配“${keyword}”的内容。`
      : hasKeyword
        ? "换一个关键词再试，或者清空筛选回到全部内容。"
        : items.length === 0
          ? "新建草稿后可从简报开始创作。"
          : `当前“${activeFilterLabel}”分类下没有内容。`;
  const emptyIcon = hasKeyword ? (
    <Search aria-hidden="true" className="h-6 w-6" />
  ) : (
    <FilePlus2 aria-hidden="true" className="h-6 w-6" />
  );
  const emptyActions = (
    <div className="flex flex-col gap-2 sm:flex-row">
      {hasKeyword ? (
        <Button
          color="primary"
          radius="sm"
          size="sm"
          variant="flat"
          onPress={() => onKeywordChange("")}
        >
          清空搜索
        </Button>
      ) : null}
      {hasStatusFilter ? (
        <Button
          radius="sm"
          size="sm"
          variant="bordered"
          className="border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
          onPress={() => onStatusFilterChange("all")}
        >
          查看全部
        </Button>
      ) : null}
      <Button
        color={hasResetAction ? "default" : "primary"}
        isLoading={creating}
        radius="sm"
        size="sm"
        variant={hasResetAction ? "bordered" : "flat"}
        onPress={onCreate}
      >
        新建草稿
      </Button>
    </div>
  );

  return (
    <aside
      aria-label="内容队列"
      className={`flex min-w-0 flex-col overflow-hidden bg-content1 ${
        variant === "drawer"
          ? "h-full min-h-0"
          : "min-h-[420px] rounded-[6px] border border-divider lg:max-h-[calc(100dvh-12rem)]"
      }`}
    >
      <div className="border-b border-divider px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">内容队列</h2>
            <p className="mt-0.5 text-xs leading-5 text-default-500">
              {items.length} 个内容，先看当前状态、下一步和交接结果再处理
            </p>
          </div>
          <Button
            aria-label="新建内容草稿"
            isIconOnly
            isLoading={creating}
            radius="sm"
            size="sm"
            variant="flat"
            onPress={onCreate}
          >
            <FilePlus2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>

        <Button
          className="mt-3 w-full justify-start"
          color="primary"
          isLoading={creating}
          radius="sm"
          size="sm"
          startContent={
            creating ? null : <FilePlus2 aria-hidden="true" className="h-4 w-4" />
          }
          variant="flat"
          onPress={onCreate}
        >
          新建内容草稿
        </Button>

        <div className="mt-3">
          <Tabs
            size="sm"
            variant="underlined"
            selectedKey={statusFilter}
            onSelectionChange={(key) =>
              onStatusFilterChange(key as ContentQueueStatusFilter)
            }
          >
            {statusOptions.map((option) => (
              <Tab
                key={option.value}
                title={
                  <div className="flex items-center gap-1.5">
                    <span>{option.label}</span>
                    <Chip
                      className="h-5 shrink-0 px-1 text-11"
                      radius="sm"
                      size="sm"
                      variant="flat"
                    >
                      {option.count}
                    </Chip>
                  </div>
                }
              />
            ))}
          </Tabs>
        </div>
      </div>

      <div className="border-b border-divider px-3 py-3">
        <div className="rounded-lg border border-divider bg-content1 bg-default-100 p-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">当前处理</h3>
              <p className="mt-0.5 text-xs leading-5 text-default-500">
                先看选中内容的状态，再决定继续编辑、进入审核还是直接收口。
              </p>
            </div>
            <dl className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <dt className="w-[88px] shrink-0 text-xs text-default-500">
                  当前状态
                </dt>
                <dd className="text-xs text-foreground">
                  {selectedItem
                    ? currentSummary.currentStatus
                    : hasStatusFilter
                      ? `当前筛选：${activeFilterLabel}`
                      : "先点选一篇内容"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[88px] shrink-0 text-xs text-default-500">
                  下一步
                </dt>
                <dd className="text-xs text-foreground">
                  {selectedItem
                    ? currentSummary.nextAction
                    : "新建草稿后进入简报"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[88px] shrink-0 text-xs text-default-500">
                  交接结果
                </dt>
                <dd className="text-xs text-foreground">
                  {selectedItem
                    ? currentSummary.handoff
                    : "从队列进入下一步工作台"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="border-b border-divider p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-12 font-medium text-default-600">
            筛选与搜索
          </p>
          {keyword ? (
            <button
              className="text-11 text-primary hover:text-primary-600"
              type="button"
              onClick={() => onKeywordChange("")}
            >
              清空
            </button>
          ) : null}
        </div>
        <Input
          aria-label="搜索内容队列"
          classNames={{ inputWrapper: "h-9 min-h-9 rounded-[6px]" }}
          endContent={
            keyword ? (
              <button
                aria-label="清空搜索"
                className="rounded p-0.5 text-default-400 hover:text-foreground"
                type="button"
                onClick={() => onKeywordChange("")}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
          placeholder="搜索标题、正文或平台"
          size="sm"
          startContent={<Search aria-hidden="true" className="h-4 w-4 text-default-400" />}
          value={keyword}
          variant="bordered"
          onValueChange={onKeywordChange}
        />
      </div>

      <ScrollShadow className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <SkeletonList rows={3} />
          </div>
        ) : visibleItems.length ? (
          <>
            <div className="border-b border-divider px-3 py-2">
              <p className="text-12 font-medium text-default-600">最近更新</p>
              <p className="mt-0.5 text-11 text-default-400">
                点选内容后会自动恢复上次步骤
              </p>
            </div>
            <ul className="divide-y divide-divider">
              {visibleItems.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <li
                    key={item.id}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-default-50 ${
                      selected ? "bg-primary-50" : ""
                    }`}
                    onClick={() => onSelect(item)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mr-2 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        item.status === "review"
                          ? "bg-warning"
                          : item.status === "published"
                            ? "bg-success"
                            : item.status === "ready"
                              ? "bg-success"
                              : item.status === "writing"
                                ? "bg-primary"
                                : "bg-default-300"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium text-foreground">
                        {item.title || "未命名内容"}
                      </span>
                      <span className="line-clamp-2 text-xs leading-5 text-default-500">
                        {item.excerpt || "还没有正文内容"}
                      </span>
                    </div>
                    <div className="ml-auto flex min-w-0 flex-col items-end gap-1 text-11 text-default-400">
                      <Chip
                        className="h-5 shrink-0 px-1 text-11"
                        color={STATUS_COLOR[item.status] || "default"}
                        radius="sm"
                        size="sm"
                        variant="flat"
                      >
                        {item.statusLabel}
                      </Chip>
                      <time>{item.updatedAt}</time>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="flex min-h-56 items-center justify-center px-6 py-8 text-center">
            <div className="flex flex-col items-center gap-3 py-4">
              <span className="text-default-400">{emptyIcon}</span>
              <h3 className="text-sm font-semibold text-foreground">
                {emptyTitle}
              </h3>
              <p className="text-xs text-default-500">{emptyDescription}</p>
              {emptyActions}
            </div>
          </div>
        )}
      </ScrollShadow>
    </aside>
  );
}
