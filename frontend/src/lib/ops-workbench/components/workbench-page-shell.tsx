"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Select,
  SelectItem,
} from "@heroui/react";
import { OpsWorkbenchDouyinCard } from "@/components/ops-workbench/douyin-card";
import { InteractionRealtimePanel } from "@/components/ops-workbench/interaction-realtime-panel";
import {
  useDouyinState,
  useAgentSState,
  type UseWorkbenchPageReturn,
} from "@/lib/ops-workbench/hooks";
import type { AutoUploadAccount } from "@/lib/api/auto-upload";

type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export type AccountChipView = {
  label: string;
  color: ChipColor;
};

export type WorkbenchPageShellProps = {
  wb: UseWorkbenchPageReturn;
  douyin: ReturnType<typeof useDouyinState>;
  agentS: ReturnType<typeof useAgentSState>;

  pageTitle: string;
  pageDescription: string;

  platformName: string;
  platformLabel: string;
  browserStatusLabel: string;
  primaryActionLabel: string;
  secondaryActionLabel?: string;

  accountReady: boolean;
  accountChip: (params: {
    account: AutoUploadAccount | null;
    ready: boolean;
  }) => AccountChipView;

  readySummary: string;
  processingSummaryTemplate: string;
  browserReadyMessage: string;
  browserBlockedMessage: string;

  topRowExtras?: React.ReactNode;
  overrideOutcome?: WorkbenchPageShellProps["wb"]["visibleOutcome"];
};

function platformConnectionStatusLabel(
  sessionStatus?: string | null,
  entryLoggedIn?: boolean,
) {
  if (sessionStatus === "ready") return "平台后台已连接";
  if (sessionStatus === "needs_login") return "需要重新登录";
  if (sessionStatus === "error") return "连接异常";
  if (entryLoggedIn === true) return "页面已探测";
  if (entryLoggedIn === false) return "等待登录确认";
  return "待确认";
}

function evidenceSavedLabel(value?: string | null) {
  if (!value) return null;
  if (/screenshot|\.png|\.jpg|\.jpeg|\.webp|\.json|\/Users\//i.test(value)) {
    return "页面证据已保存";
  }
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

export function WorkbenchPageShell({
  wb,
  douyin,
  agentS,
  pageTitle,
  pageDescription,
  platformName,
  platformLabel,
  browserStatusLabel,
  primaryActionLabel,
  secondaryActionLabel,
  accountReady,
  accountChip,
  readySummary,
  processingSummaryTemplate,
  browserReadyMessage,
  browserBlockedMessage,
  topRowExtras,
  overrideOutcome,
}: WorkbenchPageShellProps) {
  const chip = accountChip({
    account: wb.selectedAccount as never,
    ready: wb.cdpStatus.sessionReady,
  });

  const processingSummary = processingSummaryTemplate.replace(
    "{count}",
    String(douyin.douyinBatchState?.processedCount ?? 0),
  );
  const session = wb.cdpStatus.session;
  const entry = wb.lastEntryResult;
  const browserEvidence = [
    session?.status || entry?.loggedIn != null
      ? `连接：${platformConnectionStatusLabel(session?.status, entry?.loggedIn ?? undefined)}`
      : null,
    session?.runtimeMode || entry?.runtimeMode || session?.browser || entry?.browser
      ? "本机浏览器已接管平台后台"
      : null,
    session?.profileDir || entry?.profileDir
      ? "独立账号环境已准备"
      : null,
    session?.currentUrl || entry?.url
      ? "平台页面已打开"
      : null,
  ].filter(Boolean) as string[];
  const savedEvidence = evidenceSavedLabel(entry?.evidence?.value);
  const pageProbeEvidence = [
    entry?.title ? `页面：${entry.title}` : null,
    typeof entry?.loggedIn === "boolean"
      ? `登录态：${entry.loggedIn ? "已识别" : "待处理"}`
      : null,
    savedEvidence
      ? savedEvidence
      : null,
    entry?.pageTextSample
      ? "页面内容已完成探测"
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{pageTitle}</h1>
        <p className="text-sm text-default-500">{pageDescription}</p>
      </div>

      <Card>
        <CardBody className="gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Chip color={chip.color} size="sm">
                {platformName}账号：{chip.label}
              </Chip>
              {wb.accounts.length > 1 ? (
                <Select
                  aria-label={`选择${platformName}账号`}
                  className="w-56"
                  size="sm"
                  selectedKeys={
                    wb.selectedAccount?.id ? [String(wb.selectedAccount.id)] : []
                  }
                  onSelectionChange={(keys) => {
                    const selectedId = Number(Array.from(keys)[0]);
                    wb.setSelectedAccount(
                      wb.accounts.find((a) => a.id === selectedId) || null,
                    );
                  }}
                >
                  {wb.accounts.map((account) => (
                    <SelectItem key={String(account.id)}>
                      {account.profileName ||
                        account.userName ||
                        `账号 ${account.id}`}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              {topRowExtras}
              {agentS.agentSStatus?.connected ? (
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  onPress={agentS.stopAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  color="primary"
                  onPress={agentS.startAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  启动
                </Button>
              )}
            </div>
          </div>

          {agentS.agentSError && (
            <Chip color="danger" size="sm">
              {agentS.agentSError}
            </Chip>
          )}

          <OpsWorkbenchDouyinCard
            status={
              !accountReady || !wb.cdpStatus.sessionReady
                ? "attention"
                : overrideOutcome?.cardStatus ||
                  wb.visibleOutcome?.cardStatus ||
                  (douyin.douyinBatchState?.active ? "running" : "ready")
            }
            sendMode={douyin.douyinSendMode}
            title={pageTitle}
            summary={
              !accountReady
                ? `当前${platformName}账号未登录，不能读取或回复真实${
                    platformLabel === "抖音" ? "评论" : "内容"
                  }。`
                : !wb.cdpStatus.sessionReady
                  ? `${platformName}后台未就绪：${
                      wb.cdpStatus.blocker || "平台后台连接不可用"
                    }`
                  : overrideOutcome?.roundStatusDetail
                    ? overrideOutcome.roundStatusDetail
                    : wb.visibleOutcome?.roundStatusDetail
                      ? wb.visibleOutcome.roundStatusDetail
                      : douyin.douyinBatchState?.active
                        ? processingSummary
                        : readySummary
            }
            roundStatusLabel={overrideOutcome?.roundStatusLabel ?? wb.visibleOutcome?.roundStatusLabel}
            roundStatusDetail={overrideOutcome?.roundStatusDetail ?? wb.visibleOutcome?.roundStatusDetail}
            stageLabel={overrideOutcome?.stageLabel ?? wb.visibleOutcome?.stageLabel}
            lastOutcomeTitle={overrideOutcome?.lastOutcomeTitle ?? wb.visibleOutcome?.lastOutcomeTitle}
            lastOutcomeDetail={overrideOutcome?.lastOutcomeDetail ?? wb.visibleOutcome?.lastOutcomeDetail}
            liveSteps={overrideOutcome?.liveSteps ?? wb.visibleOutcome?.liveSteps}
            liveEvents={overrideOutcome?.liveEvents ?? wb.visibleOutcome?.liveEvents}
            browserStatusLabel={browserStatusLabel}
            browserStatusDetail={
              wb.cdpStatus.sessionReady
                ? browserEvidence.length
                  ? `${browserReadyMessage} ${browserEvidence.slice(0, 3).join("；")}`
                  : browserReadyMessage
                : wb.cdpStatus.blocker || browserBlockedMessage
            }
            primaryActionLabel={primaryActionLabel}
            secondaryActionLabel={secondaryActionLabel}
            canStart={
              Boolean(wb.selectedAccount?.id) &&
              accountReady &&
              wb.cdpStatus.sessionReady &&
              (overrideOutcome?.canStart ??
                wb.visibleOutcome?.canStart ??
                !douyin.douyinBatchState?.active)
            }
            canOpen={Boolean(wb.selectedAccount?.id)}
            canTertiary={false}
            isBusy={agentS.agentSBusy || wb.taskBusy || wb.openBackendBusy}
            onStartAutoReply={wb.handleStart}
            onOpenBackend={wb.handleOpenBackend}
            onSendModeChange={douyin.setDouyinSendMode}
            onRefresh={() => {
              void wb.cdpStatus.refresh();
              agentS.refreshAgentSStatus();
            }}
          />

          {(browserEvidence.length || pageProbeEvidence.length) ? (
            <div className="grid gap-2 rounded-[10px] border-small border-divider bg-default-50 p-3 text-tiny text-default-600 md:grid-cols-2">
              <div className="space-y-1">
                <p className="font-medium text-default-800">平台后台</p>
                {browserEvidence.length ? (
                  browserEvidence.map((item) => (
                    <p key={item} className="break-all">
                      {item}
                    </p>
                  ))
                ) : (
                  <p>点击进入后台后显示连接状态</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="font-medium text-default-800">页面确认</p>
                {pageProbeEvidence.length ? (
                  pageProbeEvidence.map((item) => (
                    <p key={item} className="break-all">
                      {item}
                    </p>
                  ))
                ) : (
                  <p>点击进入后台后显示页面探测证据</p>
                )}
              </div>
            </div>
          ) : null}

          {wb.activeTask && (
            <InteractionRealtimePanel task={wb.activeTask} platformLabel={platformLabel} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
