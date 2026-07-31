"use client";

import { Card, CardBody, Chip, Button } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { FailureActionPanel } from "@/app/(dashboard)/components/failure-action-panel";
import { commercialDisplayText } from "@/lib/commercial-display-text";

export type OpsWorkbenchDouyinCardStatus =
  | "ready"
  | "connecting"
  | "running"
  | "empty"
  | "review"
  | "attention"
  | "offline";

export interface OpsWorkbenchDouyinCardProps {
  status: OpsWorkbenchDouyinCardStatus;
  sendMode?: "auto-send" | "approval-send";
  title?: string;
  summary?: string;
  roundStatusLabel?: string;
  roundStatusDetail?: string;
  progressLabel?: string;
  progressHint?: string;
  lastOutcomeTitle?: string;
  lastOutcomeDetail?: string;
  lastSkipReasonDetail?: string;
  pauseReasonDetail?: string;
  recentOutcomeItems?: Array<{
    title: string;
    detail: string;
    tone?: "success" | "warning" | "danger";
  }>;
  liveSteps?: Array<{
    label: string;
    status: "pending" | "running" | "completed" | "blocked" | "skipped";
    message: string;
  }>;
  liveEvents?: Array<{
    message: string;
    level?: "info" | "success" | "warning" | "error";
    createdAt?: string;
  }>;
  strategyLabel?: string;
  skippedLabel?: string;
  failedLabel?: string;
  pauseResumeLabel?: string;
  browserStatusLabel: string;
  browserStatusDetail?: string;
  browserEndpointLabel?: string;
  browserToolCountLabel?: string;
  permissionModeLabel?: string;
  fallbackLabel?: string;
  stageLabel?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  tertiaryActionLabel?: string;
  refreshActionLabel?: string;
  canStart?: boolean;
  canOpen?: boolean;
  canTertiary?: boolean;
  isBusy?: boolean;
  onSendModeChange?: (mode: "auto-send" | "approval-send") => void;
  onStartAutoReply?: () => void;
  onOpenBackend?: () => void;
  onStartCommentReply?: () => void;
  onRefresh?: () => void;
}

type StatusPresentation = {
  badge: string;
  color: "success" | "warning" | "primary" | "default" | "danger";
  icon: string;
};

function getStatusPresentation(
  status: OpsWorkbenchDouyinCardStatus,
): StatusPresentation {
  switch (status) {
    case "ready":
      return {
        badge: "后台已连接",
        color: "success",
        icon: "solar:plug-connected-linear",
      };
    case "connecting":
      return {
        badge: "后台连接中",
        color: "warning",
        icon: "solar:refresh-circle-linear",
      };
    case "running":
      return {
        badge: "正在处理",
        color: "primary",
        icon: "solar:refresh-circle-linear",
      };
    case "empty":
      return {
        badge: "暂无对象",
        color: "default",
        icon: "solar:document-linear",
      };
    case "review":
      return {
        badge: "等你确认",
        color: "warning",
        icon: "solar:pause-circle-linear",
      };
    case "attention":
      return {
        badge: "需要处理",
        color: "danger",
        icon: "solar:danger-triangle-linear",
      };
    case "offline":
    default:
      return {
        badge: "后台未连接",
        color: "default",
        icon: "solar:radio-linear",
      };
  }
}

function toBusinessLabel(value?: string) {
  if (!value) return "";
  const normalized = commercialDisplayText(value);
  return commercialDisplayText(
    normalized
    .replaceAll("restricted", "确认后发送")
    .replaceAll("custom", "按规则送")
    .replaceAll("full", "自动发送")
    .replaceAll("Chrome MCP", "抖音后台连接")
    .replaceAll("MCP", "后台连接")
    .replaceAll("Agent-S sidecar", "桌面助手")
    .replaceAll("Agent-S", "桌面助手")
    .replaceAll("Desktop fallback", "需要人工接管")
    .replaceAll("Browser First", "优先打开抖音后台")
    .replaceAll("Browser-first", "优先打开抖音后台")
    .replaceAll("DOM", "页面")
    .replaceAll("sent / failed", "成功或失败")
    .replaceAll("主链", "正常处理")
    .replaceAll("兜底", "人工接管"),
  );
}

export function OpsWorkbenchDouyinCard({
  status,
  sendMode = "auto-send",
  title = "抖音私信和评论",
  summary = "先进入真实抖音后台，读取会话或评论内容，AI 写好回复；默认自动发送，只有切到确认后发送才会停下等你确认。",
  roundStatusLabel = "准备开始",
  roundStatusDetail = "开始后显示当前对象、处理结果和停下原因。",
  progressLabel = "已处理 0 条",
  progressHint = "尚未开始。",
  lastOutcomeTitle,
  lastOutcomeDetail,
  lastSkipReasonDetail,
  pauseReasonDetail,
  recentOutcomeItems,
  liveSteps,
  liveEvents,
  strategyLabel,
  skippedLabel,
  failedLabel,
  pauseResumeLabel,
  browserStatusLabel,
  browserStatusDetail,
  browserEndpointLabel,
  browserToolCountLabel,
  permissionModeLabel = "自动发送",
  fallbackLabel = "页面异常、对象不一致或缺少发送能力时，会暂停并说明原因。",
  stageLabel = "待开始",
  primaryActionLabel = "开始清私信",
  secondaryActionLabel = "进入抖音后台",
  tertiaryActionLabel = "开始回评论",
  refreshActionLabel = "刷新后台",
  canStart = true,
  canOpen = true,
  canTertiary = true,
  isBusy = false,
  onSendModeChange,
  onStartAutoReply,
  onOpenBackend,
  onStartCommentReply,
  onRefresh,
}: OpsWorkbenchDouyinCardProps) {
  const presentation = getStatusPresentation(status);
  const safeBrowserStatusLabel = toBusinessLabel(browserStatusLabel);
  const safeBrowserStatusDetail = toBusinessLabel(browserStatusDetail);
  const safePermissionModeLabel = toBusinessLabel(permissionModeLabel);
  const safeStageLabel = toBusinessLabel(stageLabel);
  const safeSummary = toBusinessLabel(summary);
  const safeRoundStatusLabel = toBusinessLabel(roundStatusLabel);
  const safeRoundStatusDetail = toBusinessLabel(roundStatusDetail);
  const safeProgressLabel = toBusinessLabel(progressLabel);
  const safeProgressHint = toBusinessLabel(progressHint);
  const failedCount = Number(String(failedLabel || "").match(/\d+/)?.[0] || 0);
  const needsAttention =
    status === "attention" ||
    status === "offline" ||
    failedCount > 0 ||
    recentOutcomeItems?.some((item) => item.tone === "danger");
  const failureReason =
    status === "offline"
      ? safeBrowserStatusDetail || "未检测到可用平台账号或后台连接。"
      : pauseReasonDetail ||
        lastSkipReasonDetail ||
        recentOutcomeItems?.find((item) => item.tone === "danger")?.detail ||
        "任务执行中出现失败或需要人工处理。";
  return (
    <Card className="rounded-[8px]">
      <CardBody className="gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-tiny uppercase tracking-widest text-default-400">
                {safeBrowserStatusLabel || "平台后台"}
              </p>
              <Chip color={presentation.color} variant="flat" size="sm">
                {presentation.badge}
              </Chip>
            </div>
            <h2 className="mt-2 text-[17px] font-semibold leading-6 tracking-tight text-foreground">
              {title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-default-600">
              {safeSummary}
            </p>
          </div>
          <Card className="min-w-[220px]">
            <CardBody className="gap-3 py-3">
              <div>
                <p className="text-small text-default-500">发出方式：</p>
                <p className="mt-1 text-medium font-semibold">
                  {safePermissionModeLabel}
                </p>
                <p className="mt-1 text-tiny text-default-400">
                  可切换自动发送或确认后发送
                </p>
              </div>
              <div>
                <p className="text-tiny uppercase tracking-wider text-default-400">
                  发送设置
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={sendMode === "auto-send" ? "solid" : "bordered"}
                    color={sendMode === "auto-send" ? "primary" : "default"}
                    isDisabled={isBusy}
                    onPress={() => onSendModeChange?.("auto-send")}
                  >
                    自动发送
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      sendMode === "approval-send" ? "solid" : "bordered"
                    }
                    color={sendMode === "approval-send" ? "warning" : "default"}
                    isDisabled={isBusy}
                    onPress={() => onSendModeChange?.("approval-send")}
                  >
                    确认后发送
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <Card>
            <CardBody className="gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary-50 text-primary">
                  <Icon icon="solar:global-linear" className="text-xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon
                      icon={presentation.icon}
                      className={`text-lg text-${presentation.color}`}
                    />
                    <p className="text-sm font-medium">
                      {safeBrowserStatusLabel}
                    </p>
                  </div>
                  {safeBrowserStatusDetail ? (
                    <p className="mt-2 text-sm leading-6 text-default-600">
                      {safeBrowserStatusDetail}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-tiny text-default-400">
                    {browserEndpointLabel ? (
                      <span>{toBusinessLabel(browserEndpointLabel)}</span>
                    ) : null}
                    {browserToolCountLabel ? (
                      <span>{toBusinessLabel(browserToolCountLabel)}</span>
                    ) : null}
                    <span>{safeStageLabel}</span>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="bordered"
              isDisabled={isBusy}
              onPress={onRefresh}
              startContent={
                <Icon icon="solar:refresh-circle-linear" className="text-lg" />
              }
            >
              {refreshActionLabel}
            </Button>
            <Button
              variant="bordered"
              isDisabled={isBusy || !canOpen}
              onPress={onOpenBackend}
              startContent={
                <Icon icon="solar:alt-arrow-right-linear" className="text-lg" />
              }
            >
              {secondaryActionLabel}
            </Button>
            {onStartCommentReply ? (
              <Button
                variant="bordered"
                isDisabled={isBusy || !canTertiary}
                onPress={onStartCommentReply}
                startContent={
                  <Icon
                    icon="solar:chat-round-dots-linear"
                    className="text-lg"
                  />
                }
              >
                {tertiaryActionLabel}
              </Button>
            ) : null}
            <Button
              color="primary"
              isDisabled={isBusy || !canStart}
              onPress={onStartAutoReply}
              startContent={
                <Icon icon="solar:chat-round-dots-linear" className="text-lg" />
              }
            >
              {primaryActionLabel}
            </Button>
          </div>
        </div>
        <Card>
          <CardBody className="gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-tiny uppercase tracking-wider text-default-400">
                  现在进行到哪
                </p>
                <p className="mt-2 text-sm font-medium">
                  {safeRoundStatusLabel}
                </p>
                <p className="mt-2 text-sm leading-6 text-default-600">
                  {safeRoundStatusDetail}
                </p>
              </div>
              <Card className="min-w-[180px]">
                <CardBody className="gap-2 py-3">
                  <p className="text-tiny uppercase tracking-wider text-default-400">
                    今天清了多少
                  </p>
                  <p className="text-sm font-medium">{safeProgressLabel}</p>
                  <p className="text-tiny leading-6 text-default-600">
                    {safeProgressHint}
                  </p>
                </CardBody>
              </Card>
            </div>
            {strategyLabel ||
            skippedLabel ||
            failedLabel ||
            pauseResumeLabel ? (
              <div className="grid gap-3 md:grid-cols-3">
                {strategyLabel ? (
                  <Card>
                    <CardBody className="py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        当前做法
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {toBusinessLabel(strategyLabel)}
                      </p>
                    </CardBody>
                  </Card>
                ) : null}
                {skippedLabel ? (
                  <Card>
                    <CardBody className="py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        已跳过
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {toBusinessLabel(skippedLabel)}
                      </p>
                    </CardBody>
                  </Card>
                ) : null}
                {failedLabel ? (
                  <Card>
                    <CardBody className="py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        失败
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {toBusinessLabel(failedLabel)}
                      </p>
                    </CardBody>
                  </Card>
                ) : null}
                {pauseResumeLabel ? (
                  <Card>
                    <CardBody className="py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        暂停 / 恢复
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {toBusinessLabel(pauseResumeLabel)}
                      </p>
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            ) : null}
            {needsAttention ? (
              <FailureActionPanel
                actions={[
	                  {
	                    href: "/distribution?tab=accounts",
	                    label: "平台账号",
	                  },
                  {
                    label: refreshActionLabel,
                    onPress: onRefresh || onOpenBackend,
                  },
                  {
	                    href: "/tasks/evidence",
                    label: "结果留存",
                  },
                ]}
                impact="当前互动任务可能无法继续读取、发送或确认结果。"
                nextAction="先确认平台账号和后台连接，再刷新后台或查看结果留存。"
                reason="互动任务需要检查平台账号、后台连接或最近失败记录。"
                technicalDetails={[
                  toBusinessLabel(failureReason),
                  safeBrowserStatusLabel,
                  safeBrowserStatusDetail,
                  safePermissionModeLabel,
                  safeStageLabel,
                ]}
                title="互动任务需要处理"
              />
            ) : null}
            {liveSteps?.length || liveEvents?.length ? (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                {liveSteps?.length ? (
                  <Card>
                    <CardBody className="gap-3 py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        实时步骤
                      </p>
                      <div className="grid gap-2">
                        {liveSteps.map((step, index) => {
                          const tone =
                            step.status === "completed"
                              ? "text-success"
                              : step.status === "running"
                                ? "text-primary"
                                : step.status === "blocked"
                                  ? "text-danger"
                                  : step.status === "skipped"
                                    ? "text-warning"
                                    : "text-default-400";
                          const icon =
                            step.status === "completed"
                              ? "solar:check-circle-linear"
                              : step.status === "running"
                                ? "solar:refresh-circle-linear"
                                : step.status === "blocked"
                                  ? "solar:danger-triangle-linear"
                                  : step.status === "skipped"
                                    ? "solar:skip-next-linear"
                                    : "solar:clock-circle-linear";
                          return (
                            <div
                              key={`${step.label}-${index}`}
                              className="flex items-start gap-2 rounded-[8px] border border-default-100 px-3 py-2"
                            >
                              <Icon
                                icon={icon}
                                className={`mt-0.5 text-lg ${tone}`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {toBusinessLabel(step.label)}
                                </p>
                                <p className="mt-1 text-tiny leading-5 text-default-500">
                                  {toBusinessLabel(step.message)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardBody>
                  </Card>
                ) : null}
                {liveEvents?.length ? (
                  <Card>
                    <CardBody className="gap-3 py-3">
                      <p className="text-tiny uppercase tracking-wider text-default-400">
                        最近动作
                      </p>
                      <div className="grid gap-2">
                        {liveEvents.map((event, index) => {
                          const tone =
                            event.level === "success"
                              ? "text-success"
                              : event.level === "warning"
                                ? "text-warning"
                                : event.level === "error"
                                  ? "text-danger"
                                  : "text-default-500";
                          return (
                            <div
                              key={`${event.message}-${index}`}
                              className="rounded-[8px] bg-default-50 px-3 py-2"
                            >
                              <p className={`text-sm leading-5 ${tone}`}>
                                {toBusinessLabel(event.message)}
                              </p>
                              {event.createdAt ? (
                                <p className="mt-1 text-tiny text-default-400">
                                  {new Date(
                                    event.createdAt,
                                  ).toLocaleTimeString()}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
        {lastOutcomeTitle || lastOutcomeDetail ? (
          <Card>
            <CardBody className="gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-success-50 text-success">
                  <Icon icon="solar:check-circle-linear" className="text-xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-tiny uppercase tracking-wider text-default-400">
                    最近结果
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {toBusinessLabel(lastOutcomeTitle || "最近结果")}
                  </p>
                  {lastOutcomeDetail ? (
                    <p className="mt-2 text-sm leading-6 text-default-600">
                      {toBusinessLabel(lastOutcomeDetail)}
                    </p>
                  ) : null}
                  {lastSkipReasonDetail || pauseReasonDetail ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {lastSkipReasonDetail ? (
                        <Card>
                          <CardBody className="py-3">
                            <p className="text-tiny uppercase tracking-wider text-default-400">
                              为什么跳过
                            </p>
                            <p className="mt-2 text-sm leading-6 text-default-600">
                              {toBusinessLabel(lastSkipReasonDetail)}
                            </p>
                          </CardBody>
                        </Card>
                      ) : null}
                      {pauseReasonDetail ? (
                        <Card>
                          <CardBody className="py-3">
                            <p className="text-tiny uppercase tracking-wider text-default-400">
                              为什么停下
                            </p>
                            <p className="mt-2 text-sm leading-6 text-default-600">
                              {toBusinessLabel(pauseReasonDetail)}
                            </p>
                          </CardBody>
                        </Card>
                      ) : null}
                    </div>
                  ) : null}
                  {recentOutcomeItems?.length ? (
                    <div className="mt-3 grid gap-3">
                      {recentOutcomeItems.map((item, index) => (
                        <Card key={`${item.title}-${index}`}>
                          <CardBody className="py-3">
                            <p
                              className={`text-tiny uppercase tracking-wider ${item.tone === "success" ? "text-success" : item.tone === "warning" ? "text-warning" : item.tone === "danger" ? "text-danger" : "text-default-400"}`}
                            >
                              {toBusinessLabel(item.title)}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-default-600">
                              {toBusinessLabel(item.detail)}
                            </p>
                          </CardBody>
                        </Card>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </CardBody>
          </Card>
        ) : null}
        {fallbackLabel ? (
          <p className="text-tiny leading-6 text-default-400">
            {toBusinessLabel(fallbackLabel)}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
