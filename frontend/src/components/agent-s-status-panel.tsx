"use client";

import React from "react";
import { Card, CardBody, Chip, Button } from "@heroui/react";
import { Icon } from "@iconify/react";

export type AgentSSidecarStatus = "disconnected" | "connecting" | "ready" | "error";
export type AgentSSessionStatus =
    | "idle"
    | "queued"
    | "running"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "cancelled";

export interface AgentSSidecarSummary {
    status: AgentSSidecarStatus;
    label: string;
    detail?: string;
}

export interface AgentSSessionSummary {
    status: AgentSSessionStatus;
    label: string;
    detail?: string;
    sessionId?: string;
}

export interface AgentSTimelineEvent {
    id: string;
    title: string;
    detail?: string;
    timestampLabel?: string;
    actorLabel?: string;
    status: "pending" | "running" | "completed" | "failed" | "blocked" | "waiting";
}

export interface AgentSApprovalRequest {
    id: string;
    title: string;
    description?: string;
    scopeLabel?: string;
    requestedByLabel?: string;
    requestedAtLabel?: string;
    riskLevel?: "low" | "medium" | "high";
    contextRows?: Array<{
        label: string;
        value: string;
    }>;
    draftPreview?: string;
    draftPreviewLabel?: string;
}

export interface AgentSStatusPanelProps {
    sidecar: AgentSSidecarSummary;
    session: AgentSSessionSummary;
    events?: AgentSTimelineEvent[];
    approvalRequest?: AgentSApprovalRequest | null;
    timelineTitle?: string;
    isApprovalSubmitting?: boolean;
    onApprove?: (request: AgentSApprovalRequest, comment?: string) => void;
    onReject?: (request: AgentSApprovalRequest, comment?: string) => void;
    onDefer?: (request: AgentSApprovalRequest) => void;
}

function getSidecarPresentation(status: AgentSSidecarStatus) {
    switch (status) {
        case "ready":
            return {
                icon: "solar:plug-connected-linear",
                color: "success" as const,
                label: "可用",
            };
        case "error":
            return {
                icon: "solar:danger-triangle-linear",
                color: "danger" as const,
                label: "异常",
            };
        case "connecting":
            return {
                icon: "solar:refresh-circle-linear",
                color: "primary" as const,
                label: "连接中",
            };
        case "disconnected":
        default:
            return {
                icon: "solar:radio-linear",
                color: "default" as const,
                label: "未连接",
            };
    }
}

function getSessionPresentation(status: AgentSSessionStatus) {
    switch (status) {
        case "completed":
            return {
                icon: "solar:check-circle-linear",
                color: "success" as const,
                label: "已完成",
            };
        case "failed":
            return {
                icon: "solar:danger-triangle-linear",
                color: "danger" as const,
                label: "失败",
            };
        case "cancelled":
            return {
                icon: "solar:close-circle-linear",
                color: "default" as const,
                label: "已取消",
            };
        case "waiting_approval":
            return {
                icon: "solar:pause-circle-linear",
                color: "warning" as const,
                label: "待确认",
            };
        case "running":
            return {
                icon: "solar:refresh-circle-linear",
                color: "primary" as const,
                label: "处理中",
            };
        case "queued":
            return {
                icon: "solar:clock-circle-linear",
                color: "primary" as const,
                label: "排队中",
            };
        case "idle":
        default:
            return {
                icon: "solar:radio-linear",
                color: "default" as const,
                label: "空闲",
            };
    }
}

function getEventStatusPresentation(status: AgentSTimelineEvent["status"]) {
    switch (status) {
        case "completed":
            return {
                icon: "solar:check-circle-linear",
                color: "success" as const,
                label: "已完成",
            };
        case "failed":
            return {
                icon: "solar:danger-triangle-linear",
                color: "danger" as const,
                label: "失败",
            };
        case "blocked":
            return {
                icon: "solar:pause-circle-linear",
                color: "warning" as const,
                label: "已暂停",
            };
        case "waiting":
            return {
                icon: "solar:clock-circle-linear",
                color: "primary" as const,
                label: "等待中",
            };
        case "running":
            return {
                icon: "solar:refresh-circle-linear",
                color: "primary" as const,
                label: "处理中",
            };
        case "pending":
        default:
            return {
                icon: "solar:play-circle-linear",
                color: "default" as const,
                label: "待开始",
            };
    }
}

function getRiskPresentation(riskLevel: "low" | "medium" | "high" = "medium") {
    switch (riskLevel) {
        case "low":
            return {
                color: "success" as const,
                label: "低风险",
            };
        case "high":
            return {
                color: "danger" as const,
                label: "高风险",
            };
        case "medium":
        default:
            return {
                color: "warning" as const,
                label: "中风险",
            };
    }
}

export function AgentSStatusPanel({
    sidecar,
    session,
    events = [],
    approvalRequest = null,
    timelineTitle = "任务记录",
    isApprovalSubmitting = false,
    onApprove,
    onReject,
    onDefer,
}: AgentSStatusPanelProps) {
    const [comment, setComment] = React.useState("");
    const sidecarPresentation = getSidecarPresentation(sidecar.status);
    const sessionPresentation = getSessionPresentation(session.status);

    React.useEffect(() => {
        setComment("");
    }, [approvalRequest?.id]);

    return (
        <div className="space-y-4">
            {/* 状态卡片 */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardBody className="gap-3">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-small text-default-500">本机能力</p>
                                <h3 className="text-medium font-semibold">{sidecar.label}</h3>
                            </div>
                            <Icon
                                icon={sidecarPresentation.icon}
                                className={`text-2xl text-${sidecarPresentation.color}`}
                            />
                        </div>
                        <Chip color={sidecarPresentation.color} variant="flat" size="sm">
                            {sidecarPresentation.label}
                        </Chip>
                        {sidecar.detail && (
                            <p className="text-small text-default-600">{sidecar.detail}</p>
                        )}
                    </CardBody>
                </Card>

                <Card>
                    <CardBody className="gap-3">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-small text-default-500">当前任务</p>
                                <h3 className="text-medium font-semibold">{session.label}</h3>
                            </div>
                            <Icon
                                icon={sessionPresentation.icon}
                                className={`text-2xl text-${sessionPresentation.color}`}
                            />
                        </div>
                        <Chip color={sessionPresentation.color} variant="flat" size="sm">
                            {sessionPresentation.label}
                        </Chip>
                        {session.detail && (
                            <p className="text-small text-default-600">{session.detail}</p>
                        )}
                        {session.sessionId && (
                            <p className="text-tiny text-default-400">ID: {session.sessionId}</p>
                        )}
                    </CardBody>
                </Card>
            </div>

            {/* 任务时间线 */}
            <Card>
                <CardBody className="gap-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-small text-default-500">任务记录</p>
                            <h3 className="text-medium font-semibold">{timelineTitle}</h3>
                        </div>
                        <Chip variant="flat" size="sm">
                            {events.length} 条
                        </Chip>
                    </div>

                    {events.length === 0 ? (
                        <div className="rounded-[10px] border-2 border-dashed border-default-200 p-6 text-center">
                            <p className="text-small text-default-500">暂无任务记录。</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {events.map((event, index) => {
                                const presentation = getEventStatusPresentation(event.status);
                                const isLast = index === events.length - 1;

                                return (
                                    <div key={event.id} className="flex gap-3">
                                        <div className="flex flex-col items-center">
                                            <Icon
                                                icon={presentation.icon}
                                                className={`text-xl text-${presentation.color}`}
                                            />
                                            {!isLast && (
                                                <div className="mt-2 min-h-6 w-px flex-1 bg-default-200" />
                                            )}
                                        </div>
                                        <Card className="flex-1">
                                            <CardBody className="gap-2 py-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-small font-medium">
                                                        {event.title}
                                                    </p>
                                                    <Chip
                                                        color={presentation.color}
                                                        variant="flat"
                                                        size="sm"
                                                    >
                                                        {presentation.label}
                                                    </Chip>
                                                </div>
                                                {event.detail && (
                                                    <p className="text-tiny text-default-600">
                                                        {event.detail}
                                                    </p>
                                                )}
                                                {(event.timestampLabel || event.actorLabel) && (
                                                    <div className="flex flex-wrap items-center gap-2 text-tiny text-default-500">
                                                        {event.timestampLabel && (
                                                            <span>{event.timestampLabel}</span>
                                                        )}
                                                        {event.actorLabel && (
                                                            <Chip variant="flat" size="sm">
                                                                {event.actorLabel}
                                                            </Chip>
                                                        )}
                                                    </div>
                                                )}
                                            </CardBody>
                                        </Card>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* 审批面板 */}
            <Card>
                <CardBody className="gap-3">
                    {!approvalRequest ? (
                        <div className="flex items-start gap-3">
                            <Icon
                                icon="solar:shield-linear"
                                className="text-2xl text-default-400"
                            />
                            <div>
                                <p className="text-small text-default-500">人工确认</p>
                                <h3 className="text-medium font-semibold">待确认事项</h3>
                                <p className="mt-2 text-small text-default-500">
                                    当前没有待确认事项。
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <Icon
                                        icon="solar:danger-triangle-linear"
                                        className="text-2xl text-warning"
                                    />
                                    <div>
                                        <p className="text-small text-default-500">人工确认</p>
                                        <h3 className="text-medium font-semibold">
                                            {approvalRequest.title}
                                        </h3>
                                    </div>
                                </div>
                                <Chip
                                    color={getRiskPresentation(approvalRequest.riskLevel).color}
                                    variant="flat"
                                    size="sm"
                                >
                                    {getRiskPresentation(approvalRequest.riskLevel).label}
                                </Chip>
                            </div>

                            {approvalRequest.description && (
                                <p className="text-small text-default-600">
                                    {approvalRequest.description}
                                </p>
                            )}

                            <div className="grid gap-3 sm:grid-cols-3">
                                <Card>
                                    <CardBody className="py-2">
                                        <p className="text-tiny text-default-500">影响范围</p>
                                        <p className="text-small">
                                            {approvalRequest.scopeLabel || "未填写"}
                                        </p>
                                    </CardBody>
                                </Card>
                                <Card>
                                    <CardBody className="py-2">
                                        <p className="text-tiny text-default-500">来源</p>
                                        <p className="text-small">
                                            {approvalRequest.requestedByLabel || "桌面助手"}
                                        </p>
                                    </CardBody>
                                </Card>
                                <Card>
                                    <CardBody className="py-2">
                                        <p className="text-tiny text-default-500">时间</p>
                                        <p className="text-small">
                                            {approvalRequest.requestedAtLabel || "刚刚"}
                                        </p>
                                    </CardBody>
                                </Card>
                            </div>

                            {approvalRequest.contextRows &&
                                approvalRequest.contextRows.length > 0 && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {approvalRequest.contextRows.map((row) => (
                                            <Card key={`${approvalRequest.id}:${row.label}`}>
                                                <CardBody className="py-2">
                                                    <p className="text-tiny text-default-500">
                                                        {row.label}
                                                    </p>
                                                    <p className="whitespace-pre-wrap break-words text-small">
                                                        {row.value}
                                                    </p>
                                                </CardBody>
                                            </Card>
                                        ))}
                                    </div>
                                )}

                            {approvalRequest.draftPreview && (
                                <Card>
                                    <CardBody className="py-2">
                                        <p className="text-tiny text-default-500">
                                            {approvalRequest.draftPreviewLabel || "回复预览"}
                                        </p>
                                        <p className="mt-2 whitespace-pre-wrap break-words text-small">
                                            {approvalRequest.draftPreview}
                                        </p>
                                    </CardBody>
                                </Card>
                            )}

                            <div>
                                <label className="block">
                                    <span className="text-tiny text-default-500">备注</span>
                                    <textarea
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        disabled={isApprovalSubmitting}
                                        rows={3}
                                        placeholder="可以补充这次确认的原因或注意事项"
                                        className="mt-2 w-full resize-y rounded-[10px] border border-default-200 bg-default-100 px-3 py-2 text-small outline-none transition-colors placeholder:text-default-400 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                </label>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    color="primary"
                                    isDisabled={isApprovalSubmitting}
                                    onPress={() =>
                                        onApprove?.(approvalRequest, comment.trim() || undefined)
                                    }
                                    startContent={
                                        <Icon icon="solar:check-read-linear" className="text-lg" />
                                    }
                                >
                                    确认执行
                                </Button>
                                <Button
                                    variant="flat"
                                    isDisabled={isApprovalSubmitting}
                                    onPress={() =>
                                        onReject?.(approvalRequest, comment.trim() || undefined)
                                    }
                                    startContent={
                                        <Icon icon="solar:close-circle-linear" className="text-lg" />
                                    }
                                >
                                    不要执行
                                </Button>
                                <Button
                                    variant="bordered"
                                    isDisabled={isApprovalSubmitting}
                                    onPress={() => onDefer?.(approvalRequest)}
                                    startContent={
                                        <Icon icon="solar:clock-circle-linear" className="text-lg" />
                                    }
                                >
                                    稍后处理
                                </Button>
                            </div>
                        </>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}
