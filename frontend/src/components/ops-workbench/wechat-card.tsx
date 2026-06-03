"use client";

import { useMemo } from "react";
import { Card, CardBody, Chip, Button, Textarea } from "@heroui/react";
import { Icon } from "@iconify/react";

export type OpsWorkbenchWechatCardStatus =
  | "idle"
  | "ready"
  | "drafting"
  | "review"
  | "sending"
  | "paused";

export type OpsWorkbenchWechatSendPolicy =
  | "read-only-analyze"
  | "approval-send"
  | "auto-send";

export type OpsWorkbenchWechatGuardState =
  | "not-configured"
  | "instruction-guarded"
  | "live-verified";

export type OpsWorkbenchWechatCardProps = {
  contactName: string;
  draftText: string;
  title?: string;
  eyebrow?: string;
  subjectLabel?: string;
  messageLabel?: string;
  summaryWhenEmpty?: string;
  liveDraftText?: string;
  liveDraftReady?: boolean;
  liveDraftHint?: string;
  contextNote: string;
  status: OpsWorkbenchWechatCardStatus;
  sendPolicy?: OpsWorkbenchWechatSendPolicy;
  guardState?: OpsWorkbenchWechatGuardState;
  guardSummary?: string;
  liveConversationName?: string;
  liveActiveName?: string;
  liveConversationMatched?: boolean;
  liveEntityType?: "unknown" | "contact" | "search-result";
  nextCandidateContacts?: string[];
  batchHeadline?: string;
  batchSummary?: string;
  batchProgressLabel?: string;
  batchProgressHint?: string;
  batchProgressPercent?: number;
  lastOutcomeTitle?: string;
  lastOutcomeDetail?: string;
  pauseReason?: string;
  pauseLabel?: string;
  expanded?: boolean;
  disabled?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onContactNameChange?: (value: string) => void;
  onDraftTextChange?: (value: string) => void;
  onContextNoteChange?: (value: string) => void;
  onPrepareQueue?: () => void;
  onUseLiveConversation?: () => void;
  onUseCandidateContact?: (value: string) => void;
  onAlignContact?: () => void;
  onAutoSend?: () => void;
  onControlledSend?: () => void;
  onPause?: () => void;
  onSkipCurrent?: () => void;
  onReadOnlyAnalyze?: () => void;
  onProceedRecommended?: () => void;
  canPrepareQueue?: boolean;
  canUseLiveConversation?: boolean;
  canAlignContact?: boolean;
  canControlledSend?: boolean;
  canAutoSend?: boolean;
  canSkipCurrent?: boolean;
  canReadOnlyAnalyze?: boolean;
  canProceedRecommended?: boolean;
  recommendedActionLabel?: string;
  recommendedActionHint?: string;
  sendBlockReason?: string;
};

const statusLabelMap: Record<OpsWorkbenchWechatCardStatus, string> = {
  idle: "待准备",
  ready: "可开始",
  drafting: "回复准备中",
  review: "待确认发送",
  sending: "发送进行中",
  paused: "已暂停",
};

const statusColorMap: Record<OpsWorkbenchWechatCardStatus, "success" | "warning" | "primary" | "default" | "danger"> = {
  idle: "default",
  ready: "success",
  drafting: "primary",
  review: "warning",
  sending: "primary",
  paused: "default",
};

const sendPolicyLabelMap: Record<OpsWorkbenchWechatSendPolicy, string> = {
  "read-only-analyze": "只看不发",
  "approval-send": "确认后发送",
  "auto-send": "自动发送",
};

const sendPolicyHintMap: Record<OpsWorkbenchWechatSendPolicy, string> = {
  "read-only-analyze": "只查看当前会话内容。",
  "approval-send": "发出前先让你确认。",
  "auto-send": "符合条件时自动发送。",
};

const guardStateLabelMap: Record<OpsWorkbenchWechatGuardState, string> = {
  "not-configured": "待选择联系人",
  "instruction-guarded": "已指定联系人",
  "live-verified": "联系人已对齐",
};

const guardStateColorMap: Record<OpsWorkbenchWechatGuardState, "success" | "warning" | "primary" | "default"> = {
  "not-configured": "warning",
  "instruction-guarded": "primary",
  "live-verified": "success",
};

export function OpsWorkbenchWechatCard({
  contactName,
  draftText,
  title = "微信未回复会话",
  eyebrow = "微信会话",
  subjectLabel = "联系人",
  messageLabel = "正式回复",
  summaryWhenEmpty,
  liveDraftText,
  liveDraftReady = false,
  liveDraftHint,
  contextNote,
  status,
  sendPolicy = "auto-send",
  guardState = "not-configured",
  guardSummary,
  liveConversationName,
  liveActiveName,
  liveConversationMatched,
  liveEntityType = "unknown",
  nextCandidateContacts = [],
  batchHeadline,
  batchSummary,
  batchProgressLabel,
  batchProgressHint,
  batchProgressPercent,
  lastOutcomeTitle,
  lastOutcomeDetail,
  pauseReason,
  pauseLabel = "暂停",
  expanded = true,
  disabled = false,
  onExpandedChange,
  onContactNameChange,
  onDraftTextChange,
  onContextNoteChange,
  onPrepareQueue,
  onUseLiveConversation,
  onUseCandidateContact,
  onAlignContact,
  onAutoSend,
  onControlledSend,
  onPause,
  onSkipCurrent,
  onReadOnlyAnalyze,
  onProceedRecommended,
  canPrepareQueue = true,
  canUseLiveConversation = true,
  canAlignContact = true,
  canControlledSend = true,
  canAutoSend = true,
  canSkipCurrent = true,
  canReadOnlyAnalyze = true,
  canProceedRecommended = true,
  recommendedActionLabel,
  recommendedActionHint,
  sendBlockReason,
}: OpsWorkbenchWechatCardProps) {
  const trimmedContact = contactName.trim();
  const summary = useMemo(() => {
    const hasContact = trimmedContact.length > 0;
    const effectiveDraft = (liveDraftText || draftText).trim();
    const hasDraft = effectiveDraft.length > 0;

    if (hasContact && hasDraft) {
      return `处理 ${trimmedContact}。`;
    }

    if (hasContact) {
      return `先找到 ${trimmedContact}。`;
    }

    return summaryWhenEmpty || "选择联系人或直接从微信当前聊天开始。";
  }, [draftText, liveDraftText, summaryWhenEmpty, trimmedContact]);

  const queueCountLabel = useMemo(() => {
    if (status === "sending") return "队列处理中";
    if (status === "paused") return "队列已暂停";
    if (status === "review") return "等待逐条确认";
    if (status === "drafting") return "正在准备回复";
    if (trimmedContact) return "可先清理该联系人相关会话";
    return "准备清理未回复会话";
  }, [status, trimmedContact]);

  return (
    <Card className="rounded-[18px]">
      <CardBody className="gap-4 p-5">
        <button
          type="button"
          onClick={() => onExpandedChange?.(!expanded)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <p className="text-tiny uppercase tracking-widest text-default-400">
              {eyebrow}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Chip color={statusColorMap[status]} variant="flat" size="sm">
                {statusLabelMap[status]}
              </Chip>
            </div>
            <p className="mt-2 text-sm leading-6 text-default-600">
              默认直接处理并发送；只有窗口、目标或内容不确定，或你选择确认后发送，才会停下来。
            </p>
          </div>
          <Icon
            icon={expanded ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
            className="text-lg text-default-400"
          />
        </button>

        {expanded && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardBody className="gap-3">
                  <div className="flex items-center gap-2">
                    <Icon icon="solar:stars-minimalistic-linear" className="text-lg text-primary" />
                    <p className="text-sm font-medium">今天先清谁</p>
                  </div>
                  <p className="text-sm leading-6 text-default-600">{summary}</p>
                  <div className="flex flex-wrap gap-2 text-tiny">
                    <Chip variant="bordered" size="sm">
                      {queueCountLabel}
                    </Chip>
                    <Chip variant="bordered" size="sm">
                      {sendPolicyLabelMap[sendPolicy]}
                    </Chip>
                    <Chip color={guardStateColorMap[guardState]} variant="flat" size="sm">
                      {guardStateLabelMap[guardState]}
                    </Chip>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardBody className="gap-3">
                  <p className="text-sm font-medium">现在看到的会话</p>
                  <div className="space-y-2 text-sm leading-6 text-default-600">
                    <p>{sendPolicyHintMap[sendPolicy]}</p>
                    <p>
                      当前聊天：
                      <strong className="ml-1 text-foreground">
                        {liveConversationName || "未识别"}
                      </strong>
                    </p>
                    <p>
                      当前选中：
                      <strong className="ml-1 text-foreground">
                        {liveActiveName || "未识别"}
                      </strong>
                    </p>
                    <p>
                      是否对准：
                      <strong
                        className={`ml-1 ${
                          liveConversationMatched ? "text-success" : "text-warning"
                        }`}
                      >
                        {liveConversationMatched ? "已对齐" : "待对齐"}
                      </strong>
                    </p>
                    <p>
                      对象判断：
                      <strong
                        className={`ml-1 ${
                          liveEntityType === "contact"
                            ? "text-success"
                            : liveEntityType === "search-result"
                              ? "text-warning"
                              : "text-foreground"
                        }`}
                      >
                        {liveEntityType === "contact"
                          ? "正常聊天联系人"
                          : liveEntityType === "search-result"
                            ? "搜一搜/公众号结果"
                            : "未确认"}
                      </strong>
                    </p>
                    <p>{guardSummary || "确认联系人后再继续处理。"}</p>
                  </div>
                </CardBody>
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Textarea
                label={subjectLabel}
                value={contactName}
                onValueChange={(value) => onContactNameChange?.(value)}
                isDisabled={disabled}
                minRows={subjectLabel.includes("列表") ? 5 : 1}
                placeholder={subjectLabel.includes("列表") ? "一行一个群或联系人" : "例如：张三"}
                variant="bordered"
                labelPlacement="outside"
              />
              <Textarea
                label={messageLabel}
                value={draftText}
                onValueChange={(value) => onDraftTextChange?.(value)}
                isDisabled={disabled}
                minRows={subjectLabel.includes("列表") ? 5 : 1}
                placeholder={messageLabel.includes("群发") ? "输入要发给这些群或联系人的同一条内容" : "例如：你好，我先帮你把安排确认一下，稍后回你。"}
                variant="bordered"
                labelPlacement="outside"
              />
            </div>

            {nextCandidateContacts.length > 0 ? (
              <Card>
                <CardBody className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">下一条候选联系人</p>
                      <p className="mt-1 text-tiny leading-6 text-default-600">
                        点选候选联系人后，会带回作战台并进入对齐。
                      </p>
                    </div>
                    <Chip variant="bordered" size="sm">
                      真机列表
                    </Chip>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {nextCandidateContacts.map((candidate) => (
                      <Button
                        key={candidate}
                        variant="bordered"
                        size="sm"
                        isDisabled={disabled}
                        onPress={() => onUseCandidateContact?.(candidate)}
                      >
                        {candidate}
                      </Button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {batchHeadline || batchSummary ? (
              <Card>
                <CardBody className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {batchHeadline || "这一轮批量进度"}
                      </p>
                      <p className="mt-1 text-tiny leading-6 text-default-600">
                        {batchSummary || "当前这轮会继续处理下一条候选会话。"}
                      </p>
                    </div>
                    <Chip variant="bordered" size="sm">
                      连续处理
                    </Chip>
                  </div>
                  {typeof batchProgressPercent === "number" ? (
                    <div className="mt-1">
                      <div className="flex items-center justify-between gap-3 text-tiny text-default-400">
                        <span>{batchProgressLabel || "这一轮进度"}</span>
                        <span>{Math.max(0, Math.min(100, Math.round(batchProgressPercent)))}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-default-200">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${Math.max(0, Math.min(100, batchProgressPercent))}%` }}
                        />
                      </div>
                      {batchProgressHint ? (
                        <p className="mt-2 text-tiny leading-6 text-default-600">
                          {batchProgressHint}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ) : null}

            {(lastOutcomeTitle || lastOutcomeDetail || pauseReason) ? (
              <Card>
                <CardBody className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {lastOutcomeTitle || "这一轮最近结果"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-tiny leading-6 text-default-600">
                        {lastOutcomeDetail || "最近一条处理结果会在这里留下来，方便继续下一条。"}
                      </p>
                    </div>
                    <Chip variant="bordered" size="sm">
                      最近结果
                    </Chip>
                  </div>
                  {pauseReason ? (
                    <div className="rounded-[10px] border border-warning-200 bg-warning-50 px-3 py-2 text-tiny leading-6 text-warning">
                      暂停原因：{pauseReason}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardBody className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">现场正式回复</p>
                  <Chip
                    color={liveDraftReady ? "success" : "default"}
                    variant="flat"
                    size="sm"
                  >
                    {liveDraftReady ? "现场回复已回读" : "尚未写入微信输入框"}
                  </Chip>
                </div>
                <p className="text-sm leading-6 text-default-600">
                  {liveDraftHint ||
                    "等待生成可发送的正式回复。"}
                </p>
                <div className="rounded-[10px] border border-default-200 bg-default-50 px-3 py-3 text-sm leading-7">
                  {(liveDraftText || draftText).trim() || "现场还没有可展示的正式回复。"}
                </div>
              </CardBody>
            </Card>

            <Textarea
              label="补充要求"
              value={contextNote}
              onValueChange={(value) => onContextNoteChange?.(value)}
              isDisabled={disabled}
              minRows={3}
              placeholder="例如：优先清理今天未回复的会话，语气保持礼貌简洁。"
              variant="bordered"
              labelPlacement="outside"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="rounded-[10px] border border-default-200 bg-default-50 px-3 py-2 text-tiny leading-6 text-default-600">
                当前发送方式：{sendPolicyLabelMap[sendPolicy]}。
                {sendBlockReason ? (
                  <>
                    <br />
                    <span className="text-warning">当前放行状态：</span>
                    {sendBlockReason}
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {recommendedActionLabel ? (
                  <Button
                    color="primary"
                    isDisabled={disabled || !canProceedRecommended}
                    onPress={onProceedRecommended}
                    title={recommendedActionHint}
                    startContent={<Icon icon="solar:stars-minimalistic-linear" className="text-lg" />}
                  >
                    {recommendedActionLabel}
                  </Button>
                ) : null}
                {canReadOnlyAnalyze ? (
                  <Button
                    variant="bordered"
                    isDisabled={disabled}
                    onPress={onReadOnlyAnalyze}
                    startContent={<Icon icon="solar:stars-minimalistic-linear" className="text-lg" />}
                  >
                    只看当前聊天
                  </Button>
                ) : null}
                {canPrepareQueue ? (
                  <Button
                    variant="bordered"
                    isDisabled={disabled}
                    onPress={onPrepareQueue}
                    startContent={<Icon icon="solar:chat-round-dots-linear" className="text-lg" />}
                  >
                    处理未回复
                  </Button>
                ) : null}
                <Button
                  variant="bordered"
                  isDisabled={disabled || !canUseLiveConversation}
                  onPress={onUseLiveConversation}
                  startContent={<Icon icon="solar:chat-round-dots-linear" className="text-lg" />}
                >
                  用当前聊天
                </Button>
                {canAlignContact ? (
                  <Button
                    variant="bordered"
                    isDisabled={disabled}
                    onPress={onAlignContact}
                    startContent={<Icon icon="solar:chat-round-dots-linear" className="text-lg" />}
                  >
                    确认是这个人
                  </Button>
                ) : null}
                <Button
                  variant="bordered"
                  isDisabled={disabled || !canControlledSend}
                  onPress={onControlledSend}
                  startContent={<Icon icon="solar:send-linear" className="text-lg" />}
                >
                  固定文案确认后发
                </Button>
                <Button
                  color="primary"
                  isDisabled={disabled || !canAutoSend}
                  onPress={onAutoSend}
                  startContent={<Icon icon="solar:send-linear" className="text-lg" />}
                >
                  固定文案直接发
                </Button>
                {canSkipCurrent ? (
                  <Button
                    variant="bordered"
                    isDisabled={disabled}
                    onPress={onSkipCurrent}
                    startContent={<Icon icon="solar:skip-forward-linear" className="text-lg" />}
                  >
                    跳过当前对象
                  </Button>
                ) : null}
                {onPause && (status === "sending" || status === "paused") ? (
                  <Button
                    variant="bordered"
                    isDisabled={disabled}
                    onPress={onPause}
                    startContent={<Icon icon="solar:pause-circle-linear" className="text-lg" />}
                  >
                    {pauseLabel}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
