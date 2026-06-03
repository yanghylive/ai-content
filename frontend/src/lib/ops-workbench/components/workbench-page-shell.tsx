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
                      wb.cdpStatus.blocker || "CDP 会话不可用"
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
                ? browserReadyMessage
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
            canOpen={false}
            canTertiary={false}
            isBusy={agentS.agentSBusy || wb.taskBusy}
            onStartAutoReply={wb.handleStart}
            onSendModeChange={douyin.setDouyinSendMode}
            onRefresh={() => {
              void wb.cdpStatus.refresh();
              agentS.refreshAgentSStatus();
            }}
          />

          {wb.activeTask && (
            <InteractionRealtimePanel task={wb.activeTask} platformLabel={platformLabel} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
