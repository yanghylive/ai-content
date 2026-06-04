"use client";

import { useState } from "react";
import { Button, Card, CardBody, Chip, addToast } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import {
  localEngineApi,
  type InteractionTask,
  type LocalEngineEvidence,
} from "@/lib/api/local-engine";

interface InteractionRealtimePanelProps {
  task: InteractionTask | null;
  platformLabel: string;
}

export function InteractionRealtimePanel({
  task,
  platformLabel,
}: InteractionRealtimePanelProps) {
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);

  if (!task) return null;

  const isRunning = task.status === "queued" || task.status === "running";
  const currentStep = task.diagnostics?.currentStep;
  const currentStepMessage = task.diagnostics?.currentStepMessage;

  const steps = task.steps || [];
  const allEvents = [...(task.events || [])].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  const events = allEvents
    .filter((e) => !e.message.includes("已保存") && !e.message.includes("截图"))
    .slice(0, 8);
  const evidenceEvents = allEvents
    .filter((event) => Boolean(event.evidence))
    .slice(0, 6);
  const failureEvidenceEvents = allEvents.filter(
    (event) =>
      event.level === "error" || event.evidence?.type === "failure_reason",
  );
  const failureReason =
    task.failureReason ||
    task.failureContext?.reason ||
    task.diagnostics?.failureReason ||
    task.blockers?.[0]?.reason ||
    failureEvidenceEvents[0]?.evidence?.value ||
    failureEvidenceEvents[0]?.message;
  const nextAction =
    task.nextAction ||
    task.failureContext?.nextAction ||
    task.blockers?.[0]?.nextAction ||
    task.diagnostics?.nextAction;

  const sendClicked =
    steps.some(
      (s) =>
        s.status === "completed" &&
        /发送|send|点击发送/i.test(s.label + s.message),
    ) || events.some((e) => isExplicitSendEvent(e.message));
  const readbackStep = steps.find((s) =>
    /回读|readback|确认发送|replyVisible/i.test(s.label + s.message),
  );
  const readbackFromEvents = allEvents.some((e) =>
    isExplicitReadbackSuccessEvent(e.message, task.replyText),
  );
  const readbackOk =
    readbackFromEvents ||
    (readbackStep?.status === "completed" &&
      isExplicitReadbackSuccessEvent(readbackStep.message, task.replyText));
  const completedWithReadback = task.status === "completed" && readbackOk;
  const networkDiag = translateNetworkDiagnostics(allEvents);
  const replyLabel =
    task.replyGeneratedBy === "fallback" ? "规则兜底回复" : "AI 回复";

  const handleExportDiagnostics = async () => {
    try {
      setExportingDiagnostics(true);
      const result = await localEngineApi.exportTaskDiagnostics(task.id);
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title:
          result.exportStatus === "FAILED"
            ? "诊断包已导出，证据链不完整"
            : "诊断包已导出",
        color: result.exportStatus === "FAILED" ? "warning" : "success",
      });
    } catch (error) {
      addToast({
        title: "诊断包导出失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        color: "danger",
      });
    } finally {
      setExportingDiagnostics(false);
    }
  };

  return (
    <div className="grid gap-3">
      <Card>
        <CardBody className="gap-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              当前状态
            </p>
            <Button
              size="sm"
              variant="flat"
              color={failureReason ? "danger" : "default"}
              isLoading={exportingDiagnostics}
              startContent={
                exportingDiagnostics ? null : (
                  <Icon
                    icon="solar:download-minimalistic-linear"
                    className="text-base"
                  />
                )
              }
              onPress={handleExportDiagnostics}
            >
              导出诊断包
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-tiny text-default-500">平台账号</p>
              <p className="text-sm font-medium">
                {task.accountName || task.platformName || "-"}
              </p>
            </div>
            <div>
              <p className="text-tiny text-default-500">发送模式</p>
              <p className="text-sm font-medium">
                {task.sendMode === "auto-send" ? "自动发送" : "确认后发送"}
              </p>
            </div>
            <div>
              <p className="text-tiny text-default-500">当前阶段</p>
              <p className="text-sm font-medium">{task.statusLabel || "-"}</p>
            </div>
            <div>
              <p className="text-tiny text-default-500">{platformLabel}后台</p>
              <Chip
                size="sm"
                color={
                  isRunning
                    ? "primary"
                    : completedWithReadback
                      ? "success"
                      : task.status === "completed"
                        ? "warning"
                        : "default"
                }
                variant="flat"
              >
                {isRunning
                  ? "运行中"
                  : completedWithReadback
                    ? "已完成"
                    : task.status === "completed"
                      ? "待核验"
                      : task.statusLabel}
              </Chip>
            </div>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div>
              <p className="text-tiny text-default-500">证据数量</p>
              <p className="text-sm font-medium">
                {task.diagnostics?.evidenceCount ?? evidenceEvents.length} 条
              </p>
            </div>
            <div>
              <p className="text-tiny text-default-500">当前打开页面</p>
              <p
                className="text-xs font-mono text-default-600 truncate"
                title={currentStepMessage || ""}
              >
                {extractUrlFromEvents(allEvents) || currentStepMessage || "-"}
              </p>
            </div>
            <div>
              <p className="text-tiny text-default-500">发送按钮</p>
              <Chip
                size="sm"
                color={
                  sendClicked ? "success" : isRunning ? "warning" : "default"
                }
                variant="flat"
              >
                {sendClicked ? "已点击发送" : isRunning ? "等待发送" : "未发送"}
              </Chip>
            </div>
            <div>
              <p className="text-tiny text-default-500">回读确认</p>
              <Chip
                size="sm"
                color={
                  readbackOk ? "success" : readbackStep ? "danger" : "default"
                }
                variant="flat"
              >
                {readbackOk
                  ? "回读成功"
                  : readbackStep
                    ? "回读失败"
                    : sendClicked
                      ? "等待回读"
                      : "-"}
              </Chip>
            </div>
          </div>
        </CardBody>
      </Card>

      {task.sourceText && (
        <Card>
          <CardBody className="gap-2 py-3">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              客户原文
            </p>
            <p className="text-sm leading-6 text-foreground">
              {task.sourceText}
            </p>
          </CardBody>
        </Card>
      )}

      {task.replyText && (
        <Card>
          <CardBody className="gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-tiny uppercase tracking-wider text-default-400">
                {replyLabel}
              </p>
              {task.replyGeneratedBy ? (
                <Chip
                  size="sm"
                  color={task.replyGeneratedBy === "ai" ? "success" : "warning"}
                  variant="flat"
                >
                  {task.replyGeneratedBy === "ai" ? "AI 生成" : "规则兜底"}
                </Chip>
              ) : null}
            </div>
            <p className="text-sm leading-6 text-foreground">
              {task.replyText}
            </p>
          </CardBody>
        </Card>
      )}

      {currentStep && (
        <Card>
          <CardBody className="gap-2 py-3">
            <div className="flex items-center gap-2">
              <Icon
                icon={
                  task.diagnostics?.currentStepStatus === "completed"
                    ? "solar:check-circle-linear"
                    : task.diagnostics?.currentStepStatus === "blocked"
                      ? "solar:danger-triangle-linear"
                      : "solar:refresh-circle-linear"
                }
                className={`text-lg ${
                  task.diagnostics?.currentStepStatus === "completed"
                    ? "text-success"
                    : task.diagnostics?.currentStepStatus === "blocked"
                      ? "text-danger"
                      : "text-primary"
                }`}
              />
              <p className="text-tiny uppercase tracking-wider text-default-400">
                当前步骤
              </p>
            </div>
            <p className="text-sm font-medium">{currentStep}</p>
            {currentStepMessage && (
              <p className="text-tiny leading-5 text-default-500">
                {currentStepMessage}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {failureReason && (
        <Card className="border-danger-200">
          <CardBody className="gap-3 py-3">
            <div className="flex items-center gap-2">
              <Icon
                icon="solar:danger-triangle-linear"
                className="text-lg text-danger"
              />
              <p className="text-tiny uppercase tracking-wider text-danger">
                失败原因
              </p>
            </div>
            <p className="text-sm leading-6 text-foreground">{failureReason}</p>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              <FailureMeta
                label="失败阶段"
                value={task.failureContext?.stage || currentStep}
              />
              <FailureMeta
                label="平台"
                value={
                  task.failureContext?.platform ||
                  task.platformName ||
                  platformLabel
                }
              />
              <FailureMeta
                label="账号"
                value={task.failureContext?.account || task.accountName}
              />
              <FailureMeta
                label="目标"
                value={task.failureContext?.target || task.targetName}
              />
            </div>
            {task.blockers?.length ? (
              <div className="grid gap-2">
                {task.blockers.map((blocker, index) => (
                  <div
                    key={`${blocker.stage}-${index}`}
                    className="rounded-[10px] bg-danger-50 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-danger">
                      {blocker.stage}
                    </p>
                    <p className="mt-1 text-tiny leading-5 text-danger-600">
                      {blocker.reason}
                    </p>
                    {blocker.nextAction ? (
                      <p className="mt-1 text-tiny leading-5 text-default-600">
                        下一步：{blocker.nextAction}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {nextAction ? (
              <p className="rounded-[10px] bg-default-50 px-3 py-2 text-sm leading-6 text-default-700">
                下一步：{nextAction}
              </p>
            ) : null}
          </CardBody>
        </Card>
      )}

      {nextAction && !failureReason && (
        <Card>
          <CardBody className="gap-2 py-3">
            <div className="flex items-center gap-2">
              <Icon
                icon="solar:arrow-right-linear"
                className="text-lg text-primary"
              />
              <p className="text-tiny uppercase tracking-wider text-default-400">
                下一步
              </p>
            </div>
            <p className="text-sm leading-6 text-foreground">{nextAction}</p>
          </CardBody>
        </Card>
      )}

      {steps.length > 0 && (
        <Card>
          <CardBody className="gap-3 py-3">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              执行步骤
            </p>
            <div className="grid gap-2">
              {steps.map((step, index) => {
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
                    className="flex items-start gap-2 rounded-[10px] border border-default-100 px-3 py-2"
                  >
                    <Icon icon={icon} className={`mt-0.5 text-lg ${tone}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.label}</p>
                      <p className="mt-1 text-tiny leading-5 text-default-500">
                        {step.message}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <CardBody className="gap-3 py-3">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              最近事件
            </p>
            <div className="grid gap-2">
              {events.map((event, index) => {
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
                    className="rounded-[10px] bg-default-50 px-3 py-2"
                  >
                    <p className={`text-sm leading-5 ${tone}`}>
                      {event.message}
                    </p>
                    {event.createdAt && (
                      <p className="mt-1 text-tiny text-default-400">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {evidenceEvents.length > 0 && (
        <Card>
          <CardBody className="gap-3 py-3">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              证据
            </p>
            <div className="grid gap-2">
              {evidenceEvents.map((event, index) => {
                const evidence = event.evidence!;
                return (
                  <div
                    key={`${event.id}-${index}`}
                    className="rounded-[10px] border border-default-100 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        size="sm"
                        variant="flat"
                        color={
                          evidence.type === "failure_reason"
                            ? "danger"
                            : "default"
                        }
                      >
                        {evidenceTypeLabel(evidence)}
                      </Chip>
                      <p className="text-sm font-medium text-default-800">
                        {evidence.label || event.message}
                      </p>
                    </div>
                    <p className="mt-2 text-tiny leading-5 text-default-500">
                      {previewEvidenceValue(evidence.value)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-tiny text-default-400">
                      {evidence.stageKey ? (
                        <span>阶段：{evidence.stageKey}</span>
                      ) : null}
                      {event.createdAt ? (
                        <span>
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                      ) : null}
                      {evidence.artifactUrl ? (
                        <a
                          className="font-medium text-primary"
                          href={evidence.artifactUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开证据
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {networkDiag.length > 0 && (
        <Card>
          <CardBody className="gap-3 py-3">
            <p className="text-tiny uppercase tracking-wider text-default-400">
              网络诊断
            </p>
            <div className="grid gap-2">
              {networkDiag.map((item, index) => (
                <div
                  key={`${item.message}-${index}`}
                  className={`rounded-[10px] px-3 py-2 ${
                    item.level === "error"
                      ? "bg-danger-50"
                      : item.level === "warning"
                        ? "bg-warning-50"
                        : "bg-default-50"
                  }`}
                >
                  <p
                    className={`text-sm leading-5 ${
                      item.level === "error"
                        ? "text-danger"
                        : item.level === "warning"
                          ? "text-warning"
                          : "text-default-600"
                    }`}
                  >
                    {item.message}
                  </p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function extractUrlFromEvents(
  events: Array<{ message: string; level?: string }>,
): string | null {
  for (const event of events) {
    const match = event.message.match(/https?:\/\/[^\s,，。]+/);
    if (match) return match[0];
  }
  return null;
}

function normalizeForEvidence(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

function isExplicitSendEvent(message: string) {
  if (/editorCleared|editorGone|输入框已清空/i.test(message)) return false;
  return /已点击发送|发送成功|status=sent|sent=true/i.test(message);
}

function FailureMeta({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-tiny text-default-500">{label}</p>
      <p className="text-sm font-medium text-default-800">{value || "-"}</p>
    </div>
  );
}

function evidenceTypeLabel(evidence: LocalEngineEvidence) {
  const labels: Record<LocalEngineEvidence["type"], string> = {
    text: "文本",
    snapshot: "页面快照",
    screenshot: "截图",
    page_snapshot: "页面证据",
    desktop_screenshot: "桌面截图",
    stage_log: "阶段日志",
    failure_reason: "失败原因",
    diagnostic_bundle: "诊断包",
    file: "文件",
  };
  return labels[evidence.type] || evidence.type;
}

function previewEvidenceValue(value: string, maxLength = 180) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized || "-";
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isExplicitReadbackSuccessEvent(message: string, replyText?: string) {
  const normalizedReply = normalizeForEvidence(replyText || "");
  const normalizedMessage = normalizeForEvidence(message);
  if (!normalizedReply || !normalizedMessage.includes(normalizedReply)) {
    return false;
  }
  if (
    /editorCleared|editorGone|输入框已清空/i.test(message) &&
    !/回读|readback|已在页面看到|回复内容/i.test(message)
  ) {
    return false;
  }
  return /回读成功|回读确认|readback\s*(ok|success|confirmed)|已在页面看到|回复内容已确认/i.test(
    message,
  );
}

function translateNetworkDiagnostics(
  events: Array<{ message: string; level?: string }>,
): Array<{ message: string; level: "info" | "warning" | "error" }> {
  const result: Array<{
    message: string;
    level: "info" | "warning" | "error";
  }> = [];
  for (const event of events) {
    const msg = event.message;
    if (/imapi\.snssdk.*timeout|超时/i.test(msg)) {
      result.push({ message: "私信接口超时，正在重试", level: "warning" });
    } else if (/imapi\.snssdk.*failed|失败|error/i.test(msg)) {
      result.push({ message: "私信接口加载失败", level: "error" });
    } else if (/登录|login|扫码|scan/i.test(msg)) {
      result.push({
        message: "账号需要重新登录，请在浏览器中处理",
        level: "warning",
      });
    } else if (/验证|captcha|滑块|slider/i.test(msg)) {
      result.push({
        message: "页面有验证，需要你在浏览器里处理",
        level: "warning",
      });
    } else if (/读取到.*会话|读取到.*评论/i.test(msg)) {
      result.push({ message: msg, level: "info" });
    } else if (isExplicitSendEvent(msg)) {
      result.push({ message: "已发送，正在回读确认", level: "info" });
    } else if (/回读|readback|确认/i.test(msg)) {
      result.push({ message: msg, level: "info" });
    } else if (/持续加载|loading/i.test(msg)) {
      result.push({ message: "正在加载列表", level: "warning" });
    }
  }
  return result;
}
