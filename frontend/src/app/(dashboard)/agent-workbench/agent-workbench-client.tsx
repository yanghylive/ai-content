"use client";

import React from "react";
import Link from "next/link";
import {
    Button,
    Card,
    CardBody,
    Chip,
    Divider,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    Select,
    SelectItem,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Textarea,
    addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import {
    localEngineApi,
    type AgentConfirmation,
    type AgentExecutionScope,
    type AgentSession,
    type LocalEngineBrowserStatus,
    type LocalEngineCapability,
    type LocalEngineExecutorsStatus,
    type LocalEngineActionBlocker,
    type LocalEngineFailureContext,
    type LocalEngineHealth,
    type LocalEngineReadiness,
} from "@/lib/api/local-engine";
import { AgentSStatusPanel, type AgentSApprovalRequest, type AgentSTimelineEvent } from "@/components/agent-s-status-panel";

const scopeOptions: Array<{ key: AgentExecutionScope; label: string }> = [
    { key: "mixed", label: "自动判断" },
    { key: "browser", label: "浏览器任务" },
    { key: "desktop", label: "桌面任务" },
    { key: "local-files", label: "本机文件" },
    { key: "remote", label: "远程任务" },
];

const statusColor: Record<AgentSession["status"], "default" | "primary" | "success" | "warning" | "danger"> = {
    draft: "default",
    running: "primary",
    waiting_for_confirmation: "warning",
    completed: "success",
    failed: "danger",
    cancelled: "default",
};

const confirmationSourceHref: Record<AgentSession["source"], string> = {
    "agent-console": "/agent-console",
    publishing: "/distribution?tab=article",
    interaction: "/interaction/records",
    system: "/local-engine?tab=engine",
    web: "/agent-workbench",
};

const confirmationSourceLabel: Record<AgentSession["source"], string> = {
    "agent-console": "智能任务",
    publishing: "发布中心",
    interaction: "互动中心",
    system: "系统任务",
    web: "网页指令",
};

const agentStatusFilterOptions: Array<{ key: "all" | AgentSession["status"]; label: string }> = [
    { key: "all", label: "全部状态" },
    { key: "running", label: "执行中" },
    { key: "waiting_for_confirmation", label: "待确认" },
    { key: "completed", label: "已完成" },
    { key: "failed", label: "失败" },
    { key: "cancelled", label: "已停止" },
];

const agentSourceFilterOptions: Array<{ key: "all" | AgentSession["source"]; label: string }> = [
    { key: "all", label: "全部来源" },
    { key: "agent-console", label: "智能任务" },
    { key: "publishing", label: "发布中心" },
    { key: "interaction", label: "互动中心" },
    { key: "system", label: "系统任务" },
];

const permissionStatusLabel: Record<string, string> = {
    allowed: "商用可执行",
    approval_required: "需人工确认",
    blocked: "商用未授权",
    trial_limited: "试用限制",
};

const evidenceTypeName: Record<string, string> = {
    text: "文本",
    snapshot: "快照",
    screenshot: "浏览器截图",
    page_snapshot: "页面快照",
    desktop_screenshot: "桌面截图",
    stage_log: "阶段日志",
    failure_reason: "失败原因",
    diagnostic_bundle: "诊断包",
    file: "文件",
};

const remoteAuditActionName: Record<string, string> = {
    requested: "申请",
    approved: "审批通过",
    started: "开始接管",
    stopped: "停止接管",
    rejected: "拒绝",
};

const consolePresets: Array<{ label: string; scope: AgentExecutionScope; targetApp: string; instruction: string; href: string }> = [
    {
        label: "处理评论",
        scope: "browser",
        targetApp: "抖音后台",
        instruction: "打开抖音后台整理未回复评论，生成回复草稿，发送前进入待我确认。",
        href: "/workbench/douyin-comments",
    },
    {
        label: "远程检查",
        scope: "remote",
        targetApp: "线上服务",
        instruction: "检查线上服务运行状态和最近错误，只读取日志，不修改配置。",
        href: "/local-engine?tab=remote",
    },
];

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

function formatFailureContext(context: LocalEngineFailureContext) {
    return [
        context.platform ? `平台：${context.platform}` : null,
        context.account ? `账号：${context.account}` : null,
        context.target ? `对象：${context.target}` : null,
        context.stage ? `阶段：${context.stage}` : null,
        `原因：${context.reason}`,
        context.nextAction ? `下一步：${context.nextAction}` : null,
    ].filter(Boolean).join("；");
}

function deriveSessionFailureContext(session: AgentSession): LocalEngineFailureContext | null {
    if (session.failureContext) return session.failureContext;
    if (!session.failureReason && session.status !== "failed") return null;
    const failedEvent = [...session.events].reverse().find((event) => event.level === "error");
    return {
        platform: session.targetApp || confirmationSourceLabel[session.source],
        account: session.source === "agent-console" ? "智能任务" : confirmationSourceLabel[session.source],
        target: session.targetUrl || session.title,
        stage: failedEvent?.evidence?.stageKey || failedEvent?.title || "执行阶段",
        reason: session.failureReason || failedEvent?.message || "执行失败",
        nextAction: session.nextAction || "查看事件时间线，修正账号/权限/对象后重试或停止。",
    };
}

function getConsoleBlockers({
    health,
    scope,
    targetApp,
}: {
    health: LocalEngineHealth | null;
    scope: AgentExecutionScope;
    targetApp: string;
}): LocalEngineActionBlocker[] {
    const blockers: LocalEngineActionBlocker[] = [];
    if (!health?.online) {
        blockers.push({
            platform: targetApp || scopeOptions.find((option) => option.key === scope)?.label || "本机 Agent",
            account: "自动化服务",
            target: targetApp || "未指定",
            stage: "创建任务",
            reason: "本地引擎离线或状态未读取，无法保证任务会被真实执行。",
            nextAction: "请到系统状态刷新或启动本地引擎，再创建任务。",
            capability: "local-engine",
        });
    }
    if ((scope === "browser" || scope === "mixed") && !targetApp.trim()) {
        blockers.push({
            platform: "浏览器平台",
            account: "未选择账号",
            target: "未指定平台后台",
            stage: "浏览器任务预检",
            reason: "浏览器任务需要明确平台或目标应用，避免创建后无法定位账号后台。",
            nextAction: "填写抖音后台、小红书后台、视频号等目标应用；真实平台任务优先从互动中心或发布中心选择账号发起。",
            capability: "browser-control",
        });
    }
    return blockers;
}

export function AgentConsolePage() {
    const [instruction, setInstruction] = React.useState("打开抖音后台整理未回复评论，先生成回复，等我确认后再发送。");
    const [scope, setScope] = React.useState<AgentExecutionScope>("mixed");
    const [targetApp, setTargetApp] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
    const [healthLoading, setHealthLoading] = React.useState(true);
    const [session, setSession] = React.useState<AgentSession | null>(null);

    const refreshHealth = React.useCallback(async () => {
        setHealthLoading(true);
        try {
            setHealth(await localEngineApi.health());
        } catch {
            setHealth(null);
        } finally {
            setHealthLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refreshHealth();
    }, [refreshHealth]);

    const blockers = React.useMemo(
        () => getConsoleBlockers({ health, scope, targetApp }),
        [health, scope, targetApp],
    );
    const canSubmit = instruction.trim().length > 0 && blockers.length === 0;

    const submit = async () => {
        if (!canSubmit) {
            addToast({
                title: "执行已阻断",
                description: blockers[0]?.nextAction || "请先补齐执行条件。",
                color: "warning",
            });
            return;
        }
        setLoading(true);
        try {
            const result = await localEngineApi.createAgentSession({
                instruction,
                executionScope: scope,
                targetApp: targetApp || undefined,
                source: "agent-console",
            });
            setSession(result);
            addToast({ title: "任务已创建", description: result.nextAction, color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "创建失败",
                description: formatFailureContext({
                    platform: targetApp || scope,
                    account: "自动化服务",
                    target: instruction.slice(0, 40),
                    stage: "创建任务",
                    reason: error instanceof Error ? error.message : "请稍后重试",
                    nextAction: "刷新本地引擎、确认服务和账号权限后重试。",
                }),
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AgentShell
            title="智能任务"
            description="在这里直接给本机 Agent 下指令。浏览器、桌面、文件、远程动作统一从会话里执行；发布、发送、删除、改文件会先进入待我确认。"
            icon="solar:magic-stick-3-linear"
        >
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <Card className="border-small border-divider bg-background shadow-sm">
                    <CardBody className="gap-4">
                        <Textarea
                            minRows={7}
                            label="要执行的指令"
                            value={instruction}
                            onValueChange={setInstruction}
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                            <Select
                                label="执行范围"
                                selectedKeys={[scope]}
                                onSelectionChange={(keys) => setScope(Array.from(keys)[0] as AgentExecutionScope)}
                            >
                                {scopeOptions.map((option) => (
                                    <SelectItem key={option.key}>{option.label}</SelectItem>
                                ))}
                            </Select>
                            <Input
                                label="目标应用或平台"
                                placeholder="例如 抖音后台、微信、小红书后台"
                                value={targetApp}
                                onValueChange={setTargetApp}
                            />
                        </div>
                        <Button
                            color="primary"
                            isDisabled={!canSubmit}
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:play-circle-linear" />}
                            onPress={submit}
                        >
                            创建任务
                        </Button>
                        {blockers.length ? <BlockerList blockers={blockers} /> : null}
                        <div className="grid gap-2 md:grid-cols-3">
                            {consolePresets.map((preset) => (
                                <Button
                                    key={preset.label}
                                    size="sm"
                                    variant="flat"
                                    onPress={() => {
                                        setInstruction(preset.instruction);
                                        setScope(preset.scope);
                                        setTargetApp(preset.targetApp);
                                    }}
                                >
                                    {preset.label}
                                </Button>
                            ))}
                        </div>
                    </CardBody>
                </Card>
                <div className="grid gap-4">
                    <SessionCard session={session} emptyText="创建后会在这里看到本机 Agent 的运行状态、暂停点和证据摘要。" />
                    <Card className="border-small border-divider bg-background shadow-sm">
                        <CardBody className="gap-3">
                            <h3 className="text-medium font-semibold text-default-900">常用入口</h3>
                            <div className="grid gap-2 md:grid-cols-3">
                                <StatusPill label="本机引擎" value={healthLoading ? "检查中" : health?.online ? "在线" : "离线"} />
                                <StatusPill label="运行中" value={String(health?.queue.running ?? 0)} />
                                <StatusPill label="待确认" value={String(health?.queue.waitingForApproval ?? 0)} />
                            </div>
                            <div className="grid gap-2">
                                {consolePresets.map((preset) => (
                                    <Button
                                        key={preset.href}
                                        as={Link}
                                        href={preset.href}
                                        variant="flat"
                                        endContent={<Icon icon="solar:alt-arrow-right-linear" />}
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                                <Button as={Link} href="/confirmations" color="warning" variant="flat">
                                    处理待确认
                                </Button>
                                <Button
                                    as={Link}
                                    href="/local-engine?tab=engine"
                                    variant="flat"
                                    startContent={<Icon icon="solar:server-square-cloud-linear" />}
                                >
                                    系统状态
                                </Button>
                            </div>
                        </CardBody>
                    </Card>
                </div>
            </div>
        </AgentShell>
    );
}

export function ConfirmationsPage() {
    const [items, setItems] = React.useState<AgentConfirmation[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [busyId, setBusyId] = React.useState("");

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const confirmations = await localEngineApi.confirmations();
            const pendingConfirmations = confirmations.filter(item => item.status === 'pending');
            setItems(pendingConfirmations);
        } catch (error: unknown) {
            addToast({
                title: "确认队列读取失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const decide = async (item: AgentConfirmation, approved: boolean) => {
        if (approved && isConfirmationBlocked(item)) {
            addToast({
                title: "确认已阻断",
                description: getConfirmationBlockers(item)[0]?.nextAction || "请先处理权限或账号限制。",
                color: "warning",
            });
            return;
        }
        setBusyId(item.id);
        try {
            const confirmedChecks = Object.fromEntries((item.requiredChecks || []).map((check) => [check.key, true]));
            if (approved) {
                await localEngineApi.approveConfirmation(item.id, { operator: "当前用户", confirmedChecks, riskConfirmation: { confirmed: true, fullPermission: false } });
            } else {
                await localEngineApi.rejectConfirmation(item.id, { operator: "当前用户", note: "用户拒绝继续执行" });
            }
            await refresh();
            addToast({ title: approved ? "已确认继续" : "已拒绝执行", color: approved ? "success" : "warning" });
        } catch (error: unknown) {
            addToast({
                title: "操作失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBusyId("");
        }
    };

    return (
        <AgentShell
            title="待我确认"
            description="以下动作需要你确认后才能继续。确认后会自动执行，拒绝则取消。"
            icon="solar:check-square-linear"
            action={<Button variant="flat" onPress={refresh}>刷新</Button>}
        >
            {loading ? <LoadingBlock /> : null}
            {!loading && items.length === 0 ? <EmptyBlock text="当前没有待处理确认。" /> : null}
            <div className="grid gap-4">
                {items.map((item) => (
                    <Card key={item.id} className="border-small border-divider bg-background shadow-sm">
                        <CardBody className="gap-3">
                            {getConfirmationBlockers(item).length ? (
                                <BlockerList blockers={getConfirmationBlockers(item)} />
                            ) : null}
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-default-900">{item.title}</h3>
                                    <p className="mt-2 text-small text-default-700">{item.description}</p>
                                    {item.session?.targetApp ? (
                                        <p className="mt-2 text-tiny text-default-500">
                                            来源：{item.session.targetApp}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        color="primary"
                                        isDisabled={item.status !== "pending" || isConfirmationBlocked(item)}
                                        isLoading={busyId === item.id}
                                        onPress={() => decide(item, true)}
                                    >
                                        确认执行
                                    </Button>
                                    <Button
                                        color="danger"
                                        variant="flat"
                                        isDisabled={item.status !== "pending"}
                                        isLoading={busyId === item.id}
                                        onPress={() => decide(item, false)}
                                    >
                                        拒绝
                                    </Button>
                                </div>
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>
        </AgentShell>
    );
}

export function SessionsPage({ mode = "sessions" }: { mode?: "sessions" | "records" | "artifacts" }) {
    const [items, setItems] = React.useState<AgentSession[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [continueText, setContinueText] = React.useState("");
    const [busyId, setBusyId] = React.useState("");
    const [exportingId, setExportingId] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState<"all" | AgentSession["status"]>("all");
    const [sourceFilter, setSourceFilter] = React.useState<"all" | AgentSession["source"]>("all");
    const [keyword, setKeyword] = React.useState("");

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            setItems(await localEngineApi.agentSessions({
                limit: 80,
                status: statusFilter === "all" ? undefined : statusFilter,
                source: sourceFilter === "all" ? undefined : sourceFilter,
                keyword: keyword || undefined,
            }));
        } catch (error: unknown) {
            addToast({
                title: "任务读取失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, [keyword, sourceFilter, statusFilter]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const continueSession = async (session: AgentSession) => {
        if (session.blockers?.length) {
            addToast({
                title: "继续执行已阻断",
                description: session.blockers[0].nextAction,
                color: "warning",
            });
            return;
        }
        setBusyId(session.id);
        try {
            await localEngineApi.continueAgentSession(session.id, {
                instruction: continueText || "继续执行当前任务",
                operator: "当前用户",
            });
            setContinueText("");
            await refresh();
        } catch (error: unknown) {
            addToast({
                title: "继续失败",
                description: formatFailureContext({
                    platform: session.targetApp || confirmationSourceLabel[session.source],
                    account: confirmationSourceLabel[session.source],
                    target: session.title,
                    stage: "继续执行",
                    reason: error instanceof Error ? error.message : "请稍后重试",
                    nextAction: "确认没有待处理阻断项；必要时先停止后重试。",
                }),
                color: "danger",
            });
        } finally {
            setBusyId("");
        }
    };

    const stopSession = async (session: AgentSession) => {
        setBusyId(session.id);
        try {
            await localEngineApi.stopAgentSession(session.id);
            await refresh();
        } catch (error: unknown) {
            addToast({
                title: "停止失败",
                description: formatFailureContext({
                    platform: session.targetApp || confirmationSourceLabel[session.source],
                    account: confirmationSourceLabel[session.source],
                    target: session.title,
                    stage: "停止执行",
                    reason: error instanceof Error ? error.message : "请稍后重试",
                    nextAction: "刷新会话状态，确认会话仍在执行后重试。",
                }),
                color: "danger",
            });
        } finally {
            setBusyId("");
        }
    };

    const exportEvidence = async (session: AgentSession) => {
        setExportingId(session.id);
        try {
            const result = await localEngineApi.exportAgentSessionEvidence(session.id);
            downloadTextFile(result.filename, result.content, result.mimeType);
            addToast({
                title: "证据已导出",
                description: `${result.evidenceCount} 条证据`,
                color: "success",
            });
        } catch (error: unknown) {
            addToast({
                title: "证据导出失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setExportingId("");
        }
    };

    const meta = {
        sessions: {
            title: "任务",
            description: "查看正在执行、暂停确认、已完成的 Agent 会话；可以补充指令、继续执行或停止。",
            icon: "solar:dialog-2-linear",
        },
        records: {
            title: "执行记录",
            description: "跨发布、互动、浏览器、桌面任务的执行台账，重点看成功、失败、暂停和下一步。",
            icon: "solar:clipboard-list-linear",
        },
        artifacts: {
            title: "操作证据",
            description: "集中查看执行过程中沉淀的截图、页面快照、日志、诊断摘要和文件证据。",
            icon: "solar:gallery-check-linear",
        },
    }[mode];

    const pendingCount = items.filter((session) => session.status === "waiting_for_confirmation").length;
    const runningCount = items.filter((session) => session.status === "running").length;
    const evidenceCount = items.reduce((sum, session) => sum + session.events.filter((event) => event.evidence).length, 0);
    const evidenceStats = React.useMemo(() => {
        return items.reduce<Record<string, number>>((acc, session) => {
            session.events.forEach((event) => {
                if (event.evidence) acc[event.evidence.type] = (acc[event.evidence.type] || 0) + 1;
            });
            return acc;
        }, {});
    }, [items]);

    return (
        <AgentShell
            title={meta.title}
            description={meta.description}
            icon={meta.icon}
            action={
                <div className="flex flex-wrap gap-2">
                    <Button as={Link} href="/agent-console" color="primary" variant="flat">
                        新建指令
                    </Button>
                    <Button as={Link} href="/confirmations" color={pendingCount ? "warning" : "default"} variant="flat">
                        待确认 {pendingCount}
                    </Button>
                    <Button variant="flat" onPress={refresh}>刷新</Button>
                </div>
            }
        >
            <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="会话" value={items.length} />
                <MetricCard label="执行中" value={runningCount} />
                <MetricCard label="待确认" value={pendingCount} />
                <MetricCard label="证据事件" value={evidenceCount} />
            </div>
            {mode === "artifacts" ? (
                <Card className="border-small border-divider bg-background shadow-sm">
                    <CardBody>
                        <div className="grid gap-2 md:grid-cols-5">
                            <StatusPill label="浏览器截图" value={evidenceStats.screenshot || 0} />
                            <StatusPill label="页面快照" value={(evidenceStats.page_snapshot || 0) + (evidenceStats.snapshot || 0)} />
                            <StatusPill label="桌面截图" value={evidenceStats.desktop_screenshot || 0} />
                            <StatusPill label="阶段日志" value={evidenceStats.stage_log || 0} />
                            <StatusPill label="失败原因" value={evidenceStats.failure_reason || 0} />
                        </div>
                    </CardBody>
                </Card>
            ) : null}
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <div className="grid gap-3 md:grid-cols-[180px_180px_1fr_auto] md:items-end">
                        <Select
                            label="状态"
                            selectedKeys={[statusFilter]}
                            size="sm"
                            onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as typeof statusFilter)}
                        >
                            {agentStatusFilterOptions.map((option) => (
                                <SelectItem key={option.key}>{option.label}</SelectItem>
                            ))}
                        </Select>
                        <Select
                            label="来源"
                            selectedKeys={[sourceFilter]}
                            size="sm"
                            onSelectionChange={(keys) => setSourceFilter(Array.from(keys)[0] as typeof sourceFilter)}
                        >
                            {agentSourceFilterOptions.map((option) => (
                                <SelectItem key={option.key}>{option.label}</SelectItem>
                            ))}
                        </Select>
                        <Input
                            label="搜索"
                            placeholder="按指令、标题或目标应用搜索"
                            size="sm"
                            value={keyword}
                            onValueChange={setKeyword}
                        />
                        <Button color="primary" isLoading={loading} size="sm" onPress={refresh}>
                            应用筛选
                        </Button>
                    </div>
                </CardBody>
            </Card>
            {mode === "artifacts" && !loading ? (
                <ArtifactsTable items={items} onExport={exportEvidence} exportingId={exportingId} />
            ) : null}
            {loading ? <LoadingBlock /> : null}
            {!loading && items.length === 0 ? <EmptyBlock text="还没有任务。先到 智能任务创建一个。" /> : null}
            <div className="grid gap-4">
                {items.map((session) => (
                    <Card key={session.id} className="border-small border-divider bg-background shadow-sm">
                        <CardBody className="gap-4">
                            <SessionHeader session={session} />
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    size="sm"
                                    variant="flat"
                                    isLoading={exportingId === session.id}
                                    startContent={exportingId === session.id ? null : <Icon icon="solar:download-minimalistic-linear" />}
                                    onPress={() => exportEvidence(session)}
                                >
                                    导出证据
                                </Button>
                                <Button as={Link} href="/confirmations" size="sm" variant="flat">
                                    待我确认
                                </Button>
                                <Button as={Link} href={confirmationSourceHref[session.source]} size="sm" variant="flat">
                                    回来源
                                </Button>
                            </div>
                            {session.resumeAction ? (
                                <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                                    <div className="flex items-center gap-2 font-semibold">
                                        <Icon icon="solar:play-circle-linear" />
                                        <span>确认后续跑动作：{session.resumeAction.label}</span>
                                    </div>
                                    <p className="mt-1">
                                        类型：{session.resumeAction.kind === "auto-upload-publish" ? "本地发布服务真实发布" : session.resumeAction.kind}
                                        ；任务数：{session.resumeAction.payloads.length}
                                    </p>
                                </div>
                            ) : null}
                            {mode === "sessions" ? (
                                <div className="flex flex-col gap-3 md:flex-row">
                                    <Input
                                        className="flex-1"
                                        placeholder="补充指令，例如：只生成草稿，不要发送"
                                        value={continueText}
                                        onValueChange={setContinueText}
                                    />
                                    <Button
                                        color="primary"
                                        isDisabled={session.status === "completed" || session.status === "cancelled" || Boolean(session.blockers?.length)}
                                        isLoading={busyId === session.id}
                                        onPress={() => continueSession(session)}
                                    >
                                        继续执行
                                    </Button>
                                    <Button
                                        color="danger"
                                        variant="flat"
                                        isDisabled={session.status === "completed" || session.status === "cancelled"}
                                        onPress={() => stopSession(session)}
                                    >
                                        停止
                                    </Button>
                                </div>
                            ) : null}
                            <EventTimeline session={session} artifactsOnly={mode === "artifacts"} />
                            <AgentSStatusPanel
                                sidecar={{ status: "ready", label: "任务引擎" }}
                                session={{
                                    status: session.status === "waiting_for_confirmation" ? "waiting_approval" : session.status === "draft" ? "idle" : session.status as "running" | "completed" | "failed" | "cancelled",
                                    label: session.title || "任务",
                                    sessionId: session.id,
                                }}
                                events={session.events.map((event): AgentSTimelineEvent => ({
                                    id: event.id,
                                    title: event.title || "事件",
                                    detail: event.message || undefined,
                                    timestampLabel: event.createdAt ? new Date(event.createdAt).toLocaleString() : undefined,
                                    status: event.level === "success" ? "completed" : event.level === "error" ? "failed" : event.level === "warning" ? "blocked" : "completed",
                                }))}
                                timelineTitle={session.title || "任务时间线"}
                            />
                        </CardBody>
                    </Card>
                ))}
            </div>
        </AgentShell>
    );
}

export function SimpleFeaturePage({
    title,
    description,
    icon,
    items,
    capabilityKey,
    localEngineTab = "engine",
    primaryAction,
    secondaryActions,
    children,
}: {
    title: string;
    description: string;
    icon: string;
    items: string[];
    capabilityKey?: LocalEngineCapability["key"];
    localEngineTab?: "engine" | "browser" | "desktop" | "files" | "permissions" | "tasks" | "remote" | "evidence" | "logs";
    primaryAction?: {
        label: string;
        href: string;
        icon?: string;
    };
    secondaryActions?: Array<{
        label: string;
        href: string;
        icon?: string;
    }>;
    children?: React.ReactNode;
}) {
    const actions = secondaryActions || [
        { label: "智能任务", href: "/agent-console", icon: "solar:magic-stick-3-linear" },
        { label: "待我确认", href: "/confirmations", icon: "solar:check-square-linear" },
        { label: "执行记录", href: "/execution-records", icon: "solar:clipboard-list-linear" },
    ];

    return (
        <AgentShell
            title={title}
            description={description}
            icon={icon}
            action={
                <div className="flex flex-wrap gap-2">
                    <Button
                        as={Link}
                        href={primaryAction?.href || "/agent-console"}
                        color="primary"
                        startContent={<Icon icon={primaryAction?.icon || "solar:play-circle-linear"} />}
                        variant="flat"
                    >
                        {primaryAction?.label || "创建任务"}
                    </Button>
                    <Button as={Link} href="/confirmations" color="warning" variant="flat">
                        待确认
                    </Button>
                </div>
            }
        >
            <CapabilityOperationsPanel
                capabilityKey={capabilityKey}
                localEngineTab={localEngineTab}
                title={title}
            />
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <div className="grid gap-3 md:grid-cols-3">
                        {actions.map((action) => (
                            <Button
                                key={action.href}
                                as={Link}
                                href={action.href}
                                startContent={action.icon ? <Icon icon={action.icon} /> : null}
                                variant="flat"
                            >
                                {action.label}
                            </Button>
                        ))}
                    </div>
                </CardBody>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
                {items.map((item) => (
                    <Card key={item} className="border-small border-divider bg-background shadow-sm">
                        <CardBody className="flex-row items-start gap-3">
                            <Icon className="mt-0.5 text-primary" icon="solar:check-circle-linear" width={20} />
                            <p className="text-small text-default-600">{item}</p>
                        </CardBody>
                    </Card>
                ))}
            </div>
            {children}
        </AgentShell>
    );
}

function CapabilityOperationsPanel({
    capabilityKey,
    localEngineTab,
    title,
}: {
    capabilityKey?: LocalEngineCapability["key"];
    localEngineTab: string;
    title: string;
}) {
    const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
    const [browserStatus, setBrowserStatus] = React.useState<LocalEngineBrowserStatus | null>(null);
    const [executorsStatus, setExecutorsStatus] = React.useState<LocalEngineExecutorsStatus | null>(null);
    const [readiness, setReadiness] = React.useState<LocalEngineReadiness | null>(null);
    const [sessions, setSessions] = React.useState<AgentSession[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [busyAction, setBusyAction] = React.useState<"retry" | "stop" | "export" | "refresh" | null>(null);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const [nextHealth, nextBrowserStatus, nextExecutorsStatus, nextReadiness, nextSessions] = await Promise.all([
                localEngineApi.health().catch(() => null),
                localEngineApi.browserStatus().catch(() => null),
                localEngineApi.executorsStatus().catch(() => null),
                localEngineApi.readiness().catch(() => null),
                localEngineApi.agentSessions(40).catch(() => [] as AgentSession[]),
            ]);
            setHealth(nextHealth);
            setBrowserStatus(nextBrowserStatus);
            setExecutorsStatus(nextExecutorsStatus);
            setReadiness(nextReadiness);
            setSessions(nextSessions);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const capability = React.useMemo(() => {
        if (!capabilityKey) return null;
        return health?.capabilities.find((item) => item.key === capabilityKey) || null;
    }, [capabilityKey, health]);

    const failedSession = sessions.find((session) => session.status === "failed");
    const runningSession = sessions.find((session) => session.status === "running" || session.status === "waiting_for_confirmation");
    const evidenceSession = sessions.find((session) => session.events.some((event) => event.evidence));
    const pendingCount = sessions.filter((session) => session.status === "waiting_for_confirmation").length;
    const runningCount = sessions.filter((session) => session.status === "running").length;
    const failedCount = sessions.filter((session) => session.status === "failed").length;
    const evidenceCount = sessions.reduce((sum, session) => sum + session.events.filter((event) => event.evidence).length, 0);
    const readyExecutorCount = executorsStatus?.summary.ready ?? 0;
    const readyAccountCount = browserStatus?.readyAccounts ?? readiness?.summary.readyAccounts ?? 0;

    const blockers = React.useMemo(() => {
        const items: LocalEngineActionBlocker[] = [];
        if (!health?.online) {
            items.push({
                platform: title,
                account: "自动化服务",
                target: "能力入口",
                stage: "执行前检查",
                reason: "本地引擎离线或状态未读取，不能启动真实动作。",
                nextAction: "请先进入系统状态启动或刷新引擎，再重试操作。",
                capability: "local-engine",
            });
        }
        if (browserStatus && browserStatus.totalAccounts === 0) {
            items.push({
                platform: title,
                account: "平台账号",
                target: "浏览器/互动任务",
                stage: "账号检查",
                reason: "没有可用平台账号，不能执行需要账号后台的动作。",
                nextAction: "到浏览器控制或平台账号页补齐登录态，再创建任务。",
                capability: "browser-control",
            });
        } else if (browserStatus && browserStatus.readyAccounts === 0 && browserStatus.expiredAccounts > 0) {
            items.push({
                platform: title,
                account: "平台账号",
                target: "浏览器/互动任务",
                stage: "账号检查",
                reason: "平台账号登录态已失效。",
                nextAction: "重新登录或切换到可用账号后再重试。",
                capability: "browser-control",
            });
        }
        if (executorsStatus && executorsStatus.summary.ready === 0) {
            items.push({
                platform: title,
                account: "互动服务",
                target: "真实执行",
                stage: "服务检查",
                reason: "当前没有就绪的服务，真实发送/发布/桌面动作会被阻断。",
                nextAction: "启动本机服务或改为草稿模式。",
                capability: "executor",
            });
        }
        if (readiness?.blockers?.length) {
            readiness.blockers.slice(0, 2).forEach((item) => {
                items.push({
                    platform: title,
                    account: "当前账号",
                    target: item.capability,
                    stage: "权限检查",
                    reason: item.message,
                    nextAction: item.nextAction || "处理阻断项后重新检查。",
                    capability: "permission-check",
                });
            });
        }
        if (capability && capability.status === "missing") {
            items.push({
                platform: title,
                account: "能力模块",
                target: capability.name,
                stage: "能力检查",
                reason: capability.summary,
                nextAction: capability.nextAction || "补齐该能力后再执行。",
                capability: capability.key,
            });
        }
        return items;
    }, [browserStatus, capability, executorsStatus, health, readiness, title]);

    const isBlocked = blockers.length > 0;
    const retryDisabled = isBlocked || !failedSession;
    const stopDisabled = !runningSession;
    const exportDisabled = !evidenceSession;

    const runRetry = async () => {
        if (!failedSession) return;
        if (isBlocked) {
            addToast({ title: "需要处理", description: blockers[0].nextAction, color: "warning" });
            return;
        }
        setBusyAction("retry");
        try {
            await localEngineApi.continueAgentSession(failedSession.id, {
                operator: "当前用户",
                instruction: "修复失败原因后重试当前会话。",
            });
            addToast({ title: "已提交重试", description: failedSession.title, color: "success" });
            await refresh();
        } catch (error: unknown) {
            addToast({
                title: "重试失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBusyAction(null);
        }
    };

    const runStop = async () => {
        if (!runningSession) return;
        setBusyAction("stop");
        try {
            await localEngineApi.stopAgentSession(runningSession.id);
            addToast({ title: "已停止执行", description: runningSession.title, color: "warning" });
            await refresh();
        } catch (error: unknown) {
            addToast({
                title: "停止失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBusyAction(null);
        }
    };

    const runExport = async () => {
        if (!evidenceSession) return;
        setBusyAction("export");
        try {
            const result = await localEngineApi.exportAgentSessionEvidence(evidenceSession.id);
            downloadTextFile(result.filename, result.content, result.mimeType);
            addToast({ title: "证据已导出", description: `${result.evidenceCount} 条证据`, color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "导出失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-medium font-semibold text-default-900">可操作闭环</h3>
                            <Chip color={isBlocked ? "danger" : "success"} size="sm" variant="flat">
                                {isBlocked ? "需要处理" : "就绪"}
                            </Chip>
                            {capability ? (
                                <Chip color={capability.status === "ready" ? "success" : capability.status === "warning" ? "warning" : "danger"} size="sm" variant="flat">
                                    {capability.name}
                                </Chip>
                            ) : null}
                        </div>
                        <p className="mt-1 text-small text-default-500">
                            这里直接处理失败修复、重试、停止、证据导出，并跳到确认队列或执行记录。
                        </p>
                    </div>
                    <Button
                        isLoading={loading || busyAction === "refresh"}
                        size="sm"
                        startContent={loading || busyAction === "refresh" ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            setBusyAction("refresh");
                            refresh().finally(() => setBusyAction(null));
                        }}
                    >
                        刷新状态
                    </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-6">
                    <StatusPill label="引擎" value={loading ? "检查中" : health?.online ? "在线" : "离线"} />
                    <StatusPill label="账号 ready" value={readyAccountCount} />
                    <StatusPill label="服务就绪" value={readyExecutorCount} />
                    <StatusPill label="运行中" value={runningCount} />
                    <StatusPill label="失败" value={failedCount} />
                    <StatusPill label="证据" value={evidenceCount} />
                </div>

                {blockers.length ? <BlockerList blockers={blockers} /> : null}

                <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                    <Button
                        as={Link}
                        href={`/local-engine?tab=${localEngineTab}`}
                        startContent={<Icon icon="solar:wrench-linear" />}
                        variant="flat"
                    >
                        失败修复
                    </Button>
                    <Button
                        color="primary"
                        isDisabled={retryDisabled}
                        isLoading={busyAction === "retry"}
                        startContent={busyAction === "retry" ? null : <Icon icon="solar:restart-linear" />}
                        variant="flat"
                        onPress={runRetry}
                    >
                        重试失败
                    </Button>
                    <Button
                        color="danger"
                        isDisabled={stopDisabled}
                        isLoading={busyAction === "stop"}
                        startContent={busyAction === "stop" ? null : <Icon icon="solar:stop-circle-linear" />}
                        variant="flat"
                        onPress={runStop}
                    >
                        停止
                    </Button>
                    <Button
                        isDisabled={exportDisabled}
                        isLoading={busyAction === "export"}
                        startContent={busyAction === "export" ? null : <Icon icon="solar:download-minimalistic-linear" />}
                        variant="flat"
                        onPress={runExport}
                    >
                        导出证据
                    </Button>
                    <Button as={Link} color={pendingCount ? "warning" : "default"} href="/confirmations" variant="flat">
                        待确认 {pendingCount}
                    </Button>
                    <Button as={Link} href="/execution-records" variant="flat">
                        执行记录
                    </Button>
                </div>

                <div className="grid gap-2 text-tiny text-default-500 md:grid-cols-3">
                    <p>{failedSession ? `可重试：${failedSession.title}` : "重试：没有失败会话，按钮禁用。"}</p>
                    <p>{runningSession ? `可停止：${runningSession.title}` : "停止：没有运行/待确认会话，按钮禁用。"}</p>
                    <p>{evidenceSession ? `可导出：${evidenceSession.title}` : "导出：没有证据会话，按钮禁用。"}</p>
                </div>
            </CardBody>
        </Card>
    );
}

function AgentShell({
    title,
    description,
    icon,
    action,
    children,
}: {
    title: string;
    description: string;
    icon: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <header className="flex flex-col gap-4 rounded-[10px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                        <Icon icon={icon} width={26} />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">{title}</h2>
                        <p className="mt-1 text-small text-default-500">{description}</p>
                    </div>
                </div>
                {action}
            </header>
            {children}
        </div>
    );
}

function SessionCard({ session, emptyText }: { session: AgentSession | null; emptyText: string }) {
    if (!session) {
        return <EmptyBlock text={emptyText} />;
    }
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <SessionHeader session={session} />
                <EventTimeline session={session} />
                <div className="flex gap-2">
                    <Button as={Link} href="/sessions" color="primary" variant="flat">
                        查看任务
                    </Button>
                    <Button as={Link} href="/confirmations" variant="flat">
                        去待我确认
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function SessionHeader({ session }: { session: AgentSession }) {
    const failureContext = deriveSessionFailureContext(session);
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-default-900">{session.title}</h3>
                    <Chip color={statusColor[session.status]} size="sm" variant="flat">{session.statusLabel}</Chip>
                    <Chip size="sm" variant="flat">{session.executionScope}</Chip>
                    <Chip color={session.riskLevel === "high" ? "danger" : session.riskLevel === "medium" ? "warning" : "success"} size="sm" variant="flat">
                        {session.riskLevel === "high" ? "高风险" : session.riskLevel === "medium" ? "中风险" : "低风险"}
                    </Chip>
                </div>
                <p className="mt-1 text-small text-default-500">{session.instruction}</p>
                {session.nextAction ? <p className="mt-2 text-small text-default-600">下一步：{session.nextAction}</p> : null}
                {session.blockers?.length ? <BlockerList blockers={session.blockers} /> : null}
                {failureContext ? <FailureContextPanel context={failureContext} /> : null}
            </div>
            <span className="text-tiny text-default-400">{new Date(session.updatedAt).toLocaleString()}</span>
        </div>
    );
}

function ArtifactsTable({
    items,
    onExport,
    exportingId,
}: {
    items: AgentSession[];
    onExport: (session: AgentSession) => void;
    exportingId: string;
}) {
    const rows = items
        .flatMap((session) =>
            session.events
                .filter((event) => event.evidence)
                .map((event) => ({
                    session,
                    event,
                    evidence: event.evidence!,
                })),
        )
        .slice(0, 80);

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">操作证据索引</h3>
                        <p className="mt-1 text-small text-default-500">
                            从任务事件中抽取截图、页面快照、桌面截图、阶段日志、失败原因和诊断包，可回来源或导出单个会话证据包。
                        </p>
                    </div>
                    <Button as={Link} href="/local-engine?tab=evidence" variant="flat">
                        本机证据治理
                    </Button>
                </div>
                <Table
                    aria-label="Agent 操作证据"
                    classNames={{
                        wrapper: "border-small border-divider shadow-none",
                        th: "bg-default-50 text-default-500",
                    }}
                >
                    <TableHeader>
                        <TableColumn>类型</TableColumn>
                        <TableColumn>证据</TableColumn>
                        <TableColumn>会话</TableColumn>
                        <TableColumn>时间</TableColumn>
                        <TableColumn>操作</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent="暂无操作证据。" items={rows}>
                        {(row) => (
                            <TableRow key={`${row.session.id}-${row.event.id}`}>
                                <TableCell>
                                    <div className="flex flex-wrap gap-2">
                                        <Chip size="sm" variant="flat">{evidenceTypeName[row.evidence.type] || row.evidence.type}</Chip>
                                        {row.evidence.stageKey ? <Chip size="sm" variant="flat">{row.evidence.stageKey}</Chip> : null}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="max-w-[320px] space-y-1">
                                        <p className="text-small font-medium text-default-800">{row.evidence.label}</p>
                                        <p className="truncate text-tiny text-default-500">{row.evidence.value}</p>
                                        {row.evidence.artifactUrl ? (
                                            <Link className="text-tiny text-primary" href={row.evidence.artifactUrl}>
                                                打开产物
                                            </Link>
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="max-w-[240px] space-y-1">
                                        <p className="truncate text-small text-default-800">{row.session.title}</p>
                                        <p className="text-tiny text-default-400">{confirmationSourceLabel[row.session.source]}</p>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className="text-tiny text-default-500">{new Date(row.event.createdAt).toLocaleString()}</span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-2">
                                        <Button as={Link} href={confirmationSourceHref[row.session.source]} size="sm" variant="flat">
                                            来源
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="flat"
                                            isLoading={exportingId === row.session.id}
                                            onPress={() => onExport(row.session)}
                                        >
                                            导出
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardBody>
        </Card>
    );
}

function EventTimeline({ session, artifactsOnly = false }: { session: AgentSession; artifactsOnly?: boolean }) {
    const events = artifactsOnly ? session.events.filter((event) => event.evidence) : session.events;
    if (events.length === 0) {
        return <EmptyBlock text="暂无事件。" />;
    }
    return (
        <div className="flex flex-col gap-3">
            {events.map((event) => (
                <div key={event.id} className="rounded-[10px] border-small border-divider p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <Icon icon={event.level === "success" ? "solar:check-circle-linear" : event.level === "warning" ? "solar:danger-triangle-linear" : event.level === "error" ? "solar:close-circle-linear" : "solar:info-circle-linear"} />
                            <span className="font-medium text-default-800">{event.title}</span>
                        </div>
                        <span className="text-tiny text-default-400">{new Date(event.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-1 text-small text-default-500">{event.message}</p>
                    {event.evidence ? (
                        <div className="mt-2 rounded-small bg-default-100 p-2 text-small text-default-600">
                            <div className="flex flex-wrap items-center gap-2">
                                <Chip size="sm" variant="flat">{evidenceTypeName[event.evidence.type] || event.evidence.type}</Chip>
                                {event.evidence.stageKey ? <Chip size="sm" variant="flat">{event.evidence.stageKey}</Chip> : null}
                                <span className="font-medium">{event.evidence.label}</span>
                            </div>
                            <p className="mt-1 break-words">{event.evidence.value}</p>
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: number }) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody>
                <p className="text-tiny text-default-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-default-900">{value}</p>
            </CardBody>
        </Card>
    );
}

function StatusPill({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="rounded-[10px] border-small border-divider bg-default-50 px-3 py-2">
            <p className="text-tiny text-default-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-default-900">{value}</p>
        </div>
    );
}

function getConfirmationBlockers(item: AgentConfirmation): LocalEngineActionBlocker[] {
    const blockers: LocalEngineActionBlocker[] = [];
    if (item.blockedReason || item.trialLimited || item.safetyBoundary?.permissionStatus === "blocked" || item.safetyBoundary?.permissionStatus === "trial_limited") {
        blockers.push({
            platform: item.session?.targetApp || confirmationSourceLabel[item.session?.source || "system"],
            account: item.operator || "当前用户",
            target: item.riskPolicy?.targetName || item.title,
            stage: "人工确认",
            reason: item.blockedReason || item.safetyBoundary?.message || "当前账号或版本没有执行该真实动作的权限。",
            nextAction: item.safetyBoundary?.permissionStatus === "trial_limited"
                ? "切换到已授权商用账号或改为只生成草稿/预检。"
                : "补齐商用执行权限、白名单或审批角色后再确认。",
            capability: "permission-check",
        });
    }
    if ((item.riskPolicy?.forbiddenActionHits || []).length) {
        blockers.push({
            platform: item.session?.targetApp || confirmationSourceLabel[item.session?.source || "system"],
            account: item.operator || "当前用户",
            target: item.riskPolicy?.targetName || item.title,
            stage: "风控策略",
            reason: `命中禁止动作：${item.riskPolicy?.forbiddenActionHits.join("、")}`,
            nextAction: "调整任务内容，移除禁止动作后重新发起或让管理员更新策略。",
            capability: "risk-policy",
        });
    }
    return blockers;
}

function isConfirmationBlocked(item: AgentConfirmation) {
    return getConfirmationBlockers(item).length > 0;
}

function BlockerList({ blockers }: { blockers: LocalEngineActionBlocker[] }) {
    if (!blockers.length) return null;
    return (
        <div className="mt-3 grid gap-2">
            {blockers.map((blocker, index) => (
                <div key={`${blocker.stage}-${index}`} className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                        <Icon icon="solar:shield-warning-linear" />
                        <span>已阻断：{blocker.stage}</span>
                        {blocker.capability ? <Chip color="danger" size="sm" variant="flat">{blocker.capability}</Chip> : null}
                    </div>
                    <p className="mt-2">
                        {[
                            blocker.platform ? `平台：${blocker.platform}` : null,
                            blocker.account ? `账号：${blocker.account}` : null,
                            blocker.target ? `对象：${blocker.target}` : null,
                            `原因：${blocker.reason}`,
                        ].filter(Boolean).join("；")}
                    </p>
                    <p className="mt-1 text-tiny">下一步：{blocker.nextAction}</p>
                </div>
            ))}
        </div>
    );
}

function FailureContextPanel({ context }: { context: LocalEngineFailureContext }) {
    return (
        <div className="mt-3 rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
            <div className="flex items-center gap-2 font-semibold">
                <Icon icon="solar:close-circle-linear" />
                <span>失败诊断</span>
            </div>
            <p className="mt-2">{formatFailureContext(context)}</p>
        </div>
    );
}

function EmptyBlock({ text }: { text: string }) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="items-center justify-center py-12 text-small text-default-500">{text}</CardBody>
        </Card>
    );
}

function LoadingBlock() {
    return (
        <div className="flex justify-center py-16">
            <Spinner size="sm" />
        </div>
    );
}
