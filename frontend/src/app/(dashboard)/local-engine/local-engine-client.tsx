"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
    Progress,
    Select,
    SelectItem,
    Spinner,
    Switch,
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
    type CreateInteractionTaskInput,
    type InteractionBusinessRouteKey,
    type InteractionEvidenceCleanupResult,
    type InteractionRecordsSummary,
    type InteractionRouteKey,
    type InteractionReplyRuleConfig,
    type InteractionSendMode,
    type InteractionTask,
    type InteractionTaskType,
    type LocalEngineBrowserStatus,
    type LocalEngineCapability,
    type LocalEngineActionBlocker,
    type LocalEngineFailureContext,
    type LocalEngineWechatSessionStatus,
    type LocalEngineExecutorsStatus,
    type LocalEngineFileAccessStatus,
    type LocalEngineHealth,
    type LocalEngineReadiness,
    type LocalEngineRuntimeAction,
    type LocalEngineRuntimeLog,
    type LocalEngineRuntimeServiceKey,
    type LocalEngineRuntimeStatus,
} from "@/lib/api/local-engine";
import { AgentSStatusPanel, type AgentSSidecarSummary, type AgentSSessionSummary, type AgentSTimelineEvent, type AgentSApprovalRequest } from "@/components/agent-s-status-panel";
import { OpsWorkbenchView } from "@/components/ops-workbench/ops-workbench-view";

type LocalEngineTabKey =
    | "engine"
    | "workbench"
    | "browser"
    | "desktop"
    | "files"
    | "permissions"
    | "tasks"
    | "remote"
    | "evidence"
    | "logs";

type ActiveInteractionBusinessRouteKey = Exclude<InteractionBusinessRouteKey, "moments" | "wechat" | "groups">;
type ActiveInteractionRouteKey = Exclude<InteractionRouteKey, "moments" | "wechat" | "groups">;

const tabKeys: LocalEngineTabKey[] = [
    "engine",
    "workbench",
    "browser",
    "desktop",
    "files",
    "permissions",
    "tasks",
    "remote",
    "evidence",
    "logs",
];

const legacyInteractionRoutes: Partial<Record<string, string>> = {
    comments: "/workbench/douyin-comments",
    messages: "/workbench/douyin-messages",
    "channel-comments": "/workbench/channel-comments",
    "channel-messages": "/workbench/channel-messages",
    wechat: "/workbench",
    groups: "/workbench",
    moments: "/workbench",
    customers: "/interaction/customers",
    rules: "/interaction/rules",
    records: "/interaction/records",
};

const pageMeta: Record<
    LocalEngineTabKey,
    {
        title: string;
        description: string;
        icon: string;
    }
> = {
    engine: {
        title: "运行检查",
        description: "查看本机助手、客户互动任务和需要处理的问题。",
        icon: "solar:server-square-cloud-linear",
    },
    workbench: {
        title: "客户互动",
        description: "集中处理抖音评论、私信、视频号评论和视频号私信；微信会话和群发放到二阶段。",
        icon: "solar:widget-linear",
    },
    browser: {
        title: "平台账号检查",
        description: "检查抖音、小红书、视频号等后台是否能正常打开和处理。",
        icon: "solar:window-frame-linear",
    },
    desktop: {
        title: "微信桌面检查",
        description: "检查桌面微信、辅助功能、屏幕录制和人工接管是否可用。",
        icon: "solar:monitor-linear",
    },
    files: {
        title: "文件与凭证",
        description: "检查素材、截图、诊断包和结果凭证是否能正常保存。",
        icon: "solar:folder-with-files-linear",
    },
    permissions: {
        title: "安全检查",
        description: "汇总账号、本机权限和高风险动作确认。",
        icon: "solar:shield-check-linear",
    },
    tasks: {
        title: "互动记录",
        description: "查看正在处理、等待确认和失败的客户互动任务。",
        icon: "solar:chat-square-check-linear",
    },
    remote: {
        title: "远程接管",
        description: "查看远程检查、权限边界和人工确认状态。",
        icon: "solar:cloud-line-duotone",
    },
    evidence: {
        title: "操作凭证",
        description: "按任务查看截图、页面快照、文本凭证和诊断包。",
        icon: "solar:video-library-linear",
    },
    logs: {
        title: "诊断日志",
        description: "遇到启动失败、任务失败时查看最近日志和诊断信息。",
        icon: "solar:document-text-linear",
    },
};

const interactionPageMeta: Record<
    ActiveInteractionRouteKey,
    {
        title: string;
        description: string;
        icon: string;
    }
> = {
    comments: {
        title: "评论回复",
        description: "处理平台评论回复任务，默认先进入本机账号后台做预检。",
        icon: "solar:chat-round-like-linear",
    },
    messages: {
        title: "私信回复",
        description: "处理私信会话回复任务，默认自动发送；只有用户切到确认后发送才停下。",
        icon: "solar:inbox-line-linear",
    },
    "channel-comments": {
        title: "视频号评论",
        description: "进入视频号后台读取真实客户评论，AI 按评论内容生成回复并按发送模式执行。",
        icon: "solar:chat-round-like-linear",
    },
    "channel-messages": {
        title: "视频号私信",
        description: "进入视频号后台读取真实私信会话，AI 按对方内容生成回复并按发送模式执行。",
        icon: "solar:inbox-line-linear",
    },
    customers: {
        title: "客户跟进",
        description: "把客户线索转成微信跟进动作，默认自动发送。",
        icon: "solar:user-check-linear",
    },
    rules: {
        title: "自动回复规则",
        description: "配置传统服务业的话术边界、升级人工条件和发送防线。",
        icon: "solar:settings-minimalistic-linear",
    },
    records: {
        title: "回复记录",
        description: "查看已完成、失败和跳过的互动任务记录。",
        icon: "solar:clipboard-list-linear",
    },
};

const taskTypes: Array<{ key: InteractionTaskType; label: string; helper: string }> = [
    { key: "douyin-comment-reply", label: "抖音评论回复", helper: "从评论管理页定位留言，生成回复并按发送模式执行。" },
    { key: "douyin-direct-message-reply", label: "抖音私信回复", helper: "从私信会话读取上下文，连续处理待回复对象并按发送模式执行。" },
    { key: "wechat-channel-comment-reply", label: "视频号评论回复", helper: "从视频号评论管理页读取真实评论，AI 按客户内容回复并按发送模式执行。" },
    { key: "wechat-channel-direct-message-reply", label: "视频号私信回复", helper: "从视频号私信入口读取真实会话，AI 按对方内容回复并按发送模式执行。" },
    { key: "customer-follow-up", label: "客户跟进", helper: "把客户对象、来源内容和跟进话术转成微信跟进动作。" },
];

const interactionViews: Record<
    ActiveInteractionBusinessRouteKey,
    {
        title: string;
        subtitle: string;
        defaultType: InteractionTaskType;
        platformType: number;
        platformLabel: string;
        sourceLabel: string;
        replyLabel: string;
        defaultTarget: string;
        defaultSource: string;
        defaultReply: string;
    }
> = {
    comments: {
        title: "评论回复",
        subtitle: "选择已登录平台账号，本机会打开对应后台入口；默认自动发送，确认后发送才停下。",
        defaultType: "douyin-comment-reply",
        platformType: 3,
        platformLabel: "抖音",
        sourceLabel: "评论内容",
        replyLabel: "回复内容",
        defaultTarget: "评论用户",
        defaultSource: "想了解一下现在还能预约吗？",
        defaultReply: "您好，可以预约。您方便留下联系方式吗？我们马上帮您安排。",
    },
    messages: {
        title: "私信回复",
        subtitle: "进入账号私信入口读取真实会话；默认自动发送，确认后发送才停下。",
        defaultType: "douyin-direct-message-reply",
        platformType: 3,
        platformLabel: "抖音",
        sourceLabel: "私信内容",
        replyLabel: "私信回复",
        defaultTarget: "私信客户",
        defaultSource: "你好，想问下服务流程和价格。",
        defaultReply: "您好，我们可以先了解您的需求，再给您匹配合适方案。",
    },
    "channel-comments": {
        title: "视频号评论回复",
        subtitle: "进入视频号后台读取真实评论；默认自动发送，确认后发送才停下。",
        defaultType: "wechat-channel-comment-reply",
        platformType: 2,
        platformLabel: "视频号",
        sourceLabel: "评论内容",
        replyLabel: "回复内容",
        defaultTarget: "视频号评论用户",
        defaultSource: "等待系统读取真实视频号评论。",
        defaultReply: "",
    },
    "channel-messages": {
        title: "视频号私信回复",
        subtitle: "进入视频号私信入口读取真实会话；默认自动发送，确认后发送才停下。",
        defaultType: "wechat-channel-direct-message-reply",
        platformType: 2,
        platformLabel: "视频号",
        sourceLabel: "私信内容",
        replyLabel: "私信回复",
        defaultTarget: "视频号私信客户",
        defaultSource: "等待系统读取真实视频号私信。",
        defaultReply: "",
    },
    customers: {
        title: "客户跟进",
        subtitle: "按客户对象生成跟进话术，并默认转到桌面微信跟进发送。",
        defaultType: "customer-follow-up",
        platformType: 2,
        platformLabel: "客户",
        sourceLabel: "客户来源/待跟进事项",
        replyLabel: "跟进话术",
        defaultTarget: "重点客户",
        defaultSource: "客户咨询过价格，尚未留下电话。",
        defaultReply: "您好，想跟进一下您上次咨询的需求。您方便补充下时间和联系方式吗？我们帮您安排专人对接。",
    },
};

const sendModes: Array<{ key: InteractionSendMode; label: string }> = [
    { key: "auto-send", label: "自动发送" },
    { key: "approval-send", label: "确认后发送" },
];

const permissionStatusLabel: Record<string, string> = {
    allowed: "商用可执行",
    approval_required: "需人工确认",
    blocked: "商用未授权",
    trial_limited: "试用限制",
};

const emptyRecordsSummary: InteractionRecordsSummary = {
    total: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    noTarget: 0,
    evidenceCount: 0,
    byType: {
        "douyin-comment-reply": 0,
        "douyin-direct-message-reply": 0,
        "wechat-channel-comment-reply": 0,
        "wechat-channel-direct-message-reply": 0,
        "wechat-reply-draft": 0,
        "wechat-group-broadcast": 0,
        "wechat-moments-publish": 0,
        "customer-follow-up": 0,
    },
};

export default function LocalEnginePage() {
    return (
        <React.Suspense
            fallback={
                <div className="flex min-h-[360px] items-center justify-center">
                    <Spinner size="sm" />
                </div>
            }
        >
            <LocalEngineContent />
        </React.Suspense>
    );
}

export function InteractionRoutePage({ route }: { route: InteractionRouteKey }) {
    return (
        <React.Suspense
            fallback={
                <div className="flex min-h-[360px] items-center justify-center">
                    <Spinner size="sm" />
                </div>
            }
        >
            <InteractionRouteContent route={route} />
        </React.Suspense>
    );
}

function LocalEngineContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const requestedTab = searchParams.get("tab");
    const selectedTab = tabKeys.includes((requestedTab || "") as LocalEngineTabKey)
        ? (requestedTab as LocalEngineTabKey)
        : "engine";
    const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
    const [browserStatus, setBrowserStatus] = React.useState<LocalEngineBrowserStatus | null>(null);
    const [executorsStatus, setExecutorsStatus] = React.useState<LocalEngineExecutorsStatus | null>(null);
    const [fileStatus, setFileStatus] = React.useState<LocalEngineFileAccessStatus | null>(null);
    const [readiness, setReadiness] = React.useState<LocalEngineReadiness | null>(null);
    const [runtimeStatus, setRuntimeStatus] = React.useState<LocalEngineRuntimeStatus | null>(null);
    const [tasks, setTasks] = React.useState<InteractionTask[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [browserLoading, setBrowserLoading] = React.useState(true);
    const [executorsLoading, setExecutorsLoading] = React.useState(true);
    const [filesLoading, setFilesLoading] = React.useState(true);
    const [readinessLoading, setReadinessLoading] = React.useState(true);
    const [runtimeLoading, setRuntimeLoading] = React.useState(true);
    const [runtimeAction, setRuntimeAction] = React.useState<LocalEngineRuntimeAction | null>(null);
    const [tasksLoading, setTasksLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [agentSStatus, setAgentSStatus] = React.useState<{ phase: string; connected: boolean; lastError?: string; sidecar?: { health?: Record<string, unknown>; status?: Record<string, unknown> } } | null>(null);
    const [agentSLoading, setAgentSLoading] = React.useState(true);

    React.useEffect(() => {
        if (requestedTab && legacyInteractionRoutes[requestedTab]) {
            router.replace(legacyInteractionRoutes[requestedTab]);
        }
    }, [legacyInteractionRoutes, requestedTab, router]);

    const refreshHealth = React.useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await localEngineApi.health();
            setHealth(result);
        } catch (e: unknown) {
            setHealth(null);
            setError(e instanceof Error ? e.message : "本机助手状态读取失败");
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshTasks = React.useCallback(async () => {
        setTasksLoading(true);
        try {
            const result = await localEngineApi.tasks();
            setTasks(result);
        } catch (e: unknown) {
            addToast({
                title: "互动任务读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
            setTasks([]);
        } finally {
            setTasksLoading(false);
        }
    }, []);

    const refreshBrowserStatus = React.useCallback(async () => {
        setBrowserLoading(true);
        try {
            const result = await localEngineApi.browserStatus();
            setBrowserStatus(result);
        } catch (e: unknown) {
            setBrowserStatus(null);
            addToast({
                title: "平台账号检查失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBrowserLoading(false);
        }
    }, []);

    const refreshExecutorsStatus = React.useCallback(async () => {
        setExecutorsLoading(true);
        try {
            const result = await localEngineApi.executorsStatus();
            setExecutorsStatus(result);
        } catch (e: unknown) {
            setExecutorsStatus(null);
            addToast({
                title: "客户互动可用性读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setExecutorsLoading(false);
        }
    }, []);

    const refreshFileStatus = React.useCallback(async () => {
        setFilesLoading(true);
        try {
            const result = await localEngineApi.fileAccessStatus();
            setFileStatus(result);
        } catch (e: unknown) {
            setFileStatus(null);
            addToast({
                title: "文件访问状态读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setFilesLoading(false);
        }
    }, []);

    const refreshReadiness = React.useCallback(async () => {
        setReadinessLoading(true);
        try {
            const result = await localEngineApi.readiness();
            setReadiness(result);
        } catch (e: unknown) {
            setReadiness(null);
            addToast({
                title: "权限检查读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setReadinessLoading(false);
        }
    }, []);

    const refreshRuntimeStatus = React.useCallback(async () => {
        setRuntimeLoading(true);
        try {
            const result = await localEngineApi.runtimeStatus();
            setRuntimeStatus(result);
        } catch (e: unknown) {
            setRuntimeStatus(null);
            addToast({
                title: "运行状态读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setRuntimeLoading(false);
        }
    }, []);

    const refreshAgentSStatus = React.useCallback(async () => {
        setAgentSLoading(true);
        try {
            setAgentSStatus(await localEngineApi.agentSStatus());
        } catch {
            setAgentSStatus(null);
        } finally {
            setAgentSLoading(false);
        }
    }, []);

    const runRuntimeAction = React.useCallback(async (action: LocalEngineRuntimeAction) => {
        setRuntimeAction(action);
        try {
            const result = await localEngineApi.runRuntimeAction(action);
            addToast({
                title: action === "restart" ? "正在重启本机服务" : action === "stop" ? "正在停止本机服务" : "正在启动本机服务",
                description: result.message,
                color: action === "stop" ? "warning" : "success",
            });
            window.setTimeout(() => {
                refreshRuntimeStatus().catch(() => {
                    addToast({ title: "状态刷新失败", color: "danger" });
                });
            }, action === "stop" ? 1500 : 5000);
        } catch (e: unknown) {
            addToast({
                title: "运行检查异常",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setRuntimeAction(null);
        }
    }, [refreshRuntimeStatus]);

    React.useEffect(() => {
        refreshHealth();
        refreshTasks();
        refreshBrowserStatus();
        refreshExecutorsStatus();
        refreshFileStatus();
        refreshReadiness();
        refreshRuntimeStatus();
        refreshAgentSStatus();
    }, [refreshBrowserStatus, refreshExecutorsStatus, refreshFileStatus, refreshHealth, refreshReadiness, refreshRuntimeStatus, refreshTasks, refreshAgentSStatus]);

    React.useEffect(() => {
        const timer = window.setInterval(() => {
            refreshHealth();
            if (selectedTab === "browser" || selectedTab === "tasks") {
                refreshBrowserStatus();
                refreshExecutorsStatus();
            }
            if (selectedTab === "tasks") {
                refreshTasks();
            }
            if (selectedTab === "engine") {
                refreshRuntimeStatus();
            }
            if (selectedTab === "files") {
                refreshFileStatus();
            }
            if (selectedTab === "permissions") {
                refreshReadiness();
            }
        }, 2500);
        return () => window.clearInterval(timer);
    }, [refreshBrowserStatus, refreshExecutorsStatus, refreshFileStatus, refreshHealth, refreshReadiness, refreshRuntimeStatus, refreshTasks, selectedTab]);

    const capabilityByKey = React.useMemo(() => {
        const map = new Map<LocalEngineCapability["key"], LocalEngineCapability>();
        health?.capabilities.forEach((capability) => map.set(capability.key, capability));
        return map;
    }, [health]);
    const meta = pageMeta[selectedTab];

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <header className="flex flex-col gap-4 rounded-[10px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                        <Icon icon={meta.icon} width={26} />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">{meta.title}</h2>
                        <p className="mt-1 text-small text-default-500">
                            {meta.description}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Chip color={health?.online ? "success" : "danger"} variant="flat">
                        {loading ? "检查中" : health?.online ? "引擎在线" : "引擎离线"}
                    </Chip>
                    <Button
                        color="primary"
                        isLoading={loading || tasksLoading || browserLoading || executorsLoading || filesLoading || readinessLoading || runtimeLoading}
                        startContent={loading || tasksLoading || browserLoading || executorsLoading || filesLoading || readinessLoading || runtimeLoading ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            Promise.all([refreshHealth(), refreshTasks(), refreshBrowserStatus(), refreshExecutorsStatus(), refreshFileStatus(), refreshReadiness(), refreshRuntimeStatus()]).catch(() => {
                                addToast({ title: "刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新
                    </Button>
                </div>
            </header>

            {selectedTab === "engine" ? (
                <EngineOverview
                    error={error}
                    health={health}
                    loading={loading}
                    runtimeLoading={runtimeLoading}
                    runtimeStatus={runtimeStatus}
                    onRefreshRuntime={refreshRuntimeStatus}
                    onRunRuntimeAction={runRuntimeAction}
                    runtimeAction={runtimeAction}
                    agentSStatus={agentSStatus}
                    agentSLoading={agentSLoading}
                    onRefreshAgentS={refreshAgentSStatus}
                />
            ) : null}
            {selectedTab === "workbench" ? (
                <OpsWorkbenchView />
            ) : null}
            {selectedTab === "browser" ? (
                <div className="grid gap-4">
                    <QuickAgentTaskPanel
                        defaultInstruction="打开当前已登录的平台后台，只读检查登录态、页面可访问性和可处理对象；需要发送或发布时先进入待我确认。"
                        description="从这里直接创建浏览器任务，会进入任务并沉淀截图、页面快照和失败原因。"
                        icon="solar:window-frame-linear"
                        scope="browser"
                        targetApp="本机浏览器"
                        title="新建浏览器任务"
                    />
                    <BrowserControlPanel
                        capability={capabilityByKey.get("browser-control")}
                        executorsLoading={executorsLoading}
                        executorsStatus={executorsStatus}
                        loading={browserLoading}
                        status={browserStatus}
                        onRefreshExecutors={refreshExecutorsStatus}
                        onRefresh={refreshBrowserStatus}
                        onTaskCreated={async () => {
                            await Promise.all([
                                refreshTasks(),
                                refreshBrowserStatus(),
                                refreshExecutorsStatus(),
                            ]);
                        }}
                    />
                </div>
            ) : null}
            {selectedTab === "desktop" ? (
                <div className="grid gap-4">
                    <QuickAgentTaskPanel
                        defaultInstruction="检查桌面微信窗口和辅助功能权限；如果要填入草稿，先截图留证并进入待我确认，不要自动发送。"
                        description="从这里直接创建桌面任务，适合微信会话、当前窗口确认、草稿填入和桌面截图。"
                        icon="solar:monitor-linear"
                        scope="desktop"
                        targetApp="桌面应用"
                        title="新建桌面任务"
                    />
                    <DesktopCapabilityPanel capabilityByKey={capabilityByKey} />
                </div>
            ) : null}
            {selectedTab === "files" ? (
                <FileAccessPanel
                    capability={capabilityByKey.get("file-access")}
                    loading={filesLoading}
                    status={fileStatus}
                    onRefresh={refreshFileStatus}
                />
            ) : null}
            {selectedTab === "permissions" ? (
                <PermissionCheckPanel
                    capability={capabilityByKey.get("permission-check")}
                    loading={readinessLoading}
                    readiness={readiness}
                    onRefresh={refreshReadiness}
                />
            ) : null}
            {selectedTab === "tasks" ? (
                <TasksPanel tasks={tasks} loading={tasksLoading} onRefresh={refreshTasks} />
            ) : null}
            {selectedTab === "remote" ? (
                <QuickAgentTaskPanel
                    defaultInstruction="检查远程任务触发来源、授权用户和执行风险；不要真正运行命令，先进入待我确认。"
                    description="远程任务先创建可审计会话，确认目标主机、授权人和命令范围后再继续。"
                    icon="solar:cloud-line-duotone"
                    scope="remote"
                    targetApp="远程任务"
                    title="远程任务"
                />
            ) : null}
            {selectedTab === "evidence" ? (
                <EvidenceReplayPanel
                    tasks={tasks}
                    tasksLoading={tasksLoading}
                    onRefreshTasks={refreshTasks}
                />
            ) : null}
            {selectedTab === "logs" ? (
                <RuntimeStatusPanel
                    loading={runtimeLoading}
                    status={runtimeStatus}
                    onRefresh={refreshRuntimeStatus}
                    onRunAction={runRuntimeAction}
                    runningAction={runtimeAction}
                />
            ) : null}
        </div>
    );
}

function InteractionRouteContent({ route }: { route: InteractionRouteKey }) {
    const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
    const [browserStatus, setBrowserStatus] = React.useState<LocalEngineBrowserStatus | null>(null);
    const [executorsStatus, setExecutorsStatus] = React.useState<LocalEngineExecutorsStatus | null>(null);
    const [replyRule, setReplyRule] = React.useState<InteractionReplyRuleConfig | null>(null);
    const [tasks, setTasks] = React.useState<InteractionTask[]>([]);
    const [recordsSummary, setRecordsSummary] = React.useState<InteractionRecordsSummary>(emptyRecordsSummary);
    const [healthLoading, setHealthLoading] = React.useState(true);
    const [browserLoading, setBrowserLoading] = React.useState(true);
    const [executorsLoading, setExecutorsLoading] = React.useState(true);
    const [replyRuleLoading, setReplyRuleLoading] = React.useState(true);
    const [tasksLoading, setTasksLoading] = React.useState(true);

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

    const refreshBrowserStatus = React.useCallback(async () => {
        setBrowserLoading(true);
        try {
            setBrowserStatus(await localEngineApi.browserStatus());
        } catch (e: unknown) {
            setBrowserStatus(null);
            addToast({
                title: "账号状态读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setBrowserLoading(false);
        }
    }, []);

    const refreshExecutorsStatus = React.useCallback(async () => {
        setExecutorsLoading(true);
        try {
            setExecutorsStatus(await localEngineApi.executorsStatus());
        } catch (e: unknown) {
            setExecutorsStatus(null);
            addToast({
                title: "互动服务状态读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setExecutorsLoading(false);
        }
    }, []);

    const refreshReplyRule = React.useCallback(async () => {
        setReplyRuleLoading(true);
        try {
            setReplyRule(await localEngineApi.replyRule());
        } catch (e: unknown) {
            setReplyRule(null);
            addToast({
                title: "规则读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setReplyRuleLoading(false);
        }
    }, []);

    const isBusinessRoute = (["comments", "messages", "channel-comments", "channel-messages", "customers"] as InteractionRouteKey[]).includes(route);
    const businessRoute = isBusinessRoute ? (route as ActiveInteractionBusinessRouteKey) : null;

    const refreshTasks = React.useCallback(async () => {
        setTasksLoading(true);
        try {
            if (route === "records") {
                const result = await localEngineApi.records();
                setTasks(result.items);
                setRecordsSummary(result.summary);
            } else if (businessRoute) {
                setTasks(await localEngineApi.businessTasks(businessRoute));
            } else {
                setTasks([]);
                setRecordsSummary(emptyRecordsSummary);
            }
        } catch (e: unknown) {
            setTasks([]);
            addToast({
                title: "互动任务读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setTasksLoading(false);
        }
    }, [businessRoute, isBusinessRoute, route]);

    React.useEffect(() => {
        refreshHealth();
        if (businessRoute) {
            refreshBrowserStatus();
            refreshExecutorsStatus();
        } else {
            setBrowserLoading(false);
            setExecutorsLoading(false);
        }
        if (route === "rules") {
            refreshReplyRule();
        } else {
            setReplyRuleLoading(false);
        }
        if (route === "records" || isBusinessRoute) {
            refreshTasks();
        } else {
            setTasksLoading(false);
        }
    }, [businessRoute, isBusinessRoute, refreshBrowserStatus, refreshExecutorsStatus, refreshHealth, refreshReplyRule, refreshTasks, route]);

    React.useEffect(() => {
        const timer = window.setInterval(() => {
            refreshHealth();
            if (businessRoute) {
                refreshBrowserStatus();
                refreshExecutorsStatus();
            }
            if (route === "records" || isBusinessRoute) {
                refreshTasks();
            }
        }, 2500);
        return () => window.clearInterval(timer);
    }, [businessRoute, isBusinessRoute, refreshBrowserStatus, refreshExecutorsStatus, refreshHealth, refreshTasks, route]);

    if (route === "moments" || route === "wechat" || route === "groups") {
        return (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-[10px] border-small border-divider bg-background p-5 shadow-sm">
                <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">客户互动</h2>
                <p className="text-small text-default-500">微信会话、微信群发和朋友圈发布当前不在一期前台范围，请使用抖音和视频号互动能力。</p>
                <Button as={Link} color="primary" href="/workbench" startContent={<Icon icon="solar:widget-linear" />}>
                    返回客户互动
                </Button>
            </div>
        );
    }

    const meta = interactionPageMeta[route];
    const isLoading = healthLoading || browserLoading || executorsLoading || replyRuleLoading || tasksLoading;

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <header className="flex flex-col gap-4 rounded-[10px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                        <Icon icon={meta.icon} width={26} />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">{meta.title}</h2>
                        <p className="mt-1 text-small text-default-500">{meta.description}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Chip color={health?.online ? "success" : "danger"} variant="flat">
                        {healthLoading ? "检查中" : health?.online ? "引擎在线" : "引擎离线"}
                    </Chip>
                    <Button
                        color="primary"
                        isLoading={isLoading}
                        startContent={isLoading ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            const calls: Array<Promise<void>> = [refreshHealth()];
                            if (businessRoute) {
                                calls.push(refreshBrowserStatus());
                                calls.push(refreshExecutorsStatus());
                            }
                            if (route === "rules") {
                                calls.push(refreshReplyRule());
                            }
                            if (route === "records" || isBusinessRoute) {
                                calls.push(refreshTasks());
                            }
                            Promise.all(calls).catch(() => {
                                addToast({ title: "刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新
                    </Button>
                </div>
            </header>

            {isBusinessRoute ? (
                <InteractionCreatePanel
                    browserStatus={browserStatus}
                    executorsStatus={executorsStatus}
                    route={businessRoute!}
                    view={interactionViews[businessRoute!]}
                    onCreated={() => {
                        refreshHealth();
                        refreshTasks();
                    }}
                />
            ) : null}
            {isBusinessRoute ? (
                <TasksPanel tasks={tasks} loading={tasksLoading} onRefresh={refreshTasks} />
            ) : null}
            {route === "rules" ? (
                <RulesPanel
                    loading={replyRuleLoading}
                    rule={replyRule}
                    onSaved={(nextRule) => setReplyRule(nextRule)}
                />
            ) : null}
            {route === "records" ? (
                <RecordsPanel
                    tasks={tasks}
                    loading={tasksLoading}
                    summary={recordsSummary}
                    onRefresh={async (filters) => {
                        setTasksLoading(true);
                        try {
                            const result = await localEngineApi.records({
                                status: filters.status === "all" ? undefined : filters.status,
                                type: filters.type === "all" ? undefined : filters.type,
                            });
                            setTasks(result.items);
                            setRecordsSummary(result.summary);
                        } finally {
                            setTasksLoading(false);
                        }
                    }}
                />
            ) : null}
        </div>
    );
}

function EngineOverview({
    health,
    error,
    loading,
    runtimeLoading,
    runtimeStatus,
    onRefreshRuntime,
    onRunRuntimeAction,
    runtimeAction,
    agentSStatus,
    agentSLoading,
    onRefreshAgentS,
}: {
    health: LocalEngineHealth | null;
    error: string;
    loading: boolean;
    runtimeLoading: boolean;
    runtimeStatus: LocalEngineRuntimeStatus | null;
    onRefreshRuntime: () => Promise<void>;
    onRunRuntimeAction: (action: LocalEngineRuntimeAction) => Promise<void>;
    runtimeAction: LocalEngineRuntimeAction | null;
    agentSStatus: { phase: string; connected: boolean; lastError?: string; sidecar?: { health?: Record<string, unknown>; status?: Record<string, unknown> } } | null;
    agentSLoading: boolean;
    onRefreshAgentS: () => Promise<void>;
}) {
    if (loading && !health) {
        return <Spinner size="sm" />;
    }

    if (!health) {
        return (
            <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
                <CardBody className="text-small text-danger-700">
                    {error || "本机助手暂不可用。"}
                </CardBody>
            </Card>
        );
    }

    return (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">本机助手总览</h3>
                        <p className="mt-1 text-small text-default-500">
                            看今天能不能正常处理客户互动；需要修复的账号、权限和服务会在这里集中提示。
                        </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <StatusItem label="运行状态" value={health.online ? "可用" : "不可用"} />
                        <StatusItem label="处理模式" value="真实执行" />
                        <StatusItem label="版本" value={health.version} />
                        <StatusItem label="运行时间" value={`${health.uptimeSeconds}s`} />
                        <StatusItem label="服务入口" value={health.engineUrl} wide />
                        <StatusItem label="最近检查" value={new Date(health.checkedAt).toLocaleString()} wide />
                    </div>
                </CardBody>
            </Card>
            <RuntimeStatusPanel
                loading={runtimeLoading}
                status={runtimeStatus}
                onRefresh={onRefreshRuntime}
                onRunAction={onRunRuntimeAction}
                runningAction={runtimeAction}
            />
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <h3 className="text-medium font-semibold text-default-900">任务队列</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <QueueItem label="执行中" value={health.queue.running} />
                        <QueueItem label="待确认" value={health.queue.waitingForApproval} />
                        <QueueItem label="已完成" value={health.queue.completed} />
                        <QueueItem label="失败" value={health.queue.failed} />
                    </div>
                </CardBody>
            </Card>
            <div className="grid gap-4 lg:col-span-2 md:grid-cols-2">
                {health.capabilities.map((capability) => (
                    <CapabilitySummary key={capability.key} capability={capability} />
                ))}
            </div>
            <div className="lg:col-span-2">
                <AgentSStatusPanel
                    sidecar={{
                        status: agentSStatus?.connected ? "ready" : agentSStatus?.phase === "connecting" ? "connecting" : agentSStatus?.phase === "error" ? "error" : "disconnected",
                        label: agentSStatus?.connected ? "本机助手已连接" : "本机助手未连接",
                        detail: agentSStatus?.connected
                            ? `版本: ${String(agentSStatus.sidecar?.health?.version || "未知")} | 任务数: ${Number(agentSStatus.sidecar?.status?.session_count || 0)}`
                            : agentSStatus?.lastError || "请启动本机助手服务后刷新",
                    }}
                    session={{
                        status: "idle",
                        label: "无活跃任务",
                        detail: "从客户互动、智能任务或本机服务页面创建新任务",
                    }}
                    events={[]}
                    approvalRequest={null}
                    timelineTitle="本机助手任务记录"
                />
            </div>
        </div>
    );
}

function WechatSessionPanel() {
    const [status, setStatus] = React.useState<LocalEngineWechatSessionStatus | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState<"confirm" | "takeover" | "stop" | null>(null);
    const [draft, setDraft] = React.useState({
        targetContact: "",
        currentWindowConfirmed: false,
        contactConfirmed: false,
        draftBeforeFillConfirmed: false,
        popupCleared: false,
        contactAmbiguityResolved: false,
        loggedInConfirmed: false,
    });

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const next = await localEngineApi.wechatSessionStatus();
            setStatus(next);
            setDraft({
                targetContact: next.targetContact || next.desktop.window.targetContact || "",
                currentWindowConfirmed: next.currentWindowConfirmed,
                contactConfirmed: next.contactConfirmed,
                draftBeforeFillConfirmed: next.draftBeforeFillConfirmed,
                popupCleared: !next.anomalySummary?.popupDetected,
                contactAmbiguityResolved: !next.anomalySummary?.contactAmbiguous,
                loggedInConfirmed: !next.anomalySummary?.loggedOut,
            });
        } catch (e: unknown) {
            setStatus(null);
            addToast({
                title: "微信会话状态读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const run = async (action: "confirm" | "takeover" | "stop") => {
        setSaving(action);
        try {
            let next: LocalEngineWechatSessionStatus;
            if (action === "confirm") {
                next = await localEngineApi.confirmWechatSession({
                    ...draft,
                    currentWindowTitle: status?.desktop.window.windowTitle || status?.desktop.window.currentWindowTitle || null,
                    operator: "当前登录用户",
                    note: "微信会话执行前确认",
                });
            } else if (action === "takeover") {
                next = await localEngineApi.takeoverWechatSession({
                    operator: "当前登录用户",
                    reason: "人工接管微信会话",
                });
            } else {
                next = await localEngineApi.stopWechatSession({
                    operator: "当前登录用户",
                    reason: "用户停止微信会话",
                });
            }
            setStatus(next);
            setDraft({
                targetContact: next.targetContact || next.desktop.window.targetContact || "",
                currentWindowConfirmed: next.currentWindowConfirmed,
                contactConfirmed: next.contactConfirmed,
                draftBeforeFillConfirmed: next.draftBeforeFillConfirmed,
                popupCleared: !next.anomalySummary?.popupDetected,
                contactAmbiguityResolved: !next.anomalySummary?.contactAmbiguous,
                loggedInConfirmed: !next.anomalySummary?.loggedOut,
            });
            addToast({
                title: action === "confirm" ? "已确认微信会话" : action === "takeover" ? "已进入人工接管" : "已停止微信会话",
                color: "success",
            });
        } catch (e: unknown) {
            addToast({
                title: "微信会话操作失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setSaving(null);
        }
    };

    const desktop = status?.desktop;
    const permissionChecks = desktop?.permissionChecks ?? [];
    const recentEvidence = desktop?.recentEvidence ?? [];
    const blockers = desktop?.blockers ?? [];
    const warnings = desktop?.warnings ?? [];
    const latestEvidence = desktop?.screenshot || recentEvidence[0];
    const sessionBlockers = status?.blockers ?? [];
    const sessionWarnings = status?.warnings ?? [];
    const anomalies = status?.anomalySummary;
    const lock = status?.lock;

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">微信桌面会话</h3>
                        <p className="mt-1 text-small text-default-500">
                            执行前检查桌面权限、当前窗口、目标联系人和草稿填入前确认。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Chip color={status?.canDraft ? "success" : "warning"} variant="flat">
                            {status?.canDraft ? "可填入草稿" : "等待确认"}
                        </Chip>
                        {status?.takeoverActive ? <Chip color="primary" variant="flat">人工接管中</Chip> : null}
                        {status?.stopped ? <Chip color="danger" variant="flat">已停止</Chip> : null}
                        <Button
                            size="sm"
                            variant="flat"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            onPress={() => {
                                refresh().catch(() => undefined);
                            }}
                        >
                            刷新
                        </Button>
                    </div>
                </div>

                {desktop ? (
                    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-3">
                                <StatusItem label="桌面能力" value={desktop.available ? "可用" : "不可用"} />
                                <StatusItem label="当前应用" value={desktop.window.appName || "未知"} />
                                <StatusItem label="窗口标题" value={desktop.window.windowTitle || desktop.window.currentWindowTitle || "未识别"} />
                                <StatusItem label="窗口数量" value={String(desktop.window.windowCount ?? "-")} />
                                <StatusItem label="会话锁定" value={lock?.locked ? "已锁定" : "未锁定"} />
                                <StatusItem label="下一步" value={status?.nextAction || desktop.nextAction || "-"} />
                            </div>
                            <div className="grid gap-2 md:grid-cols-4">
                                <Chip color={anomalies?.loggedOut ? "danger" : "success"} variant="flat">
                                    {anomalies?.loggedOut ? "疑似掉线" : "登录正常"}
                                </Chip>
                                <Chip color={anomalies?.popupDetected ? "warning" : "success"} variant="flat">
                                    {anomalies?.popupDetected ? "有弹窗/遮挡" : "无弹窗阻断"}
                                </Chip>
                                <Chip color={anomalies?.contactAmbiguous ? "warning" : "success"} variant="flat">
                                    {anomalies?.contactAmbiguous ? "联系人需核对" : "联系人清晰"}
                                </Chip>
                                <Chip color={anomalies?.permissionBlocked ? "danger" : "success"} variant="flat">
                                    {anomalies?.permissionBlocked ? "权限阻断" : "权限未阻断"}
                                </Chip>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                                {permissionChecks.map((check) => (
                                    <div key={check.key} className="rounded-small border-small border-divider bg-default-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-small font-medium text-default-800">{check.label}</span>
                                            <Chip
                                                color={check.status === "allowed" ? "success" : check.status === "blocked" ? "danger" : "warning"}
                                                size="sm"
                                                variant="flat"
                                            >
                                                {permissionStatusLabel[check.status] || check.status}
                                            </Chip>
                                        </div>
                                        <p className="mt-1 text-tiny text-default-500">{check.message}</p>
                                        {check.nextAction ? <p className="mt-1 text-tiny text-warning-600">{check.nextAction}</p> : null}
                                    </div>
                                ))}
                            </div>
                            {blockers.length || warnings.length || sessionBlockers.length || sessionWarnings.length ? (
                                <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                                    {[...new Set([...sessionBlockers, ...blockers, ...sessionWarnings, ...warnings])].map((item) => (
                                        <p key={item}>{item}</p>
                                    ))}
                                </div>
                            ) : null}
                            {lock ? (
                                <div className="rounded-[10px] border-small border-divider bg-default-50 p-3 text-small text-default-600">
                                    <p className="font-medium text-default-800">会话锁定</p>
                                    <p className="mt-1">{lock.message}</p>
                                    <p className="mt-1 text-tiny">
                                        {lock.targetContact ? `联系人：${lock.targetContact}` : "联系人未填写"}
                                        {lock.windowTitle ? ` · 窗口：${lock.windowTitle}` : ""}
                                        {lock.lockedAt ? ` · ${formatDate(lock.lockedAt)}` : ""}
                                    </p>
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                            <div className="grid gap-3">
                                <Input
                                    label="目标联系人"
                                    placeholder="例如：张先生 / 某门店客户"
                                    value={draft.targetContact}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, targetContact: value }))}
                                />
                                <Switch
                                    isSelected={draft.currentWindowConfirmed}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, currentWindowConfirmed: value }))}
                                >
                                    当前微信窗口已切到目标会话
                                </Switch>
                                <Switch
                                    isSelected={draft.contactConfirmed}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, contactConfirmed: value }))}
                                >
                                    已核对联系人/当前窗口
                                </Switch>
                                <Switch
                                    color="danger"
                                    isSelected={draft.draftBeforeFillConfirmed}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, draftBeforeFillConfirmed: value }))}
                                >
                                    草稿填入前再次确认
                                </Switch>
                                <Switch
                                    isSelected={draft.loggedInConfirmed}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, loggedInConfirmed: value }))}
                                >
                                    微信已登录，没有掉线
                                </Switch>
                                <Switch
                                    isSelected={draft.popupCleared}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, popupCleared: value }))}
                                >
                                    弹窗/遮挡已处理
                                </Switch>
                                <Switch
                                    isSelected={draft.contactAmbiguityResolved}
                                    onValueChange={(value) => setDraft((current) => ({ ...current, contactAmbiguityResolved: value }))}
                                >
                                    联系人歧义已人工排除
                                </Switch>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        color="primary"
                                        isLoading={saving === "confirm"}
                                        startContent={saving === "confirm" ? null : <Icon icon="solar:check-circle-linear" />}
                                        onPress={() => run("confirm")}
                                    >
                                        确认会话
                                    </Button>
                                    <Button
                                        variant="flat"
                                        isLoading={saving === "takeover"}
                                        startContent={saving === "takeover" ? null : <Icon icon="solar:hand-shake-linear" />}
                                        onPress={() => run("takeover")}
                                    >
                                        人工接管
                                    </Button>
                                    <Button
                                        color="danger"
                                        variant="flat"
                                        isLoading={saving === "stop"}
                                        startContent={saving === "stop" ? null : <Icon icon="solar:stop-circle-linear" />}
                                        onPress={() => run("stop")}
                                    >
                                        停止会话
                                    </Button>
                                </div>
                            </div>
                            {latestEvidence ? (
                                <div className="mt-4 rounded-small bg-background p-3 text-small">
                                    <p className="font-medium text-default-800">{latestEvidence.label}</p>
                                    <p className="mt-1 break-all text-tiny text-default-500">
                                        {latestEvidence.value} · {formatDate(latestEvidence.capturedAt)}
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-center py-6">
                        <Spinner size="sm" />
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

function RuntimeStatusPanel({
    loading,
    status,
    onRefresh,
    onRunAction,
    runningAction,
}: {
    loading: boolean;
    status: LocalEngineRuntimeStatus | null;
    onRefresh: () => Promise<void>;
    onRunAction: (action: LocalEngineRuntimeAction) => Promise<void>;
    runningAction: LocalEngineRuntimeAction | null;
}) {
    const [selectedLogKey, setSelectedLogKey] = React.useState<LocalEngineRuntimeServiceKey>("engine");
    const [runtimeLog, setRuntimeLog] = React.useState<LocalEngineRuntimeLog | null>(null);
    const [logLoading, setLogLoading] = React.useState(false);
    const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);

    const loadRuntimeLog = React.useCallback(async (key: LocalEngineRuntimeServiceKey) => {
        setSelectedLogKey(key);
        setLogLoading(true);
        try {
            const result = await localEngineApi.runtimeLog(key);
            setRuntimeLog(result);
        } catch (e: unknown) {
            setRuntimeLog(null);
            addToast({
                title: "日志读取失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setLogLoading(false);
        }
    }, []);

    React.useEffect(() => {
        if (status?.services.length && !runtimeLog) {
            loadRuntimeLog(selectedLogKey).catch(() => {
                addToast({ title: "日志读取失败", color: "danger" });
            });
        }
    }, [loadRuntimeLog, runtimeLog, selectedLogKey, status?.services.length]);

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">处理服务检查</h3>
                        <p className="mt-1 text-small text-default-500">
                            确认客户互动、发布和本机助手相关服务能正常工作；异常时先按这里的建议处理。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Chip color={status?.allOnline ? "success" : "warning"} variant="flat">
                            {status?.allOnline ? "全部在线" : "需检查"}
                        </Chip>
                        <Button
                            size="sm"
                            variant="flat"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "刷新失败", color: "danger" });
                                });
                            }}
                        >
                            刷新
                        </Button>
                    </div>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                    <Button
                        color="success"
                        isLoading={runningAction === "start"}
                        size="sm"
                        startContent={runningAction === "start" ? null : <Icon icon="solar:play-circle-linear" />}
                        variant="flat"
                        onPress={() => {
                            onRunAction("start").catch(() => {
                                addToast({ title: "启动失败", color: "danger" });
                            });
                        }}
                    >
                        启动服务
                    </Button>
                    <Button
                        color="primary"
                        isLoading={runningAction === "restart"}
                        size="sm"
                        startContent={runningAction === "restart" ? null : <Icon icon="solar:restart-linear" />}
                        variant="flat"
                        onPress={() => {
                            onRunAction("restart").catch(() => {
                                addToast({ title: "重启失败", color: "danger" });
                            });
                        }}
                    >
                        重新启动
                    </Button>
                    <Button
                        color="warning"
                        isLoading={runningAction === "stop"}
                        size="sm"
                        startContent={runningAction === "stop" ? null : <Icon icon="solar:stop-circle-linear" />}
                        variant="flat"
                        onPress={() => {
                            onRunAction("stop").catch(() => {
                                addToast({ title: "停止失败", color: "danger" });
                            });
                        }}
                    >
                        停止服务
                    </Button>
                </div>
                <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 px-4 py-3 text-tiny text-warning-700">
                    重新启动或停止会让页面短暂断开；等待服务恢复后刷新即可。
                </div>
                {loading && !status ? (
                    <div className="flex justify-center py-8">
                        <Spinner size="sm" />
                    </div>
                ) : null}
                {status ? (
                    <>
                        <div className="grid gap-3">
                            {status.services.map((service) => (
                                <div
                                    key={service.key}
                                    className="rounded-[10px] border-small border-divider bg-default-50 p-4"
                                >
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Chip
                                                    color={service.online ? "success" : "danger"}
                                                    size="sm"
                                                    variant="flat"
                                                >
                                                    {service.online ? "在线" : "离线"}
                                                </Chip>
                                                <span className="text-small font-semibold text-default-900">{service.name}</span>
                                            </div>
                                            <p className="mt-2 text-small text-default-600">{service.message}</p>
                                            {!service.online ? (
                                                <p className="mt-2 text-small text-warning-700">
                                                    建议先点击“启动服务”；如果仍失败，再打开诊断信息查看最近日志。
                                                </p>
                                            ) : null}
                                        </div>
                                        <Button
                                            size="sm"
                                            variant={selectedLogKey === service.key && diagnosticsOpen ? "solid" : "flat"}
                                            isLoading={logLoading && selectedLogKey === service.key}
                                            onPress={() => {
                                                setDiagnosticsOpen(true);
                                                loadRuntimeLog(service.key).catch(() => {
                                                    addToast({ title: "日志读取失败", color: "danger" });
                                                });
                                            }}
                                        >
                                            查看诊断
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <h4 className="text-small font-semibold text-default-900">诊断信息</h4>
                                    <p className="mt-1 text-tiny text-default-500">
                                        普通处理不用看这里；启动失败、任务失败时再展开最近日志和服务细节。
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="flat"
                                        onPress={() => setDiagnosticsOpen((value) => !value)}
                                    >
                                        {diagnosticsOpen ? "收起诊断" : "展开诊断"}
                                    </Button>
                                    {diagnosticsOpen ? (
                                        <Button
                                            size="sm"
                                            variant="flat"
                                            isLoading={logLoading}
                                            startContent={logLoading ? null : <Icon icon="solar:refresh-linear" />}
                                            onPress={() => {
                                                loadRuntimeLog(selectedLogKey).catch(() => {
                                                    addToast({ title: "日志刷新失败", color: "danger" });
                                                });
                                            }}
                                        >
                                            刷新日志
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            {diagnosticsOpen ? (
                                <div className="mt-4 grid gap-4">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        {status.services.map((service) => (
                                            <div key={`${service.key}-diagnostic`} className="rounded-small bg-background p-3 text-tiny text-default-500">
                                                <p className="font-medium text-default-800">{service.name}</p>
                                                <p className="mt-1 break-all">地址：{service.url}</p>
                                                <p>端口：{service.port} · PID：{service.pid || "-"}</p>
                                                <p>托管：{service.managedByScreen ? "是" : "否"} · 会话：{service.screenSession}</p>
                                                <p className="break-all">日志：{service.logPath}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="rounded-[10px] bg-black p-3 font-mono text-[11px] leading-5 text-default-100">
                                        <p className="mb-2 text-default-400">
                                            {runtimeLog ? `${runtimeLog.name} 最近日志` : "选择一个服务查看最近日志。"}
                                        </p>
                                        <div className="max-h-64 overflow-auto">
                                            {logLoading && !runtimeLog ? (
                                                <div className="text-default-400">正在读取日志...</div>
                                            ) : runtimeLog?.exists && runtimeLog.lines.length ? (
                                                runtimeLog.lines.map((line, index) => (
                                                    <div key={`${runtimeLog.key}-${index}`}>{line}</div>
                                                ))
                                            ) : runtimeLog?.exists ? (
                                                <div className="text-default-400">日志文件暂无内容。</div>
                                            ) : (
                                                <div className="text-default-400">日志文件不存在。</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid gap-2 text-tiny text-default-500">
                                        <p className="break-all">启动脚本：{status.startScript}</p>
                                        <p className="break-all">停止脚本：{status.stopScript}</p>
                                        <p className="break-all">日志目录：{status.logDir}</p>
                                        <p>最近检查：{new Date(status.checkedAt).toLocaleString()}</p>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : !loading ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                        暂未读取到处理服务状态。
                    </div>
                ) : null}
            </CardBody>
        </Card>
    );
}

function QuickAgentTaskPanel({
    defaultInstruction,
    description,
    icon,
    scope,
    targetApp,
    title,
}: {
    defaultInstruction: string;
    description: string;
    icon: string;
    scope: "browser" | "desktop" | "remote" | "local-files" | "mixed";
    targetApp: string;
    title: string;
}) {
    const [instruction, setInstruction] = React.useState(defaultInstruction);
    const [creating, setCreating] = React.useState(false);

    const createSession = async () => {
        setCreating(true);
        try {
            const session = await localEngineApi.createAgentSession({
                source: "system",
                executionScope: scope,
                targetApp,
                title,
                instruction,
            });
            addToast({
                title: "任务已创建",
                description: session.nextAction,
                color: "success",
            });
        } catch (error: unknown) {
            addToast({
                title: "创建失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCreating(false);
        }
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                        <Icon icon={icon} width={22} />
                    </div>
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">{title}</h3>
                            <p className="mt-1 text-small text-default-500">{description}</p>
                        </div>
                    </div>
                    <Button as={Link} href="/sessions" variant="flat">
                        查看会话
                    </Button>
                </div>
                <Textarea
                    label="本机任务指令"
                    minRows={4}
                    value={instruction}
                    onValueChange={setInstruction}
                />
                <div className="flex flex-wrap justify-end gap-2">
                    <Button as={Link} href="/confirmations" variant="flat">
                        待我确认
                    </Button>
                    <Button
                        color="primary"
                        isLoading={creating}
                        startContent={creating ? null : <Icon icon="solar:play-circle-linear" />}
                        onPress={createSession}
                    >
                        创建本机任务
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function EvidenceReplayPanel({
    tasks,
    tasksLoading,
    onRefreshTasks,
}: {
    tasks: InteractionTask[];
    tasksLoading: boolean;
    onRefreshTasks: () => Promise<void>;
}) {
    const [exportingTaskId, setExportingTaskId] = React.useState("");
    const [cleanupPreview, setCleanupPreview] = React.useState<InteractionEvidenceCleanupResult | null>(null);
    const [retentionDays, setRetentionDays] = React.useState("7");
    const [cleanupLoading, setCleanupLoading] = React.useState(false);
    const evidenceTasks = tasks.filter((task) => task.events.some((event) => event.evidence));
    const evidenceCountByType = evidenceTasks.reduce<Record<string, number>>((acc, task) => {
        task.events.forEach((event) => {
            if (event.evidence) acc[event.evidence.type] = (acc[event.evidence.type] || 0) + 1;
        });
        return acc;
    }, {});
    const riskPolicyTasks = tasks.filter((task) => task.riskPolicy);

    const exportTask = async (task: InteractionTask) => {
        setExportingTaskId(task.id);
        try {
            const result = await localEngineApi.exportTaskDiagnostics(task.id);
            downloadTextFile(result.filename, result.content, result.mimeType);
            addToast({ title: "诊断包已导出", description: result.filename, color: "success" });
        } catch (error: unknown) {
            addToast({
                title: "导出失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setExportingTaskId("");
        }
    };

    const previewCleanup = async () => {
        setCleanupLoading(true);
        try {
            setCleanupPreview(await localEngineApi.previewEvidenceCleanup(Number(retentionDays) || 7));
        } catch (error: unknown) {
            addToast({
                title: "证据预览失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCleanupLoading(false);
        }
    };

    const cleanupEvidence = async () => {
        setCleanupLoading(true);
        try {
            const result = await localEngineApi.cleanupEvidence(Number(retentionDays) || 7);
            setCleanupPreview(result);
            addToast({ title: "旧证据已清理", description: `删除 ${result.deletedCount} 个文件`, color: "success" });
            await onRefreshTasks();
        } catch (error: unknown) {
            addToast({
                title: "证据清理失败",
                description: error instanceof Error ? error.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCleanupLoading(false);
        }
    };

    return (
        <div className="grid gap-4">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">证据回放</h3>
                            <p className="mt-1 text-small text-default-500">
                                按任务查看截图、页面快照、文本证据和诊断包；这里直接导出，不只是展示状态。
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button as={Link} href="/artifacts" variant="flat">
                                操作证据
                            </Button>
                            <Button isLoading={tasksLoading} variant="flat" onPress={onRefreshTasks}>
                                刷新任务
                            </Button>
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatusItem label="任务总数" value={String(tasks.length)} />
                        <StatusItem label="有证据任务" value={String(evidenceTasks.length)} />
                        <StatusItem label="待确认" value={String(tasks.filter((task) => task.status === "waiting_for_send_confirmation").length)} />
                        <StatusItem label="失败" value={String(tasks.filter((task) => task.status === "failed").length)} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                        <StatusItem label="页面快照" value={String(evidenceCountByType.page_snapshot || 0)} />
                        <StatusItem label="桌面截图" value={String(evidenceCountByType.desktop_screenshot || 0)} />
                        <StatusItem label="阶段日志" value={String(evidenceCountByType.stage_log || 0)} />
                        <StatusItem label="失败原因" value={String(evidenceCountByType.failure_reason || 0)} />
                    </div>
                    <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                        <p className="font-semibold">权限风控覆盖</p>
                        <p className="mt-1">
                            已记录风控策略任务 {riskPolicyTasks.length} 个；包含试用/商用权限、角色审批、白名单、禁止动作和远程接管审计字段。
                        </p>
                    </div>
                    <div className="grid gap-3">
                        {evidenceTasks.map((task) => (
                            <div key={task.id} className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusChip status={task.status} label={task.statusLabel} />
                                            <Chip size="sm" variant="flat">{task.typeLabel}</Chip>
                                            <Chip size="sm" variant="flat">
                                                {task.events.filter((event) => event.evidence).length} 条证据
                                            </Chip>
                                            {task.safetyBoundary ? (
                                                <Chip color={task.safetyBoundary.permissionStatus === "allowed" ? "success" : "warning"} size="sm" variant="flat">
                                                    {permissionStatusLabel[task.safetyBoundary.permissionStatus] || task.safetyBoundary.permissionStatus}
                                                </Chip>
                                            ) : null}
                                            {task.riskPolicy?.remoteTakeoverAuditRequired ? (
                                                <Chip color="danger" size="sm" variant="flat">远程审计</Chip>
                                            ) : null}
                                        </div>
                                        <p className="mt-2 text-small font-semibold text-default-900">
                                            {task.accountName} {"->"} {task.targetName}
                                        </p>
                                        <p className="mt-1 text-small text-default-500">{task.diagnostics?.summary || task.nextAction}</p>
                                        {task.riskPolicy ? (
                                            <p className="mt-1 text-tiny text-default-400">
                                                {task.riskPolicy.message}
                                                {(task.riskPolicy.forbiddenActions || []).length ? `；禁止动作：${(task.riskPolicy.forbiddenActions || []).join("、")}` : ""}
                                            </p>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {Object.entries(
                                                task.events.reduce<Record<string, number>>((acc, event) => {
                                                    if (event.evidence) acc[event.evidence.type] = (acc[event.evidence.type] || 0) + 1;
                                                    return acc;
                                                }, {}),
                                            ).map(([type, count]) => (
                                                <Chip key={type} size="sm" variant="flat">{type}: {count}</Chip>
                                            ))}
                                        </div>
                                    </div>
                                    <Button
                                        isLoading={exportingTaskId === task.id}
                                        size="sm"
                                        startContent={exportingTaskId === task.id ? null : <Icon icon="solar:download-minimalistic-linear" />}
                                        variant="flat"
                                        onPress={() => exportTask(task)}
                                    >
                                        导出诊断包
                                    </Button>
                                </div>
                            </div>
                        ))}
                        {!tasksLoading && !evidenceTasks.length ? (
                            <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                                暂无操作证据。先从评论、私信、微信或智能任务创建任务。
                            </div>
                        ) : null}
                    </div>
                </CardBody>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">证据文件治理</h3>
                            <p className="mt-1 text-small text-default-500">
                                清理前必须预览数量、大小和目录，避免误删近期证据。
                            </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                            <Input
                                className="w-32"
                                label="保留天数"
                                min={0}
                                size="sm"
                                type="number"
                                value={retentionDays}
                                onValueChange={setRetentionDays}
                            />
                            <Button isLoading={cleanupLoading} variant="flat" onPress={previewCleanup}>
                                预览清理
                            </Button>
                            <Button
                                color="danger"
                                isDisabled={!cleanupPreview?.candidateCount}
                                isLoading={cleanupLoading}
                                variant="flat"
                                onPress={cleanupEvidence}
                            >
                                清理旧证据
                            </Button>
                        </div>
                    </div>
                    {cleanupPreview ? (
                        <div className="grid gap-3 md:grid-cols-4">
                            <StatusItem label="目录文件" value={String(cleanupPreview.status.fileCount)} />
                            <StatusItem label="目录大小" value={formatBytes(cleanupPreview.status.totalBytes)} />
                            <StatusItem label={cleanupPreview.execute ? "已清理" : "可清理"} value={String(cleanupPreview.execute ? cleanupPreview.deletedCount : cleanupPreview.candidateCount)} />
                            <StatusItem label="预计释放" value={formatBytes(cleanupPreview.totalBytes)} />
                        </div>
                    ) : (
                        <div className="rounded-small bg-default-50 p-3 text-small text-default-500">
                            点击“预览清理”后，再决定是否清理旧截图和快照。
                        </div>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}

function BrowserControlPanel({
    capability,
    executorsLoading,
    executorsStatus,
    loading,
    status,
    onRefreshExecutors,
    onRefresh,
    onTaskCreated,
}: {
    capability?: LocalEngineCapability;
    executorsLoading: boolean;
    executorsStatus: LocalEngineExecutorsStatus | null;
    loading: boolean;
    status: LocalEngineBrowserStatus | null;
    onRefreshExecutors: () => Promise<void>;
    onRefresh: () => Promise<void>;
    onTaskCreated?: () => Promise<void>;
}) {
    const [creatingTaskKey, setCreatingTaskKey] = React.useState<string | null>(null);

    const createBrowserTask = async (
        account: LocalEngineBrowserStatus["accounts"][number],
        route: Extract<InteractionBusinessRouteKey, "comments" | "messages">,
    ) => {
        const isCommentTask = route === "comments";
        const type: InteractionTaskType = isCommentTask ? "douyin-comment-reply" : "douyin-direct-message-reply";
        const taskKey = `${account.id}-${route}`;
        setCreatingTaskKey(taskKey);
        try {
            const task = await localEngineApi.createBusinessTask(route, {
                type,
                accountId: String(account.id),
                accountName: account.displayName,
                platformType: account.type,
                platformName: account.platform,
                targetName: isCommentTask ? "浏览器读取评论" : "浏览器读取私信",
                sourceText: isCommentTask
                    ? "浏览器预检将自动打开抖音后台并读取第一条可处理评论。"
                    : "浏览器预检将自动打开抖音后台并读取第一条可处理私信。",
                replyText: "",
                sendMode: "approval-send",
            });
            addToast({
                title: isCommentTask ? "已创建评论预检任务" : "已创建私信预检任务",
                description: `${task.accountName}：将打开后台、读取页面并等待发送前确认。`,
                color: "success",
            });
            await onTaskCreated?.();
        } catch (e: unknown) {
            addToast({
                title: "创建浏览器任务失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCreatingTaskKey(null);
        }
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">浏览器控制</h3>
                        <p className="mt-1 text-small text-default-500">
                            从这里选择真实平台账号发起预检：打开后台、读取页面、保存证据，并在填入草稿前暂停确认。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <CapabilityChip status={capability?.status || "missing"} />
                        <Button
                            size="sm"
                            variant="flat"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "刷新失败", color: "danger" });
                                });
                            }}
                        >
                            刷新
                        </Button>
                    </div>
                </div>
                <ExecutorStatusPanel
                    loading={executorsLoading}
                    status={executorsStatus}
                    onRefresh={onRefreshExecutors}
                />
                <McpStatusCard />
                <div className="grid gap-3 md:grid-cols-4">
                    <StatusItem label="引擎状态" value={status?.engineOnline ? "在线" : "不可用"} />
                    <StatusItem label="账号总数" value={String(status?.totalAccounts ?? 0)} />
                    <StatusItem label="正常账号" value={String(status?.readyAccounts ?? 0)} />
                    <StatusItem label="失效账号" value={String(status?.expiredAccounts ?? 0)} />
                </div>
                <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                    <p className="break-all text-small text-default-700">
                        {status?.engineMessage || capability?.summary || "暂未读取到浏览器控制状态。"}
                    </p>
                    {capability?.nextAction ? (
                        <p className="mt-2 text-small text-default-500">{capability.nextAction}</p>
                    ) : null}
                </div>
                <div className="grid gap-3">
                    {status?.accounts.map((account) => {
                        const isDouyin = account.type === 3;
                        const canCreateTask = Boolean(status.engineOnline && account.status === "ready" && isDouyin);
                        const commentKey = `${account.id}-comments`;
                        const messageKey = `${account.id}-messages`;
                        return (
                        <div
                            key={account.id}
                            className="flex flex-col gap-3 rounded-[10px] border-small border-divider bg-default-50 p-4 md:flex-row md:items-center md:justify-between"
                        >
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Chip size="sm" variant="flat">{account.platform}</Chip>
                                    <span className="text-small font-semibold text-default-900">{account.displayName}</span>
                                </div>
                                <p className="mt-2 break-all text-tiny text-default-500">{account.filePath}</p>
                                {account.status === "expired" ? (
                                    <p className="mt-2 text-tiny text-warning-600">
                                        登录态失效：请先在本机浏览器重新登录，再发起评论/私信预检。
                                    </p>
                                ) : null}
                                {account.status === "ready" && !isDouyin ? (
                                    <p className="mt-2 text-tiny text-default-500">
                                        当前真实浏览器预检优先接入抖音评论/私信；其他平台仍可走本机 Agent 指令。
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 md:justify-end">
                                <Chip
                                    color={account.status === "ready" ? "success" : "warning"}
                                    size="sm"
                                    variant="flat"
                                >
                                    {account.statusLabel}
                                </Chip>
                                <Button
                                    size="sm"
                                    variant="flat"
                                    color="primary"
                                    isDisabled={!canCreateTask || Boolean(creatingTaskKey)}
                                    isLoading={creatingTaskKey === commentKey}
                                    startContent={creatingTaskKey === commentKey ? null : <Icon icon="solar:chat-round-line-linear" />}
                                    onPress={() => createBrowserTask(account, "comments")}
                                >
                                    评论预检
                                </Button>
                                <Button
                                    size="sm"
                                    variant="flat"
                                    color="secondary"
                                    isDisabled={!canCreateTask || Boolean(creatingTaskKey)}
                                    isLoading={creatingTaskKey === messageKey}
                                    startContent={creatingTaskKey === messageKey ? null : <Icon icon="solar:letter-linear" />}
                                    onPress={() => createBrowserTask(account, "messages")}
                                >
                                    私信预检
                                </Button>
                                <Button
                                    as={Link}
                                    href="/confirmations"
                                    size="sm"
                                    variant="light"
                                    startContent={<Icon icon="solar:shield-check-linear" />}
                                >
                                    待确认
                                </Button>
                            </div>
                        </div>
                        );
                    })}
                    {!loading && !status?.accounts.length ? (
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                            暂无平台账号。请先到发布中心的平台账号里绑定抖音、小红书、视频号等账号。
                        </div>
                    ) : null}
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Spinner size="sm" />
                        </div>
                    ) : null}
                </div>
            </CardBody>
        </Card>
    );
}

function ExecutorStatusPanel({
    loading,
    status,
    onRefresh,
}: {
    loading: boolean;
    status: LocalEngineExecutorsStatus | null;
    onRefresh: () => Promise<void>;
}) {
    return (
        <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h4 className="text-small font-semibold text-default-900">客户互动可用性</h4>
                    <p className="mt-1 text-tiny text-default-500">
                        检查评论、私信和微信回复能不能真实读取、生成草稿并等待确认。
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="flat"
                    isLoading={loading}
                    startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                    onPress={() => {
                        onRefresh().catch(() => {
                            addToast({ title: "刷新失败", color: "danger" });
                        });
                    }}
                >
                    重新检查
                </Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
                <StatusItem label="检查项" value={String(status?.summary.total ?? 0)} />
                <StatusItem label="可直接处理" value={String(status?.summary.ready ?? 0)} />
                <StatusItem label="需先确认" value={String(status?.summary.preflightOnly ?? 0)} />
                <StatusItem label="需要配置" value={String(status?.summary.missing ?? 0)} />
            </div>

            {loading && !status ? (
                <div className="flex justify-center py-6">
                    <Spinner size="sm" />
                </div>
            ) : null}

            <div className="mt-4 grid gap-3">
                {status?.executors.map((executor) => (
                    <div key={executor.key} className="rounded-small bg-background p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <ExecutorStatusChip status={executor.status} />
                                    <Chip size="sm" variant="flat">{executor.platformName}</Chip>
                                    <span className="text-small font-semibold text-default-900">{executor.name}</span>
                                </div>
                                <p className="mt-2 text-small text-default-600">{executor.message}</p>
                                <p className="mt-2 text-tiny text-default-400">{executor.nextAction}</p>
                            </div>
                            <div className="grid min-w-[260px] grid-cols-2 gap-2">
                                <ExecutorAbilityChip label="打开入口" ready={executor.entryPreflight} />
                                <ExecutorAbilityChip label="读取对象" ready={executor.targetRead} />
                                <ExecutorAbilityChip label="生成回复" ready={executor.replyGenerate} />
                                <ExecutorAbilityChip label="受控发送" ready={executor.controlledSend} />
                            </div>
                        </div>
                    </div>
                ))}
                {!loading && !status?.executors.length ? (
                    <div className="rounded-small bg-background p-4 text-small text-default-500">
                        暂未读取到客户互动可用性。
                    </div>
                ) : null}
            </div>

            {status ? (
                <p className="mt-3 text-tiny text-default-400">
                    最近检查：{new Date(status.checkedAt).toLocaleString()}
                </p>
            ) : null}
        </section>
    );
}

function McpStatusCard() {
    const [status, setStatus] = React.useState<{
        playwright?: { online: boolean; childProcessRunning: boolean; transport: string; endpoint: string; pid?: number; toolCount?: number; message: string };
        runtime?: { available: boolean; serverCount: number; toolCount: number; message: string };
    } | null>(null);
    const [tools, setTools] = React.useState<Array<{ name: string; description?: string }>>([]);
    const [loading, setLoading] = React.useState(false);
    const [testUrl, setTestUrl] = React.useState('https://example.com');
    const [testRunning, setTestRunning] = React.useState(false);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const [s, t] = await Promise.all([
                localEngineApi.mcpStatus(),
                localEngineApi.mcpTools(),
            ]);
            // 后端返 { success, data: { success, data: { playwright, runtime } } } (双重 wrap by TransformInterceptor)
            // 兼容 1 层 / 2 层 wrap
            const sData: any = s.data;
            const tData: any = t.data;
            setStatus(sData?.data?.data ?? sData?.data ?? sData);
            setTools(tData?.data?.playwright ?? tData?.playwright ?? []);
        } catch {
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh().catch(() => {});
        const id = setInterval(() => {
            refresh().catch(() => {});
        }, 8000);
        return () => clearInterval(id);
    }, [refresh]);

    const onTestNavigate = async () => {
        if (!testUrl.trim()) return;
        setTestRunning(true);
        try {
            const r = await localEngineApi.mcpCallTool('browser_navigate', { url: testUrl.trim() });
            const text = r.result?.content?.[0]?.text ?? r.error?.message ?? '(无响应)';
            addToast({
                title: r.error ? '浏览器调用失败' : '已用 MCP 打开页面',
                description: String(text).slice(0, 220),
                color: r.error ? 'danger' : 'success',
            });
        } catch (e: unknown) {
            addToast({
                title: '调用失败',
                description: e instanceof Error ? e.message : String(e),
                color: 'danger',
            });
        } finally {
            setTestRunning(false);
        }
    };

    /**
     * 登录辅助: 打开抖音/视频号登录页, 用户手动扫码/输入账号登录,
     * 登录后 cookies 自动落 sidecar 的 profile 目录. PERSIST_PROFILE=true 启用.
     */
    const onOpenLogin = async (loginUrl: string, platformLabel: string) => {
        setTestRunning(true);
        try {
            const r = await localEngineApi.mcpCallTool('browser_navigate', { url: loginUrl });
            const text = r.result?.content?.[0]?.text ?? r.error?.message ?? '';
            addToast({
                title: `${platformLabel} 登录页已打开`,
                description: '在 Chrome 里扫码/输入账号登录，cookies 会自动保存。下次 MCP 调浏览器就用这登录态。'
                    + (text ? ` 当前页: ${String(text).slice(0, 80)}` : ''),
                color: 'success',
            });
        } catch (e: unknown) {
            addToast({
                title: '打开登录页失败',
                description: e instanceof Error ? e.message : String(e),
                color: 'danger',
            });
        } finally {
            setTestRunning(false);
        }
    };

    const online = !!status?.playwright?.online;
    const sidecarPid = status?.playwright?.pid;

    return (
        <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h4 className="text-small font-semibold text-default-900">MCP 浏览器自动化 (playwright-mcp)</h4>
                    <p className="mt-1 text-tiny text-default-500">
                        microsoft/playwright-mcp 暴露的 {tools.length} 个 browser_* 工具;
                        任何 MCP 客户端 (Claude/Cursor/Agent-S) 都能通过 /api/mcp/playwright 调用,
                        platform service 也走这条路径真实打开抖音/视频号页面。
                    </p>
                </div>
                <Button
                    size="sm"
                    variant="flat"
                    isLoading={loading}
                    startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                    onPress={() => {
                        refresh().catch(() => {
                            addToast({ title: '刷新失败', color: 'danger' });
                        });
                    }}
                >
                    刷新
                </Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
                <StatusItem
                    label="sidecar 状态"
                    value={online ? '在线' : '离线'}
                />
                <StatusItem
                    label="子进程 PID"
                    value={sidecarPid ? String(sidecarPid) : '-'}
                />
                <StatusItem
                    label="工具数量"
                    value={String(tools.length)}
                />
            </div>

            {status?.playwright?.message ? (
                <p className="mt-2 text-tiny text-default-500">{status.playwright.message}</p>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-end">
                <Input
                    size="sm"
                    value={testUrl}
                    onValueChange={setTestUrl}
                    placeholder="https://example.com"
                    label="测试浏览器"
                    className="flex-1"
                />
                <Button
                    size="sm"
                    color="primary"
                    isLoading={testRunning}
                    isDisabled={!online}
                    onPress={onTestNavigate}
                    startContent={!testRunning ? <Icon icon="solar:globus-linear" /> : null}
                >
                    调用 browser_navigate
                </Button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
                <p className="text-tiny text-default-500">
                    <strong className="text-default-700">登录态持久化</strong>：
                    先在 headed Chrome 里登录账号，cookies 会自动保存到 sidecar profile 目录。
                    之后 MCP 调浏览器就带着登录态。需要在 backend/.env 设 <code className="font-mono">PERSIST_PROFILE=true</code> 重启。
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        variant="bordered"
                        isDisabled={!online || testRunning}
                        onPress={() => onOpenLogin('https://creator.douyin.com/', '抖音创作者中心')}
                        startContent={<Icon icon="solar:user-circle-linear" />}
                    >
                        打开抖音登录页
                    </Button>
                    <Button
                        size="sm"
                        variant="bordered"
                        isDisabled={!online || testRunning}
                        onPress={() => onOpenLogin('https://channels.weixin.qq.com/platform', '视频号助手')}
                        startContent={<Icon icon="solar:user-circle-linear" />}
                    >
                        打开视频号登录页
                    </Button>
                </div>
            </div>

            {tools.length > 0 ? (
                <details className="mt-3">
                    <summary className="cursor-pointer text-tiny text-default-600">
                        查看全部 {tools.length} 个 MCP 工具
                    </summary>
                    <div className="mt-2 grid gap-1 md:grid-cols-2">
                        {tools.map((t) => (
                            <div
                                key={t.name}
                                className="rounded-small border-small border-divider bg-background px-2 py-1 text-tiny"
                            >
                                <code className="font-mono text-primary">{t.name}</code>
                                {t.description ? (
                                    <span className="ml-2 text-default-500">
                                        {t.description.slice(0, 60)}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </details>
            ) : null}
        </section>
    );
}

const desktopReplicaCapabilityKeys: Array<LocalEngineCapability["key"]> = [
    "desktop-control",
    "mcp-manager",
    "agent-s-sidecar",
    "wechat-execution",
    "remote-control",
    "plugin-runtime",
    "memory-context",
    "sandbox-execution",
    "evidence-replay",
];

function DesktopCapabilityPanel({
    capabilityByKey,
}: {
    capabilityByKey: Map<LocalEngineCapability["key"], LocalEngineCapability>;
}) {
    const capabilities = desktopReplicaCapabilityKeys
        .map((key) => capabilityByKey.get(key))
        .filter((capability): capability is LocalEngineCapability => Boolean(capability));
    const missingCount = capabilities.filter((capability) => capability.status === "missing").length;
    const warningCount = capabilities.filter((capability) => capability.status === "warning").length;
    const readyCount = capabilities.filter((capability) => capability.status === "ready").length;

    const openMacPrivacyPane = (pane: "accessibility" | "screen" | "files" | "automation") => {
        const urls = {
            accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            files: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        };
        window.open(urls[pane], "_self");
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">本机助手能力</h3>
                        <p className="mt-1 max-w-3xl text-small text-default-500">
                            这里检查浏览器、微信桌面、远程接管、结果凭证等商用处理所需能力。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Chip color="success" size="sm" variant="flat">可用 {readyCount}</Chip>
                        <Chip color="warning" size="sm" variant="flat">需确认 {warningCount}</Chip>
                        <Chip color="danger" size="sm" variant="flat">需要处理 {missingCount}</Chip>
                    </div>
                </div>

                <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="text-small font-semibold text-warning-800">macOS 桌面权限</p>
                            <p className="mt-1 text-small text-warning-700">
                                KaypalAI 内容创作平台需要这些权限来识别窗口、输入内容、点击按钮和选择素材文件。开完权限后回到本页刷新检查。
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="flat" onPress={() => openMacPrivacyPane("accessibility")}>
                                辅助功能
                            </Button>
                            <Button size="sm" variant="flat" onPress={() => openMacPrivacyPane("screen")}>
                                屏幕录制
                            </Button>
                            <Button size="sm" variant="flat" onPress={() => openMacPrivacyPane("automation")}>
                                自动化
                            </Button>
                            <Button size="sm" variant="flat" onPress={() => openMacPrivacyPane("files")}>
                                完全磁盘访问
                            </Button>
                        </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-tiny text-warning-700 md:grid-cols-2">
                        <p>辅助功能：允许输入、粘贴、点击和控制窗口。</p>
                        <p>屏幕录制：允许识别当前窗口和页面状态。</p>
                        <p>自动化：允许控制微信、浏览器、Finder 等应用。</p>
                        <p>文件权限：允许选择图片、视频和账号素材文件。</p>
                    </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                    {capabilities.map((capability) => (
                        <div key={capability.key} className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-small font-semibold text-default-900">{capability.name}</p>
                                    <p className="mt-1 text-small text-default-600">{capability.summary}</p>
                                </div>
                                <CapabilityChip status={capability.status} />
                            </div>
                            {capability.nextAction ? (
                                <p className="mt-3 text-tiny text-default-500">{capability.nextAction}</p>
                            ) : null}
                            {capability.checks?.length ? (
                                <div className="mt-3 grid gap-2">
                                    {capability.checks.map((check) => (
                                        <div key={check.name} className="rounded-small bg-background p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-tiny font-medium text-default-800">{check.name}</span>
                                                <CapabilityChip status={check.status} />
                                            </div>
                                            <p className="mt-1 break-all text-tiny text-default-500">{check.message}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                    {!capabilities.length ? (
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                            暂未读取到本机助手能力，请重新检查。
                        </div>
                    ) : null}
                </div>
            </CardBody>
        </Card>
    );
}

function FileAccessPanel({
    capability,
    loading,
    status,
    onRefresh,
}: {
    capability?: LocalEngineCapability;
    loading: boolean;
    status: LocalEngineFileAccessStatus | null;
    onRefresh: () => Promise<void>;
}) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">文件与凭证</h3>
                        <p className="mt-1 text-small text-default-500">
                            检查素材、截图、诊断包和结果凭证能不能正常读取和保存。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <CapabilityChip status={capability?.status || "missing"} />
                        <Button
                            size="sm"
                            variant="flat"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "刷新失败", color: "danger" });
                                });
                            }}
                        >
                            刷新
                        </Button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                    <StatusItem label="检查项" value={String(status?.summary.total ?? 0)} />
                    <StatusItem label="可访问" value={String(status?.summary.ready ?? 0)} />
                    <StatusItem label="需处理" value={String(status?.summary.warnings ?? 0)} />
                </div>

                {capability ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <p className="text-small text-default-700">{capability.summary}</p>
                        {capability.nextAction ? (
                            <p className="mt-2 text-small text-default-500">{capability.nextAction}</p>
                        ) : null}
                        <p className="mt-3 text-tiny text-default-400">
                            最近检查：{new Date(capability.checkedAt).toLocaleString()}
                        </p>
                    </div>
                ) : null}

                {loading && !status ? (
                    <div className="flex justify-center py-8">
                        <Spinner size="sm" />
                    </div>
                ) : null}

                <div className="grid gap-4">
                    {status?.roots.map((item) => {
                        const isReady = item.exists && item.readable;
                        return (
                            <section
                                key={item.key}
                                className="rounded-[10px] border-small border-divider bg-default-50 p-4"
                            >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Chip
                                                color={isReady ? "success" : "warning"}
                                                size="sm"
                                                variant="flat"
                                            >
                                                {isReady ? "可访问" : "需处理"}
                                            </Chip>
                                            <span className="text-small font-semibold text-default-900">{item.name}</span>
                                            <Chip size="sm" variant="flat">{fileKindLabel(item.kind)}</Chip>
                                        </div>
                                        <p className="mt-2 break-all text-tiny text-default-500">{item.path}</p>
                                        {item.note ? (
                                            <p className="mt-2 text-small text-default-600">{item.note}</p>
                                        ) : null}
                                    </div>
                                    <div className="grid min-w-[240px] grid-cols-2 gap-2 text-tiny text-default-600">
                                        <span>读取：{item.readable ? "正常" : "不可读"}</span>
                                        <span>写入：{item.writable ? "正常" : "不可写"}</span>
                                        <span>文件：{item.fileCount ?? "-"}</span>
                                        <span>目录：{item.directoryCount ?? "-"}</span>
                                        <span>大小：{formatBytes(item.sizeBytes)}</span>
                                        <span>更新：{formatDate(item.updatedAt)}</span>
                                    </div>
                                </div>

                                {item.recentFiles?.length ? (
                                    <>
                                        <Divider className="my-3" />
                                        <div className="grid gap-2">
                                            {item.recentFiles.map((file) => (
                                                <div
                                                    key={file.path}
                                                    className="flex flex-col gap-1 rounded-small bg-background p-3 md:flex-row md:items-center md:justify-between"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <Icon
                                                                icon={file.kind === "directory" ? "solar:folder-linear" : "solar:file-text-linear"}
                                                                width={18}
                                                            />
                                                            <span className="truncate text-small text-default-800">{file.name}</span>
                                                        </div>
                                                        <p className="mt-1 break-all text-tiny text-default-400">{file.path}</p>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 text-tiny text-default-500">
                                                        <span>{fileKindLabel(file.kind)}</span>
                                                        <span>{formatBytes(file.sizeBytes)}</span>
                                                        <span>{formatDate(file.updatedAt)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : null}
                            </section>
                        );
                    })}
                    {!loading && !status ? (
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                            暂未读取到文件访问状态。
                        </div>
                    ) : null}
                </div>
            </CardBody>
        </Card>
    );
}

function PermissionCheckPanel({
    capability,
    loading,
    readiness,
    onRefresh,
}: {
    capability?: LocalEngineCapability;
    loading: boolean;
    readiness: LocalEngineReadiness | null;
    onRefresh: () => Promise<void>;
}) {
    const ready = Boolean(readiness?.ready);

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">执行前检查</h3>
                        <p className="mt-1 text-small text-default-500">
                            在评论、私信、微信回复和发布任务执行前，统一检查账号、引擎、目录和安全边界。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Chip color={ready ? "success" : "warning"} variant="flat">
                            {ready ? "可执行" : "需处理"}
                        </Chip>
                        <Button
                            size="sm"
                            variant="flat"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "刷新失败", color: "danger" });
                                });
                            }}
                        >
                            重新检查
                        </Button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                    <StatusItem label="阻断项" value={String(readiness?.summary.blockers ?? 0)} />
                    <StatusItem label="提醒项" value={String(readiness?.summary.warnings ?? 0)} />
                    <StatusItem label="可用账号" value={String(readiness?.summary.readyAccounts ?? 0)} />
                    <StatusItem label="失效账号" value={String(readiness?.summary.expiredAccounts ?? 0)} />
                    <StatusItem label="文件风险" value={String(readiness?.summary.fileWarnings ?? 0)} />
                </div>

                {capability ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <CapabilityChip status={capability.status} />
                            <span className="text-small font-medium text-default-900">系统权限基线</span>
                        </div>
                        <p className="mt-2 text-small text-default-700">{capability.summary}</p>
                        {capability.nextAction ? (
                            <p className="mt-2 text-small text-default-500">{capability.nextAction}</p>
                        ) : null}
                    </div>
                ) : null}

                {loading && !readiness ? (
                    <div className="flex justify-center py-8">
                        <Spinner size="sm" />
                    </div>
                ) : null}

                {readiness ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                        <ReadinessList
                            emptyText="没有阻断项，可以继续执行本地任务。"
                            items={readiness.blockers}
                            tone="danger"
                            title="必须处理"
                        />
                        <ReadinessList
                            emptyText="没有提醒项。"
                            items={readiness.warnings}
                            tone="warning"
                            title="建议处理"
                        />
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 lg:col-span-2">
                            <p className="text-tiny text-default-400">
                                最近检查：{new Date(readiness.checkedAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                ) : !loading ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                        暂未读取到权限检查结果。
                    </div>
                ) : null}
            </CardBody>
        </Card>
    );
}

function ReadinessList({
    emptyText,
    items,
    title,
    tone,
}: {
    emptyText: string;
    items: LocalEngineReadiness["blockers"];
    title: string;
    tone: "danger" | "warning";
}) {
    const color = tone === "danger" ? "danger" : "warning";

    return (
        <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-small font-semibold text-default-900">{title}</h4>
                <Chip color={color} size="sm" variant="flat">{items.length}</Chip>
            </div>
            <div className="grid gap-3">
                {items.map((item) => (
                    <div key={`${item.capability}-${item.message}`} className="rounded-small bg-background p-3">
                        <p className="text-small font-medium text-default-800">{item.capability}</p>
                        <p className="mt-1 text-small text-default-600">{item.message}</p>
                        {item.nextAction ? (
                            <p className="mt-2 text-tiny text-default-400">{item.nextAction}</p>
                        ) : null}
                    </div>
                ))}
                {!items.length ? (
                    <div className="rounded-small bg-background p-3 text-small text-default-500">
                        {emptyText}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function InteractionCreatePanel({
    browserStatus,
    executorsStatus,
    route,
    view,
    onCreated,
}: {
    browserStatus: LocalEngineBrowserStatus | null;
    executorsStatus: LocalEngineExecutorsStatus | null;
    route: ActiveInteractionBusinessRouteKey;
    view: (typeof interactionViews)[ActiveInteractionBusinessRouteKey];
    onCreated: () => void;
}) {
    const [submitting, setSubmitting] = React.useState(false);
    const [form, setForm] = React.useState<CreateInteractionTaskInput>({
        type: view.defaultType,
        accountName: `${view.platformLabel}账号`,
        platformType: view.platformType,
        platformName: view.platformLabel,
        targetName: view.defaultTarget,
        sourceText: view.defaultSource,
        replyText: view.defaultReply,
        sendMode: "auto-send",
    });
    const [batchText, setBatchText] = React.useState("");

    React.useEffect(() => {
        setForm((current) => ({
            ...current,
            type: view.defaultType,
            accountId: undefined,
            accountName: `${view.platformLabel}账号`,
            platformType: view.platformType,
            platformName: view.platformLabel,
            targetName: current.targetName && current.type === view.defaultType ? current.targetName : view.defaultTarget,
            sourceText: current.sourceText && current.type === view.defaultType ? current.sourceText : view.defaultSource,
            replyText: current.replyText && current.type === view.defaultType ? current.replyText : view.defaultReply,
            sendMode: current.sendMode || "auto-send",
            followUpMethod: view.defaultType === "customer-follow-up" ? "wechat" : current.followUpMethod,
        }));
    }, [view]);

    const selectedType = taskTypes.find((taskType) => taskType.key === form.type);
    const availableSendModes = sendModes;
    const isDesktopRoute = ["wechat", "groups"].includes(route);
    const readyAccounts =
        route === "customers" || isDesktopRoute
            ? []
            : browserStatus?.accounts.filter(
                (account) => account.status === "ready" && account.type === view.platformType,
            ) || [];
    const hasSelectedLocalAccount = Boolean(form.accountId);
    const selectedExecutor = React.useMemo(
        () => executorsStatus?.executors.find((executor) => executor.key === form.type),
        [executorsStatus?.executors, form.type],
    );
    const blockers = React.useMemo(() => {
        const items: LocalEngineActionBlocker[] = [];
        const platform = view.platformLabel;
        const account = form.accountName || "未选择账号";
        const target = form.targetName || view.defaultTarget;
        if (route !== "customers" && !isDesktopRoute && !readyAccounts.length) {
            items.push({
                platform,
                account: "无可用本机登录账号",
                target,
                stage: "创建真实平台任务",
                reason: `${platform}没有可用登录账号，不能创建会被误认为可执行的真实任务。`,
                nextAction: "先到发布中心-平台账号完成登录或重登，再回来创建任务。",
                capability: "account",
            });
        }
        if (route !== "customers" && !isDesktopRoute && !hasSelectedLocalAccount) {
            items.push({
                platform,
                account,
                target,
                stage: "账号选择",
                reason: "真实平台任务必须绑定一个已登录账号。",
                nextAction: "从账号下拉框选择可用账号；若列表为空，请先登录平台账号。",
                capability: "account",
            });
        }
        if (route !== "customers" && (!selectedExecutor || selectedExecutor.status !== "ready")) {
            items.push({
                platform,
                account,
                target,
                stage: "服务能力",
                reason: selectedExecutor
                    ? `${selectedExecutor.name}当前为"${executorStatusLabel(selectedExecutor.status)}"，还不能真实读取对象并受控发送。`
                    : "没有读取到该任务类型的互动服务。",
                nextAction: selectedExecutor?.nextAction || "请到运行检查里重新检查客户互动可用性。",
                capability: "executor",
            });
        }
        return items;
    }, [form.accountName, form.targetName, hasSelectedLocalAccount, isDesktopRoute, readyAccounts.length, route, selectedExecutor, view.defaultTarget, view.platformLabel]);
    const canSubmit = blockers.length === 0;

    const handleSubmit = async () => {
        if (!canSubmit) {
            addToast({
                title: "任务创建已阻断",
                description: blockers[0]?.nextAction || "请先补齐账号和执行权限。",
                color: "warning",
            });
            return;
        }
        setSubmitting(true);
        try {
            const batchTargets = parseBatchTargets(batchText, view.defaultTarget, form.replyText);
            const payload: CreateInteractionTaskInput = {
                ...form,
                batchTargets: batchTargets.length ? batchTargets : undefined,
                targetName: batchTargets[0]?.targetName || form.targetName,
                sourceText: batchTargets[0]?.sourceText || form.sourceText,
                replyText: batchTargets[0]?.replyText || form.replyText,
            };
            const task = await localEngineApi.createBusinessTask(route, payload);
            addToast({ title: "互动任务已创建", description: task.typeLabel, color: "success" });
            onCreated();
        } catch (e: unknown) {
            addToast({
                title: "创建失败",
                description: formatFailureContext({
                    platform: view.platformLabel,
                    account: form.accountName || "未选择账号",
                    target: form.targetName || view.defaultTarget,
                    stage: "创建互动任务",
                    reason: e instanceof Error ? e.message : "请稍后重试",
                    nextAction: "检查平台账号、本机助手和客户互动可用性后重试。",
                }),
                color: "danger",
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div>
                    <h3 className="text-medium font-semibold text-default-900">{view.title}</h3>
                    <p className="mt-1 text-small text-default-500">
                        {view.subtitle}
                    </p>
                    {selectedType ? (
                        <p className="mt-2 text-tiny text-default-400">{selectedType.helper}</p>
                    ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Select
                        label="任务类型"
                        selectedKeys={[form.type || view.defaultType]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionTaskType | undefined;
                            if (value) setForm((current) => ({ ...current, type: value }));
                        }}
                    >
                        {taskTypes
                            .filter((taskType) => taskType.key === view.defaultType)
                            .map((taskType) => (
                            <SelectItem key={taskType.key}>{taskType.label}</SelectItem>
                        ))}
                    </Select>
                        <Select
                            label="发送模式"
                        selectedKeys={[form.sendMode || "auto-send"]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionSendMode | undefined;
                            if (value) setForm((current) => ({ ...current, sendMode: value }));
                        }}
                    >
                        {availableSendModes.map((mode) => (
                            <SelectItem key={mode.key}>{mode.label}</SelectItem>
                        ))}
                    </Select>
                    {readyAccounts.length ? (
                        <Select
                            label={`${view.platformLabel}账号`}
                            placeholder="选择本地已登录账号"
                            selectedKeys={form.accountId ? [form.accountId] : []}
                            onSelectionChange={(keys) => {
                                const value = Array.from(keys)[0] as string | undefined;
                                const account = readyAccounts.find((item) => String(item.id) === value);
                                setForm((current) => ({
                                    ...current,
                                    accountId: value,
                                    accountName: account?.displayName || current.accountName,
                                    platformType: account?.type || view.platformType,
                                    platformName: account?.platform || view.platformLabel,
                                }));
                            }}
                        >
                            {readyAccounts.map((account) => (
                                <SelectItem key={String(account.id)}>
                                    {account.platform} · {account.displayName}
                                </SelectItem>
                            ))}
                        </Select>
                    ) : (
                        <Input
                            label={`${view.platformLabel}账号`}
                            value={form.accountName || ""}
                            isDisabled={route !== "customers" && !isDesktopRoute}
                            description={
                                isDesktopRoute
                                    ? "桌面微信任务使用本机微信，不需要平台账号。"
                                    : 
                                route === "customers"
                                    ? "客户跟进默认转为桌面微信跟进发送。"
                                    : `暂无可用${view.platformLabel}账号，不能创建真实任务。请先到发布中心-平台账号登录。`
                            }
                            onValueChange={(value) =>
                                setForm((current) => ({
                                    ...current,
                                    accountName: value,
                                    platformType: view.platformType,
                                    platformName: view.platformLabel,
                                }))
                            }
                        />
                    )}
                    <Input
                        label="目标对象"
                        value={form.targetName || ""}
                        onValueChange={(value) => setForm((current) => ({ ...current, targetName: value }))}
                    />
                </div>
                <Textarea
                    label={view.sourceLabel}
                    minRows={3}
                    value={form.sourceText || ""}
                    onValueChange={(value) => setForm((current) => ({ ...current, sourceText: value }))}
                />
                <Textarea
                    label={view.replyLabel}
                    minRows={3}
                    value={form.replyText || ""}
                    onValueChange={(value) => setForm((current) => ({ ...current, replyText: value }))}
                />
                {isDesktopRoute ? (
                    <div className="rounded-[10px] border-small border-success-200 bg-success-50 p-3 text-small text-success-700">
                        <p className="font-semibold">桌面微信执行</p>
                        <p className="mt-1">
                            默认自动发送；选择确认后发送才停在发送前。目标、内容、窗口或权限不明确时会直接阻断，不会伪造成功。
                        </p>
                    </div>
                ) : null}
                {selectedExecutor ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-3 text-small text-default-600">
                        <div className="flex flex-wrap items-center gap-2">
                            <ExecutorStatusChip status={selectedExecutor.status} />
                            <span className="font-semibold text-default-900">{selectedExecutor.name}</span>
                        </div>
                        <p className="mt-1">{selectedExecutor.message}</p>
                        <p className="mt-1 text-tiny text-default-500">下一步：{selectedExecutor.nextAction}</p>
                    </div>
                ) : null}
                {blockers.length ? <ActionBlockerList blockers={blockers} /> : null}
                <Textarea
                    label="批量对象（可选）"
                    minRows={4}
                    value={batchText}
                    description="每行一个对象；支持“客户名｜留言内容”，不写客户名时会自动编号。"
                    placeholder={`张女士｜想了解今天还能预约吗？\n李先生｜价格大概多少？`}
                    onValueChange={setBatchText}
                />
                <div className="flex justify-end">
                    <Button
                        color="primary"
                        isDisabled={!canSubmit}
                        isLoading={submitting}
                        startContent={submitting ? null : <Icon icon="solar:play-circle-linear" />}
                        onPress={handleSubmit}
                    >
                    {canSubmit ? (route === "customers" ? "创建并微信跟进" : "打开入口并创建任务") : "已阻断，先处理条件"}
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function TasksPanel({
    tasks,
    loading,
    onRefresh,
    recordsOnly,
}: {
    tasks: InteractionTask[];
    loading: boolean;
    onRefresh: () => Promise<void>;
    recordsOnly?: boolean;
}) {
    const visibleTasks = recordsOnly
        ? tasks.filter((task) => ["completed", "failed", "skipped", "no_target"].includes(task.status))
        : tasks;
    const [pendingApprovalTask, setPendingApprovalTask] = React.useState<InteractionTask | null>(null);
    const [approvalDraft, setApprovalDraft] = React.useState({
        currentWindowConfirmed: false,
        contactConfirmed: false,
        draftBeforeFillConfirmed: false,
        targetContact: "",
        targetConfirmed: true,
        contentConfirmed: true,
        checklistConfirmed: false,
        commercialPermissionConfirmed: false,
        misfireProtectionConfirmed: false,
        doubleConfirmationConfirmed: false,
        note: "",
    });
    const [approving, setApproving] = React.useState(false);

    const handleAction = async (task: InteractionTask, action: "approve" | "skip" | "fail" | "retry") => {
        if (action === "approve" && task.blockers?.length) {
            addToast({
                title: "确认已阻断",
                description: task.blockers[0].nextAction,
                color: "warning",
            });
            return;
        }
        if (action === "approve") {
            setPendingApprovalTask(task);
            setApprovalDraft({
                currentWindowConfirmed: !isDesktopInteractionTask(task.type),
                contactConfirmed: !isDesktopInteractionTask(task.type),
                draftBeforeFillConfirmed: !isDesktopInteractionTask(task.type),
                targetContact: isDesktopInteractionTask(task.type) ? task.targetName : "",
                targetConfirmed: true,
                contentConfirmed: true,
                checklistConfirmed: false,
                commercialPermissionConfirmed: task.safetyBoundary?.permissionStatus === "allowed",
                misfireProtectionConfirmed: false,
                doubleConfirmationConfirmed: !task.requiresDoubleConfirmation,
                note: "",
            });
            return;
        }
        try {
            if (action === "skip") await localEngineApi.skipTask(task.id);
            if (action === "fail") await localEngineApi.failTask(task.id, "用户停止任务");
            if (action === "retry") {
                const retryTask = await localEngineApi.retryTask(task.id);
                addToast({
                    title: "已创建重试任务",
                    description: retryTask.typeLabel,
                    color: "success",
                });
            }
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "操作失败",
                description: formatFailureContext({
                    platform: task.platformName || task.typeLabel,
                    account: task.accountName,
                    target: task.targetName,
                    stage: task.diagnostics?.currentStep || task.statusLabel,
                    reason: e instanceof Error ? e.message : "请稍后重试",
                    nextAction: task.nextAction || "刷新任务状态，检查账号/服务/权限后重试。",
                }),
                color: "danger",
            });
        }
    };

    const confirmApproval = async () => {
        if (!pendingApprovalTask) return;
        if (pendingApprovalTask.blockers?.length) {
            addToast({
                title: "确认已阻断",
                description: pendingApprovalTask.blockers[0].nextAction,
                color: "warning",
            });
            return;
        }
        setApproving(true);
        try {
            await localEngineApi.approveTask(pendingApprovalTask.id, {
                operator: "当前登录用户",
                currentWindowConfirmed: approvalDraft.currentWindowConfirmed,
                contactConfirmed: approvalDraft.contactConfirmed,
                draftBeforeFillConfirmed: approvalDraft.draftBeforeFillConfirmed,
                targetContact: approvalDraft.targetContact,
                targetConfirmed: approvalDraft.targetConfirmed,
                contentConfirmed: approvalDraft.contentConfirmed,
                checklistConfirmed: approvalDraft.checklistConfirmed,
                commercialPermissionConfirmed: approvalDraft.commercialPermissionConfirmed,
                misfireProtectionConfirmed: approvalDraft.misfireProtectionConfirmed,
                doubleConfirmationConfirmed: approvalDraft.doubleConfirmationConfirmed,
                note: approvalDraft.note,
            });
            setPendingApprovalTask(null);
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "确认失败",
                description: formatFailureContext({
                    platform: pendingApprovalTask.platformName || pendingApprovalTask.typeLabel,
                    account: pendingApprovalTask.accountName,
                    target: pendingApprovalTask.targetName,
                    stage: "确认填入草稿",
                    reason: e instanceof Error ? e.message : "请稍后重试",
                    nextAction: pendingApprovalTask.nextAction || "重新核对窗口、目标和草稿内容后再确认。",
                }),
                color: "danger",
            });
        } finally {
            setApproving(false);
        }
    };

    return (
        <>
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">
                            {recordsOnly ? "回复记录" : "互动任务"}
                        </h3>
                        <p className="mt-1 text-small text-default-500">
                            显示每条互动任务的阶段、结果、证据和下一步动作。
                        </p>
                    </div>
                    <Button
                        variant="flat"
                        isLoading={loading}
                        startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                        onPress={() => {
                            onRefresh().catch(() => {
                                addToast({ title: "刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新
                    </Button>
                </div>
                <div className="grid gap-4">
                    {visibleTasks.map((task) => (
                        <TaskCard key={task.id} task={task} onAction={handleAction} />
                    ))}
                    {!loading && !visibleTasks.length ? (
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                            暂无{recordsOnly ? "回复记录" : "互动任务"}。
                        </div>
                    ) : null}
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Spinner size="sm" />
                        </div>
                    ) : null}
                </div>
                </CardBody>
            </Card>
            <ApprovalConfirmModal
                isOpen={Boolean(pendingApprovalTask)}
                isLoading={approving}
                task={pendingApprovalTask}
                draft={approvalDraft}
                onDraftChange={setApprovalDraft}
                onClose={() => {
                    if (!approving) setPendingApprovalTask(null);
                }}
                onConfirm={confirmApproval}
            />
        </>
    );
}

function ApprovalConfirmModal({
    isOpen,
    isLoading,
    task,
    draft,
    onDraftChange,
    onClose,
    onConfirm,
}: {
    isOpen: boolean;
    isLoading: boolean;
    task: InteractionTask | null;
    draft: {
        currentWindowConfirmed: boolean;
        contactConfirmed: boolean;
        draftBeforeFillConfirmed: boolean;
        targetContact: string;
        targetConfirmed: boolean;
        contentConfirmed: boolean;
        checklistConfirmed: boolean;
        commercialPermissionConfirmed: boolean;
        misfireProtectionConfirmed: boolean;
        doubleConfirmationConfirmed: boolean;
        note: string;
    };
    onDraftChange: React.Dispatch<React.SetStateAction<{
        currentWindowConfirmed: boolean;
        contactConfirmed: boolean;
        draftBeforeFillConfirmed: boolean;
        targetContact: string;
        targetConfirmed: boolean;
        contentConfirmed: boolean;
        checklistConfirmed: boolean;
        commercialPermissionConfirmed: boolean;
        misfireProtectionConfirmed: boolean;
        doubleConfirmationConfirmed: boolean;
        note: string;
    }>>;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}) {
    const isWechatTask = task ? isDesktopInteractionTask(task.type) : false;
    const requiresCommercialPermission = task?.safetyBoundary?.permissionStatus !== "allowed";
    const requiresDoubleConfirmation = Boolean(task?.requiresDoubleConfirmation);

    return (
        <Modal isOpen={isOpen} size="2xl" onOpenChange={(open) => {
            if (!open) onClose();
        }}>
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1">
                    <span>{isWechatTask ? "确认微信会话并填入草稿" : "确认填入草稿"}</span>
                    <span className="text-small font-normal text-default-500">
                        系统只填入草稿，不自动点击发送。
                    </span>
                </ModalHeader>
                <ModalBody>
                    {task ? (
                        <div className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-3">
                                <StatusItem label="平台" value={task.platformName || task.typeLabel} />
                                <StatusItem label="账号" value={task.accountName} />
                                <StatusItem label="目标" value={task.targetName} />
                            </div>
                            <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                                <p className="font-semibold">发送前检查</p>
                                <p className="mt-1">
                                    请确认账号、目标对象和草稿内容无误。确认后系统会把草稿填入对应页面或当前微信会话，最后仍需人工检查并手动发送。
                                </p>
                            </div>
                            {task.safetyBoundary ? (
                                <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                                    <p className="font-semibold">试用/商用边界</p>
                                    <p className="mt-1">{task.safetyBoundary.message}</p>
                                    <p className="mt-2 text-tiny">
                                        当前版本：{task.safetyBoundary.planMode === "commercial" ? "正式商用" : "试用版"}
                                        ；正式商用执行权限：{permissionStatusLabel[task.safetyBoundary.permissionStatus] || task.safetyBoundary.permissionStatus}
                                    </p>
                                </div>
                            ) : null}
                            {task.misfireProtection ? (
                                <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                                    <p className="font-semibold">误发误删保护</p>
                                    <p className="mt-1">{task.misfireProtection.warning}</p>
                                    <p className="mt-2 text-tiny">
                                        发送保护：{task.misfireProtection.sendProtected ? "开启" : "未开启"}
                                        ；删除保护：{task.misfireProtection.deleteProtected ? "开启" : "未开启"}
                                    </p>
                                </div>
                            ) : null}
                            {task.riskChecklist?.length ? (
                                <div className="grid gap-2 md:grid-cols-2">
                                    {task.riskChecklist.map((check) => (
                                        <div key={check.key} className="rounded-small border-small border-divider bg-default-50 p-3 text-small text-default-600">
                                            <div className="flex items-center gap-2">
                                                <Icon icon={check.blocking ? "solar:shield-warning-linear" : "solar:check-circle-linear"} />
                                                <span>{check.label}</span>
                                            </div>
                                            {check.hint ? <p className="mt-1 text-tiny text-default-400">{check.hint}</p> : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {isWechatTask ? (
                                <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                                    <p className="font-semibold">微信会话二次确认</p>
                                    <p className="mt-1">
                                        微信没有网页后台对象锁定，执行前请先把桌面微信切到目标客户会话；系统只会填入草稿，不会替你点击发送。
                                    </p>
                                    <Input
                                        className="mt-3"
                                        label="确认联系人"
                                        placeholder="当前微信会话里的客户名称"
                                        value={draft.targetContact}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            targetContact: value,
                                        }))}
                                    />
                                    <Switch
                                        className="mt-3"
                                        color="danger"
                                        isSelected={draft.currentWindowConfirmed}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            currentWindowConfirmed: value,
                                        }))}
                                    >
                                        我已确认当前微信会话就是目标客户
                                    </Switch>
                                    <Switch
                                        className="mt-3"
                                        color="danger"
                                        isSelected={draft.contactConfirmed}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            contactConfirmed: value,
                                        }))}
                                    >
                                        我已核对联系人/当前窗口标题
                                    </Switch>
                                    <Switch
                                        className="mt-3"
                                        color="danger"
                                        isSelected={draft.draftBeforeFillConfirmed}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            draftBeforeFillConfirmed: value,
                                        }))}
                                    >
                                        我确认现在可以把草稿填入微信输入框
                                    </Switch>
                                </div>
                            ) : null}
                            <div className="grid gap-3 md:grid-cols-2">
                                <Switch
                                    isSelected={draft.targetConfirmed}
                                    onValueChange={(value) => onDraftChange((current) => ({
                                        ...current,
                                        targetConfirmed: value,
                                    }))}
                                >
                                    已确认目标对象
                                </Switch>
                                <Switch
                                    isSelected={draft.contentConfirmed}
                                    onValueChange={(value) => onDraftChange((current) => ({
                                        ...current,
                                        contentConfirmed: value,
                                    }))}
                                >
                                    已确认草稿内容
                                </Switch>
                                <Switch
                                    isSelected={draft.checklistConfirmed}
                                    onValueChange={(value) => onDraftChange((current) => ({
                                        ...current,
                                        checklistConfirmed: value,
                                    }))}
                                >
                                    已逐项核对检查项
                                </Switch>
                                <Switch
                                    isSelected={draft.misfireProtectionConfirmed}
                                    onValueChange={(value) => onDraftChange((current) => ({
                                        ...current,
                                        misfireProtectionConfirmed: value,
                                    }))}
                                >
                                    已确认误发误删保护
                                </Switch>
                                {requiresCommercialPermission ? (
                                    <Switch
                                        isSelected={draft.commercialPermissionConfirmed}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            commercialPermissionConfirmed: value,
                                        }))}
                                    >
                                        已确认试用限制/商用执行权限
                                    </Switch>
                                ) : null}
                                {requiresDoubleConfirmation ? (
                                    <Switch
                                        color="danger"
                                        isSelected={draft.doubleConfirmationConfirmed}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            doubleConfirmationConfirmed: value,
                                        }))}
                                    >
                                        二次确认继续执行
                                    </Switch>
                                ) : null}
                            </div>
                            <Textarea
                                label="确认备注"
                                minRows={2}
                                placeholder="可选，例如：已核对当前窗口和回复内容"
                                value={draft.note}
                                onValueChange={(value) => onDraftChange((current) => ({
                                    ...current,
                                    note: value,
                                }))}
                            />
                            {task.diagnostics ? (
                                <div className="rounded-[10px] border-small border-divider bg-default-50 p-3 text-small text-default-700">
                                    <p className="font-semibold">当前诊断</p>
                                    <p className="mt-1">{task.diagnostics.summary}</p>
                                    <p className="mt-1 text-tiny text-default-500">
                                        卡点：{task.diagnostics.currentStep || "无"} / 证据：{task.diagnostics.evidenceCount} 条
                                    </p>
                                </div>
                            ) : null}
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-[10px] bg-default-50 p-3">
                                    <p className="text-tiny text-default-400">原始内容</p>
                                    <p className="mt-2 whitespace-pre-wrap text-small text-default-700">{task.sourceText}</p>
                                </div>
                                <div className="rounded-[10px] bg-default-50 p-3">
                                    <p className="text-tiny text-default-400">将填入的草稿</p>
                                    <p className="mt-2 whitespace-pre-wrap text-small font-medium text-default-900">{task.replyText}</p>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </ModalBody>
                <ModalFooter>
                    <Button isDisabled={isLoading} variant="flat" onPress={onClose}>
                        取消
                    </Button>
                    <Button
                        color="primary"
                        isDisabled={
                            !draft.targetConfirmed ||
                            !draft.contentConfirmed ||
                            !draft.checklistConfirmed ||
                            !draft.misfireProtectionConfirmed ||
                            (requiresCommercialPermission && !draft.commercialPermissionConfirmed) ||
                            (requiresDoubleConfirmation && !draft.doubleConfirmationConfirmed) ||
                            (isWechatTask && (
                                !draft.currentWindowConfirmed ||
                                !draft.contactConfirmed ||
                                !draft.draftBeforeFillConfirmed ||
                                !draft.targetContact.trim()
                            ))
                        }
                        isLoading={isLoading}
                        onPress={onConfirm}
                    >
                        确认填入草稿
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}

function RecordsPanel({
    tasks,
    loading,
    summary,
    onRefresh,
}: {
    tasks: InteractionTask[];
    loading: boolean;
    summary: InteractionRecordsSummary;
    onRefresh: (filters: { status: "all" | Extract<InteractionTask["status"], "completed" | "failed" | "skipped" | "no_target">; type: "all" | InteractionTaskType }) => Promise<void>;
}) {
    const [statusFilter, setStatusFilter] = React.useState<"all" | Extract<InteractionTask["status"], "completed" | "failed" | "skipped" | "no_target">>("all");
    const [typeFilter, setTypeFilter] = React.useState<"all" | InteractionTaskType>("all");
    const [selectedTask, setSelectedTask] = React.useState<InteractionTask | null>(null);
    const [exporting, setExporting] = React.useState(false);
    const [cleanupPreview, setCleanupPreview] = React.useState<InteractionEvidenceCleanupResult | null>(null);
    const [retentionDays, setRetentionDays] = React.useState("7");
    const [cleanupLoading, setCleanupLoading] = React.useState(false);

    const refreshWithCurrentFilters = React.useCallback(
        (nextFilters?: Partial<{ status: typeof statusFilter; type: typeof typeFilter }>) =>
            onRefresh({
                status: nextFilters?.status || statusFilter,
                type: nextFilters?.type || typeFilter,
            }),
        [onRefresh, statusFilter, typeFilter],
    );

    const handleExport = React.useCallback(async () => {
        setExporting(true);
        try {
            const result = await localEngineApi.exportRecords({
                status: statusFilter === "all" ? undefined : statusFilter,
                type: typeFilter === "all" ? undefined : typeFilter,
            });
            const blob = new Blob([result.content], { type: result.mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = result.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            addToast({
                title: "导出完成",
                description: `已导出 ${result.summary.total} 条回复记录`,
                color: "success",
            });
        } catch (e: unknown) {
            addToast({
                title: "导出失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setExporting(false);
        }
    }, [statusFilter, typeFilter]);

    const previewCleanup = React.useCallback(async () => {
        setCleanupLoading(true);
        try {
            const result = await localEngineApi.previewEvidenceCleanup(Number(retentionDays) || 7);
            setCleanupPreview(result);
        } catch (e: unknown) {
            addToast({
                title: "证据清理预览失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCleanupLoading(false);
        }
    }, [retentionDays]);

    const runCleanup = React.useCallback(async () => {
        setCleanupLoading(true);
        try {
            const result = await localEngineApi.cleanupEvidence(Number(retentionDays) || 7);
            setCleanupPreview(result);
            addToast({
                title: "证据清理完成",
                description: `已清理 ${result.deletedCount} 个文件`,
                color: "success",
            });
        } catch (e: unknown) {
            addToast({
                title: "证据清理失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setCleanupLoading(false);
        }
    }, [retentionDays]);

    return (
        <>
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">回复记录</h3>
                            <p className="mt-1 text-small text-default-500">
                                按任务结果查看每次互动回复，重点看状态、失败原因、证据和更新时间。
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="flat"
                                isLoading={exporting}
                                startContent={exporting ? null : <Icon icon="solar:download-minimalistic-linear" />}
                                onPress={handleExport}
                            >
                                导出 CSV
                            </Button>
                            <Button
                                variant="flat"
                                isLoading={loading}
                                startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                                onPress={() => {
                                    refreshWithCurrentFilters().catch(() => {
                                        addToast({ title: "刷新失败", color: "danger" });
                                    });
                                }}
                            >
                                刷新
                            </Button>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-6">
                        <StatusItem label="全部记录" value={String(summary.total)} />
                        <StatusItem label="已完成" value={String(summary.completed)} />
                        <StatusItem label="失败" value={String(summary.failed)} />
                        <StatusItem label="已跳过" value={String(summary.skipped)} />
                        <StatusItem label="无对象" value={String(summary.noTarget)} />
                        <StatusItem label="证据数" value={String(summary.evidenceCount)} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-[220px_220px_1fr] md:items-end">
                        <Select
                            label="状态"
                            selectedKeys={[statusFilter]}
                            size="sm"
                            onSelectionChange={(keys) => {
                                const value = Array.from(keys)[0] as typeof statusFilter | undefined;
                                if (value) {
                                    setStatusFilter(value);
                                    onRefresh({ status: value, type: typeFilter }).catch(() => {
                                        addToast({ title: "筛选失败", color: "danger" });
                                    });
                                }
                            }}
                        >
                            <SelectItem key="all">全部状态</SelectItem>
                            <SelectItem key="completed">已完成</SelectItem>
                            <SelectItem key="failed">失败</SelectItem>
                            <SelectItem key="skipped">已跳过</SelectItem>
                            <SelectItem key="no_target">无对象</SelectItem>
                        </Select>
                        <Select
                            label="类型"
                            selectedKeys={[typeFilter]}
                            size="sm"
                            onSelectionChange={(keys) => {
                                const value = Array.from(keys)[0] as typeof typeFilter | undefined;
                                if (value) {
                                    setTypeFilter(value);
                                    onRefresh({ status: statusFilter, type: value }).catch(() => {
                                        addToast({ title: "筛选失败", color: "danger" });
                                    });
                                }
                            }}
                        >
                            <SelectItem key="all">全部类型</SelectItem>
                            <SelectItem key="douyin-comment-reply">抖音评论回复</SelectItem>
                            <SelectItem key="douyin-direct-message-reply">抖音私信回复</SelectItem>
                            <SelectItem key="wechat-channel-comment-reply">视频号评论回复</SelectItem>
                            <SelectItem key="wechat-channel-direct-message-reply">视频号私信回复</SelectItem>
                            <SelectItem key="customer-follow-up">客户跟进</SelectItem>
                        </Select>
                        <p className="text-small text-default-500">
                            当前显示 {tasks.length} 条，点击“详情”查看阶段日志和截图证据。
                            {summary.lastUpdatedAt ? ` 最近更新：${formatDate(summary.lastUpdatedAt)}` : ""}
                        </p>
                    </div>

                    <Table
                        aria-label="回复记录表"
                        classNames={{
                            wrapper: "border-small border-divider shadow-none",
                            th: "bg-default-50 text-default-500",
                        }}
                    >
                        <TableHeader>
                            <TableColumn>状态</TableColumn>
                            <TableColumn>类型 / 平台</TableColumn>
                            <TableColumn>账号 / 目标</TableColumn>
                            <TableColumn>摘要</TableColumn>
                            <TableColumn>证据</TableColumn>
                            <TableColumn>更新时间</TableColumn>
                            <TableColumn>操作</TableColumn>
                        </TableHeader>
                        <TableBody
                            emptyContent={loading ? "正在读取回复记录..." : "暂无回复记录。"}
                            items={tasks}
                        >
                            {(task) => (
                                <TableRow key={task.id}>
                                    <TableCell>
                                        <StatusChip status={task.status} label={task.statusLabel} />
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            <p className="text-small font-medium text-default-800">{task.typeLabel}</p>
                                            <p className="text-tiny text-default-400">{task.platformName || "本地互动"}</p>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="max-w-[190px] space-y-1">
                                            <p className="truncate text-small text-default-800">{task.accountName}</p>
                                            <p className="truncate text-tiny text-default-400">
                                                {(task.batchTargets?.length || 0) > 1
                                                    ? `批量 ${task.batchTargets?.length} 条，首条：${task.targetName}`
                                                    : task.targetName}
                                            </p>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="max-w-[320px] space-y-1">
                                            <p className="truncate text-small text-default-700">
                                                {task.resultSummary?.headline || task.failureReason || task.diagnostics?.summary || task.nextAction || "已记录互动结果"}
                                            </p>
                                            <p className="truncate text-tiny text-default-400">
                                                {task.resultSummary?.nextAction || task.replyText}
                                            </p>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="sm" variant="flat">
                                            {task.events.filter((event) => event.evidence).length} 条
                                        </Chip>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-tiny text-default-500">{formatDate(task.completedAt || task.updatedAt)}</span>
                                    </TableCell>
                                    <TableCell>
                                        <Button size="sm" variant="flat" onPress={() => setSelectedTask(task)}>
                                            详情
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardBody>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">证据文件治理</h3>
                            <p className="mt-1 text-small text-default-500">
                                只清理本机互动证据目录里的旧截图和快照，不删除回复记录。
                            </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                            <Input
                                className="w-32"
                                label="保留天数"
                                min={0}
                                size="sm"
                                type="number"
                                value={retentionDays}
                                onValueChange={setRetentionDays}
                            />
                            <Button
                                variant="flat"
                                isLoading={cleanupLoading}
                                startContent={cleanupLoading ? null : <Icon icon="solar:eye-linear" />}
                                onPress={previewCleanup}
                            >
                                预览清理
                            </Button>
                            <Button
                                color="danger"
                                variant="flat"
                                isDisabled={!cleanupPreview?.candidateCount}
                                isLoading={cleanupLoading}
                                startContent={cleanupLoading ? null : <Icon icon="solar:trash-bin-trash-linear" />}
                                onPress={runCleanup}
                            >
                                清理旧证据
                            </Button>
                        </div>
                    </div>

                    {cleanupPreview ? (
                        <div className="grid gap-3 md:grid-cols-4">
                            <StatusItem label="证据目录文件" value={String(cleanupPreview.status.fileCount)} />
                            <StatusItem label="目录大小" value={formatBytes(cleanupPreview.status.totalBytes)} />
                            <StatusItem
                                label={cleanupPreview.execute ? "已清理" : "可清理"}
                                value={`${cleanupPreview.execute ? cleanupPreview.deletedCount : cleanupPreview.candidateCount} 个`}
                            />
                            <StatusItem label="预计释放" value={formatBytes(cleanupPreview.totalBytes)} />
                        </div>
                    ) : (
                        <div className="rounded-small bg-default-50 p-3 text-small text-default-500">
                            先点击“预览清理”，确认旧证据数量和大小后再执行清理。
                        </div>
                    )}
                    {cleanupPreview?.directory ? (
                        <p className="break-all text-tiny text-default-400">目录：{cleanupPreview.directory}</p>
                    ) : null}
                    {cleanupPreview?.files?.length ? (
                        <div className="max-h-44 overflow-auto rounded-small border-small border-divider bg-default-50 p-3">
                            {cleanupPreview.files.slice(0, 8).map((file) => (
                                <div key={file.path} className="flex flex-col gap-1 border-b border-divider py-2 last:border-0 md:flex-row md:items-center md:justify-between">
                                    <span className="break-all text-small text-default-700">{file.name}</span>
                                    <span className="text-tiny text-default-400">
                                        {formatBytes(file.sizeBytes)} / {formatDate(file.updatedAt)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {cleanupPreview?.errors?.length ? (
                        <div className="rounded-small bg-danger-50 p-3 text-small text-danger-700">
                            {cleanupPreview.errors.join("；")}
                        </div>
                    ) : null}
                </CardBody>
            </Card>

            <Modal isOpen={Boolean(selectedTask)} size="5xl" scrollBehavior="inside" onOpenChange={(open) => {
                if (!open) setSelectedTask(null);
            }}>
                <ModalContent>
                    <ModalHeader className="flex flex-col gap-1">
                        <span>回复记录详情</span>
                        <span className="text-small font-normal text-default-500">
                            查看阶段、诊断、原文、草稿和证据。
                        </span>
                    </ModalHeader>
                    <ModalBody>
                        {selectedTask ? <TaskCard task={selectedTask} onAction={async () => undefined} /> : null}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="flat" onPress={() => setSelectedTask(null)}>
                            关闭
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}

function TaskCard({
    task,
    onAction,
}: {
    task: InteractionTask;
    onAction: (task: InteractionTask, action: "approve" | "skip" | "fail" | "retry") => Promise<void>;
}) {
    const canDecide = ["queued", "running", "waiting_for_send_confirmation"].includes(task.status);
    const canRetry = ["failed", "skipped"].includes(task.status);
    const diagnostics = task.diagnostics;
    const resultSummary = task.resultSummary;
    const isBatchTask = (task.batchTargets?.length || 0) > 1;
    const failureContext = deriveTaskFailureContext(task);
    const [exportingDiagnostics, setExportingDiagnostics] = React.useState(false);
    const diagnosticTone =
        diagnostics?.status === "blocked"
            ? "border-danger-200 bg-danger-50 text-danger-700"
            : diagnostics?.status === "waiting"
                ? "border-warning-200 bg-warning-50 text-warning-700"
                : diagnostics?.status === "completed"
                    ? "border-success-200 bg-success-50 text-success-700"
                    : "border-divider bg-background text-default-700";

    return (
        <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Chip size="sm" variant="flat">{task.typeLabel}</Chip>
                        <Chip color={task.executionMode === "browser-assisted" ? "primary" : "default"} size="sm" variant="flat">
                            {task.executionMode === "browser-assisted" ? "账号后台" : "内部记录"}
                        </Chip>
                        {task.runtimeState ? <RuntimeStateChip state={task.runtimeState} /> : null}
                        {task.platformName ? (
                            <Chip size="sm" variant="flat">{task.platformName}</Chip>
                        ) : null}
                        {resultSummary ? (
                            <Chip color={resultSummaryChipColor(resultSummary.kind)} size="sm" variant="flat">
                                {resultSummary.headline}
                            </Chip>
                        ) : null}
                        {isBatchTask ? (
                            <Chip color="secondary" size="sm" variant="flat">
                                批量 {task.batchTargets?.length} 条
                            </Chip>
                        ) : null}
                        <Chip size="sm" variant="flat">{sendModeLabel(task.sendMode)}</Chip>
                        <StatusChip status={task.status} label={task.statusLabel} />
                    </div>
                    <h4 className="mt-3 text-medium font-semibold text-default-900">
                        {task.accountName} {"->"} {task.targetName}
                    </h4>
                    <p className="mt-1 text-small text-default-500">{task.nextAction || "等待下一步动作"}</p>
                    {task.failureReason ? (
                        <p className="mt-2 text-small text-danger">{task.failureReason}</p>
                    ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        as={Link}
                        href="/confirmations"
                        size="sm"
                        variant="flat"
                        startContent={<Icon icon="solar:check-square-linear" />}
                    >
                        待我确认
                    </Button>
                    <Button
                        as={Link}
                        href={isDesktopInteractionTask(task.type) ? "/local-engine?tab=desktop" : "/local-engine?tab=browser"}
                        size="sm"
                        variant="flat"
                        startContent={<Icon icon={isDesktopInteractionTask(task.type) ? "solar:monitor-linear" : "solar:window-frame-linear"} />}
                    >
                        {isDesktopInteractionTask(task.type) ? "微信桌面检查" : "平台账号检查"}
                    </Button>
                    <Button
                        as={Link}
                        href="/artifacts"
                        size="sm"
                        variant="flat"
                        startContent={<Icon icon="solar:gallery-check-linear" />}
                    >
                        证据
                    </Button>
                    <Button
                        size="sm"
                        variant="flat"
                        isLoading={exportingDiagnostics}
                        startContent={exportingDiagnostics ? null : <Icon icon="solar:download-minimalistic-linear" />}
                        onPress={() => {
                            setExportingDiagnostics(true);
                            localEngineApi.exportTaskDiagnostics(task.id)
                                .then((result) => {
                                    downloadTextFile(result.filename, result.content, result.mimeType);
                                    addToast({
                                        title: "诊断包已导出",
                                        description: result.filename,
                                        color: "success",
                                    });
                                })
                                .catch((e: unknown) => {
                                    addToast({
                                        title: "诊断包导出失败",
                                        description: e instanceof Error ? e.message : "请稍后重试",
                                        color: "danger",
                                    });
                                })
                                .finally(() => setExportingDiagnostics(false));
                        }}
                    >
                        诊断包
                    </Button>
                    {canDecide ? (
                        <>
                        <Button
                            color="primary"
                            size="sm"
                            variant="flat"
                            isDisabled={task.status !== "waiting_for_send_confirmation" || Boolean(task.blockers?.length)}
                            onPress={() => onAction(task, "approve")}
                        >
                            确认
                        </Button>
                        <Button size="sm" variant="flat" onPress={() => onAction(task, "skip")}>
                            跳过
                        </Button>
                        <Button color="danger" size="sm" variant="flat" onPress={() => onAction(task, "fail")}>
                            停止
                        </Button>
                        </>
                    ) : canRetry ? (
                        <Button
                            color="primary"
                            size="sm"
                            variant="flat"
                            startContent={<Icon icon="solar:restart-linear" />}
                            onPress={() => onAction(task, "retry")}
                        >
                            重试
                        </Button>
                    ) : null}
                </div>
            </div>
            {task.blockers?.length ? <ActionBlockerList blockers={task.blockers} /> : null}
            {failureContext ? <FailureContextBox context={failureContext} /> : null}
            {diagnostics ? (
                <div className={`mt-4 rounded-[10px] border-small p-3 ${diagnosticTone}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="text-small font-semibold">执行诊断</p>
                            <p className="mt-1 text-small">{diagnostics.summary}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-tiny md:min-w-[320px]">
                            <span>平台：{diagnostics.platform}</span>
                            <span>账号：{diagnostics.account}</span>
                            <span>卡点：{diagnostics.currentStep || "无"}</span>
                            <span>证据：{diagnostics.evidenceCount} 条</span>
                        </div>
                    </div>
                    {diagnostics.failureReason ? (
                        <p className="mt-2 text-tiny">失败原因：{diagnostics.failureReason}</p>
                    ) : null}
                    {diagnostics.nextAction ? (
                        <p className="mt-1 text-tiny">下一步：{diagnostics.nextAction}</p>
                    ) : null}
                </div>
            ) : null}
            {resultSummary ? (
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-center">
                    <div className={`rounded-[10px] border-small p-3 ${resultSummaryTone(resultSummary.kind)}`}>
                        <p className="text-small font-semibold">{resultSummary.headline}</p>
                        <p className="mt-1 text-tiny">{resultSummary.detail}</p>
                    </div>
                    <div className="rounded-[10px] border-small border-divider bg-background p-3 text-small text-default-700">
                        <p className="font-semibold">下一步建议</p>
                        <p className="mt-1 text-tiny text-default-500">{resultSummary.nextAction}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button as={Link} href={resultSummary.recordsHref} size="sm" variant="flat">
                            执行记录
                        </Button>
                        <Button as={Link} href={resultSummary.evidenceHref} size="sm" variant="flat">
                            证据
                        </Button>
                    </div>
                </div>
            ) : null}
            {task.safetyBoundary || task.riskPolicy || task.misfireProtection ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {task.safetyBoundary ? (
                        <div className="rounded-[10px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                            <p className="font-semibold">试用/商用权限</p>
                            <p className="mt-1">{task.safetyBoundary.message}</p>
                            <p className="mt-1 text-tiny">
                                {task.safetyBoundary.planMode === "commercial" ? "正式商用" : "试用版"}
                                ；{permissionStatusLabel[task.safetyBoundary.permissionStatus] || task.safetyBoundary.permissionStatus}
                            </p>
                        </div>
                    ) : null}
                    {task.riskPolicy ? (
                        <div className="rounded-[10px] border-small border-divider bg-background p-3 text-small text-default-700">
                            <p className="font-semibold text-default-900">角色/白名单/禁止动作</p>
                            <p className="mt-1">{task.riskPolicy.message}</p>
                            <p className="mt-1 text-tiny text-default-500">
                                审批角色：{task.riskPolicy.requiredRole}
                                ；白名单：{(task.riskPolicy.whitelistTargets || []).join("、") || "-"}
                            </p>
                            {(task.riskPolicy.forbiddenActions || []).length ? (
                                <p className="mt-1 text-tiny text-danger-600">禁止动作：{(task.riskPolicy.forbiddenActions || []).join("、")}</p>
                            ) : null}
                        </div>
                    ) : null}
                    {task.misfireProtection ? (
                        <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                            <p className="font-semibold">误发误删保护</p>
                            <p className="mt-1">{task.misfireProtection.warning}</p>
                            <p className="mt-1 text-tiny">
                                发送：{task.misfireProtection.sendProtected ? "开启" : "关闭"}
                                ；删除：{task.misfireProtection.deleteProtected ? "开启" : "关闭"}
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : null}
            {task.approvalRecord ? (
                <div className="mt-4 rounded-[10px] border-small border-primary-200 bg-primary-50 p-3 text-small text-primary-700">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="font-semibold">人工确认记录</p>
                            <p className="mt-1">
                                {task.approvalRecord.operator} 于 {formatDate(task.approvalRecord.confirmedAt)} 确认。
                            </p>
                            {task.approvalRecord.note ? (
                                <p className="mt-1 text-tiny">{task.approvalRecord.note}</p>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-tiny md:min-w-[320px]">
                            <span>目标：{task.approvalRecord.targetConfirmed ? "已确认" : "未确认"}</span>
                            <span>内容：{task.approvalRecord.contentConfirmed ? "已确认" : "未确认"}</span>
                            <span>窗口：{task.approvalRecord.currentWindowConfirmed ? "已确认" : "未确认"}</span>
                            {isDesktopInteractionTask(task.type) ? (
                                <>
                                    <span>联系人：{task.approvalRecord.contactConfirmed ? "已确认" : "未确认"}</span>
                                    <span>填入前：{task.approvalRecord.draftBeforeFillConfirmed ? "已确认" : "未确认"}</span>
                                    <span>对象：{task.approvalRecord.targetContact || task.targetName}</span>
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
            <Divider className="my-4" />
            {isBatchTask ? (
                <>
                    <div className="rounded-small bg-background p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <p className="text-small font-semibold text-default-800">批量对象</p>
                            <div className="flex flex-wrap gap-2">
                                <Chip size="sm" variant="flat">共 {task.batchSummary?.total || task.batchTargets?.length || 0} 条</Chip>
                                <Chip color="success" size="sm" variant="flat">完成 {task.batchSummary?.completed || 0}</Chip>
                                <Chip color="danger" size="sm" variant="flat">失败 {task.batchSummary?.failed || 0}</Chip>
                                <Chip color="warning" size="sm" variant="flat">跳过 {task.batchSummary?.skipped || 0}</Chip>
                                <Chip color="default" size="sm" variant="flat">无对象 {task.batchSummary?.noTarget || 0}</Chip>
                            </div>
                        </div>
                        {(() => {
                            const total = task.batchSummary?.total || task.batchTargets?.length || 0;
                            const completed = task.batchSummary?.completed || 0;
                            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                            return (
                                <div className="mt-3">
                                    <div className="flex items-center justify-between text-tiny text-default-500 mb-1">
                                        <span>进度 {completed}/{total}</span>
                                        <span>{pct}%</span>
                                    </div>
                                    <Progress aria-label="批量进度" value={pct} color={pct === 100 ? "success" : "primary"} size="sm" />
                                </div>
                            );
                        })()}
                        {canDecide ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                    size="sm"
                                    variant="flat"
                                    color="warning"
                                    startContent={<Icon icon="solar:pause-circle-linear" />}
                                    onPress={async () => {
                                        try {
                                            await localEngineApi.pauseTask(task.id);
                                            addToast({ title: "任务已暂停", color: "warning" });
                                        } catch (e: unknown) {
                                            addToast({ title: "暂停失败", description: e instanceof Error ? e.message : "请稍后重试", color: "danger" });
                                        }
                                    }}
                                >
                                    暂停
                                </Button>
                                <Button
                                    size="sm"
                                    variant="flat"
                                    color="primary"
                                    startContent={<Icon icon="solar:play-circle-linear" />}
                                    onPress={async () => {
                                        try {
                                            await localEngineApi.resumeTask(task.id);
                                            addToast({ title: "任务已继续", color: "success" });
                                        } catch (e: unknown) {
                                            addToast({ title: "继续失败", description: e instanceof Error ? e.message : "请稍后重试", color: "danger" });
                                        }
                                    }}
                                >
                                    继续
                                </Button>
                                <Button
                                    size="sm"
                                    variant="flat"
                                    startContent={<Icon icon="solar:forward-2-linear" />}
                                    onPress={() => onAction(task, "skip")}
                                >
                                    跳过当前
                                </Button>
                            </div>
                        ) : null}
                        <div className="mt-3 grid gap-2">
                            {task.batchTargets?.slice(0, 10).map((target, index) => (
                                <div key={target.id} className="rounded-small border-small border-divider bg-default-50 p-3">
                                    <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                                        <p className="text-small font-medium text-default-800">
                                            {index + 1}. {target.targetName}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <StatusChip status={targetStatusToTaskStatus(target.status)} label={targetStatusLabel(target.status)} />
                                            {target.status === "failed" ? (
                                                <Button
                                                    size="sm"
                                                    variant="flat"
                                                    color="primary"
                                                    startContent={<Icon icon="solar:restart-linear" />}
                                                    onPress={async () => {
                                                        try {
                                                            await localEngineApi.retryTask(task.id);
                                                            addToast({ title: "已提交重试", color: "success" });
                                                        } catch (e: unknown) {
                                                            addToast({ title: "重试失败", description: e instanceof Error ? e.message : "请稍后重试", color: "danger" });
                                                        }
                                                    }}
                                                >
                                                    重试
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                    <p className="mt-2 text-tiny text-default-500">{target.sourceText}</p>
                                    <p className="mt-1 text-tiny text-default-700">{target.replyText}</p>
                                    {target.failureReason ? (
                                        <p className="mt-1 text-tiny text-danger">{target.failureReason}</p>
                                    ) : null}
                                </div>
                            ))}
                            {(task.batchTargets?.length || 0) > 10 ? (
                                <p className="text-tiny text-default-400">还有 {(task.batchTargets?.length || 0) - 10} 条，可在 CSV 导出中查看完整明细。</p>
                            ) : null}
                        </div>
                    </div>
                    <Divider className="my-4" />
                </>
            ) : null}
            {task.steps?.length ? (
                <>
                    <div className="grid gap-2 md:grid-cols-3">
                        {task.steps.map((step) => (
                            <div key={step.key} className="rounded-small bg-background p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-tiny font-medium text-default-700">{step.label}</span>
                                    <StepStatusChip status={step.status} />
                                </div>
                                <p className="mt-2 text-tiny text-default-500">{step.message}</p>
                            </div>
                        ))}
                    </div>
                    <Divider className="my-4" />
                </>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-small bg-background p-3">
                    <p className="text-tiny text-default-400">原始内容</p>
                    <p className="mt-1 text-small text-default-700">{task.sourceText}</p>
                </div>
                <div className="rounded-small bg-background p-3">
                    <p className="text-tiny text-default-400">回复内容</p>
                    <p className="mt-1 text-small text-default-700">{task.replyText}</p>
                </div>
            </div>
            {["completed", "failed", "skipped", "no_target"].includes(task.status) ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <StatusItem label="完成时间" value={formatDate(task.completedAt)} />
                    <StatusItem label="更新时间" value={formatDate(task.updatedAt)} />
                    <StatusItem label="执行方式" value={task.executionMode === "browser-assisted" ? "本机账号后台" : "内部记录"} />
                </div>
            ) : null}
            <div className="mt-4 space-y-2">
                {task.events.map((event) => (
                    <div key={event.id} className="rounded-small bg-background p-3 text-small">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <span className={event.level === "error" ? "text-danger" : "text-default-700"}>{event.message}</span>
                            <span className="text-tiny text-default-400">{new Date(event.createdAt).toLocaleString()}</span>
                        </div>
                        {event.evidence ? (
                            <div className="mt-2 rounded-small border-small border-divider bg-default-50 px-3 py-2 text-tiny text-default-500">
                                <span className="font-medium text-default-700">{evidenceTypeLabel(event.evidence.type)}</span>
                                <span className="mx-1">{event.evidence.label}：</span>
                                {event.evidence.type === "screenshot" ? (
                                    <div className="mt-2 space-y-2">
                                        <a
                                            className="text-primary underline-offset-2 hover:underline"
                                            href={event.evidence.value}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            打开截图
                                        </a>
                                        <img
                                            alt={event.evidence.label}
                                            className="max-h-48 w-full max-w-xl rounded-small border-small border-divider object-contain"
                                            src={event.evidence.value}
                                        />
                                    </div>
                                ) : (
                                    <span className="break-all">{event.evidence.value}</span>
                                )}
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </section>
    );
}

function RulesPanel({
    loading,
    rule,
    onSaved,
}: {
    loading: boolean;
    rule: InteractionReplyRuleConfig | null;
    onSaved: (rule: InteractionReplyRuleConfig) => void;
}) {
    const [draft, setDraft] = React.useState<InteractionReplyRuleConfig | null>(rule);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        setDraft(rule);
    }, [rule]);

    const updateList = (
        key:
            | "requireApprovalKeywords"
            | "blockedKeywords"
            | "serviceHighlights"
            | "commentWhitelistKeywords"
            | "commentExcludeAuthorKeywords"
            | "commentNoiseKeywords"
            | "commentPriorityKeywords"
            | "fallbackReplies",
        value: string,
    ) => {
        setDraft((current) => current ? ({
            ...current,
            [key]: value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean),
        }) : current);
    };

    const handleSave = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const nextRule = await localEngineApi.updateReplyRule({
                industryName: draft.industryName,
                tone: draft.tone,
                defaultSendMode: draft.defaultSendMode,
                askForContact: draft.askForContact,
                commentParsingMode: draft.commentParsingMode,
                commentRulePreset: draft.commentRulePreset,
                commentRequireActionAndTime: draft.commentRequireActionAndTime,
                commentAllowShortText: draft.commentAllowShortText,
                commentSkipHandled: draft.commentSkipHandled,
                commentQuestionOnly: draft.commentQuestionOnly,
                commentMinLength: draft.commentMinLength,
                commentMaxLength: draft.commentMaxLength,
                commentWhitelistKeywords: draft.commentWhitelistKeywords,
                commentExcludeAuthorKeywords: draft.commentExcludeAuthorKeywords,
                commentNoiseKeywords: draft.commentNoiseKeywords,
                commentPriorityKeywords: draft.commentPriorityKeywords,
                fallbackEnabled: draft.fallbackEnabled,
                fallbackReplies: draft.fallbackReplies,
                allowFallbackAutoSend: draft.allowFallbackAutoSend,
                requireApprovalKeywords: draft.requireApprovalKeywords,
                blockedKeywords: draft.blockedKeywords,
                serviceHighlights: draft.serviceHighlights,
                closingText: draft.closingText,
            });
            onSaved(nextRule);
            addToast({ title: "规则已保存", description: nextRule.industryName, color: "success" });
        } catch (e: unknown) {
            addToast({
                title: "保存失败",
                description: e instanceof Error ? e.message : "请稍后重试",
                color: "danger",
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading && !draft) {
        return (
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <Spinner size="sm" />
                </CardBody>
            </Card>
        );
    }

    if (!draft) {
        return (
            <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
                <CardBody className="text-small text-danger-700">自动回复规则暂不可用。</CardBody>
            </Card>
        );
    }

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div>
                    <h3 className="text-medium font-semibold text-default-900">自动回复规则</h3>
                    <p className="mt-1 text-small text-default-500">
                        规则会参与新建互动任务的默认话术和发送策略；自动发送会直接执行，确认后发送才停下。
                    </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    <StatusItem label="行业话术" value={draft.industryName} />
                    <StatusItem label="发送防线" value={sendModeLabel(draft.defaultSendMode)} />
                    <StatusItem label="更新时间" value={formatDate(draft.updatedAt)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Input
                        label="行业名称"
                        value={draft.industryName}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, industryName: value }) : current)}
                    />
                    <Select
                        label="默认发送模式"
                        selectedKeys={[draft.defaultSendMode]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionSendMode | undefined;
                            if (value) setDraft((current) => current ? ({ ...current, defaultSendMode: value }) : current);
                        }}
                    >
                        {sendModes.map((mode) => (
                            <SelectItem key={mode.key}>{mode.label}</SelectItem>
                        ))}
                    </Select>
                    <Select
                        label="回复语气"
                        selectedKeys={[draft.tone]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionReplyRuleConfig["tone"] | undefined;
                            if (value) setDraft((current) => current ? ({ ...current, tone: value }) : current);
                        }}
                    >
                        <SelectItem key="warm">亲切自然</SelectItem>
                        <SelectItem key="professional">稳重专业</SelectItem>
                        <SelectItem key="concise">简洁直接</SelectItem>
                    </Select>
                    <div className="flex items-center rounded-[10px] border-small border-divider bg-default-50 px-4">
                        <Switch
                            isSelected={draft.askForContact}
                            onValueChange={(value) => setDraft((current) => current ? ({ ...current, askForContact: value }) : current)}
                        >
                            引导留联系方式
                        </Switch>
                    </div>
                </div>
                <Textarea
                    label="服务卖点"
                    minRows={2}
                    value={draft.serviceHighlights.join("，")}
                    onValueChange={(value) => updateList("serviceHighlights", value)}
                />
                <Divider />
                <div>
                    <h4 className="text-small font-semibold text-default-900">评论识别规则</h4>
                    <p className="mt-1 text-small text-default-500">
                        系统内置过滤菜单、按钮、作者本人和平台提示；下面这些规则由后台用户调整。
                    </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Select
                        label="识别规则"
                        selectedKeys={[draft.commentParsingMode]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionReplyRuleConfig["commentParsingMode"] | undefined;
                            if (value) setDraft((current) => current ? ({ ...current, commentParsingMode: value }) : current);
                        }}
                    >
                        <SelectItem key="rules">有规则</SelectItem>
                        <SelectItem key="none">没有规则</SelectItem>
                    </Select>
                    <Select
                        label="规则强度"
                        selectedKeys={[draft.commentRulePreset]}
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0] as InteractionReplyRuleConfig["commentRulePreset"] | undefined;
                            if (value) setDraft((current) => current ? ({ ...current, commentRulePreset: value }) : current);
                        }}
                    >
                        <SelectItem key="strict">严格</SelectItem>
                        <SelectItem key="loose">宽松</SelectItem>
                    </Select>
                    <Input
                        label="最小字数"
                        type="number"
                        value={String(draft.commentMinLength)}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentMinLength: Number(value) || 1 }) : current)}
                    />
                    <Input
                        label="最长字数"
                        type="number"
                        value={String(draft.commentMaxLength)}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentMaxLength: Number(value) || 180 }) : current)}
                    />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <Switch
                        isSelected={draft.commentRequireActionAndTime}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentRequireActionAndTime: value }) : current)}
                    >
                        必须带评论操作和时间
                    </Switch>
                    <Switch
                        isSelected={draft.commentAllowShortText}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentAllowShortText: value }) : current)}
                    >
                        允许短评论
                    </Switch>
                    <Switch
                        isSelected={draft.commentSkipHandled}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentSkipHandled: value }) : current)}
                    >
                        跳过已回复评论
                    </Switch>
                    <Switch
                        isSelected={draft.commentQuestionOnly}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, commentQuestionOnly: value }) : current)}
                    >
                        只回复问句
                    </Switch>
                </div>
                <Textarea
                    label="关键词白名单"
                    minRows={2}
                    value={draft.commentWhitelistKeywords.join("，")}
                    onValueChange={(value) => updateList("commentWhitelistKeywords", value)}
                />
                <Textarea
                    label="作者/自身过滤词"
                    minRows={2}
                    value={draft.commentExcludeAuthorKeywords.join("，")}
                    onValueChange={(value) => updateList("commentExcludeAuthorKeywords", value)}
                />
                <Textarea
                    label="噪音过滤词"
                    minRows={2}
                    value={draft.commentNoiseKeywords.join("，")}
                    onValueChange={(value) => updateList("commentNoiseKeywords", value)}
                />
                <Textarea
                    label="优先识别关键词"
                    minRows={2}
                    value={draft.commentPriorityKeywords.join("，")}
                    onValueChange={(value) => updateList("commentPriorityKeywords", value)}
                />
                <Divider />
                <div>
                    <h4 className="text-small font-semibold text-default-900">兜底回复</h4>
                    <p className="mt-1 text-small text-default-500">
                        AI 模型不可用或回复质量不达标时使用。是否允许自动发送由这里控制。
                    </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <Switch
                        isSelected={draft.fallbackEnabled}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, fallbackEnabled: value }) : current)}
                    >
                        启用兜底回复
                    </Switch>
                    <Switch
                        isSelected={draft.allowFallbackAutoSend}
                        onValueChange={(value) => setDraft((current) => current ? ({ ...current, allowFallbackAutoSend: value }) : current)}
                    >
                        允许兜底回复自动发送
                    </Switch>
                </div>
                <Textarea
                    label="兜底回复话术"
                    minRows={3}
                    value={draft.fallbackReplies.join("\n")}
                    onValueChange={(value) => updateList("fallbackReplies", value)}
                />
                <Textarea
                    label="需人工确认关键词"
                    minRows={2}
                    value={draft.requireApprovalKeywords.join("，")}
                    onValueChange={(value) => updateList("requireApprovalKeywords", value)}
                />
                <Textarea
                    label="禁用词"
                    minRows={2}
                    value={draft.blockedKeywords.join("，")}
                    onValueChange={(value) => updateList("blockedKeywords", value)}
                />
                <Textarea
                    label="收尾话术"
                    minRows={2}
                    value={draft.closingText}
                    onValueChange={(value) => setDraft((current) => current ? ({ ...current, closingText: value }) : current)}
                />
                <div className="flex justify-end">
                    <Button
                        color="primary"
                        isLoading={saving}
                        startContent={saving ? null : <Icon icon="solar:diskette-linear" />}
                        onPress={handleSave}
                    >
                        保存规则
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function CapabilitySummary({ capability }: { capability: LocalEngineCapability }) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-3">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-medium font-semibold text-default-900">{capability.name}</h3>
                    <CapabilityChip status={capability.status} />
                </div>
                <p className="text-small text-default-500">{capability.summary}</p>
                {capability.checks?.length ? (
                    <div className="space-y-2">
                        {capability.checks.slice(0, 2).map((check) => (
                            <div key={check.name} className="rounded-small bg-default-50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-tiny font-medium text-default-700">{check.name}</span>
                                    <CapabilityChip status={check.status} />
                                </div>
                                <p className="mt-1 break-all text-tiny text-default-400">{check.message}</p>
                            </div>
                        ))}
                    </div>
                ) : null}
                {capability.nextAction ? (
                    <p className="text-tiny text-default-400">{capability.nextAction}</p>
                ) : null}
            </CardBody>
        </Card>
    );
}

function CapabilityChip({ status }: { status: LocalEngineCapability["status"] }) {
    const map = {
        ready: { color: "success" as const, label: "可用" },
        warning: { color: "warning" as const, label: "需要配置" },
        missing: { color: "danger" as const, label: "需要配置" },
        developing: { color: "default" as const, label: "开发中" },
    };
    const item = map[status] || map.missing;
    return <Chip color={item.color} size="sm" variant="flat">{item.label}</Chip>;
}

function ExecutorStatusChip({ status }: { status: LocalEngineExecutorsStatus["executors"][number]["status"] }) {
    const map = {
        ready: { color: "success" as const, label: "可直接处理" },
        preflight_only: { color: "primary" as const, label: "需先确认" },
        missing: { color: "danger" as const, label: "需要配置" },
    };
    const item = map[status];
    return <Chip color={item.color} size="sm" variant="flat">{item.label}</Chip>;
}

function ExecutorAbilityChip({ label, ready }: { label: string; ready: boolean }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-small border-small border-divider bg-default-50 px-3 py-2">
            <span className="text-tiny text-default-600">{label}</span>
            <Chip color={ready ? "success" : "warning"} size="sm" variant="flat">
                {ready ? "已接" : "待接"}
            </Chip>
        </div>
    );
}

function StatusChip({ status, label }: { status: InteractionTask["status"]; label: string }) {
    const color =
        status === "completed"
            ? "success"
            : status === "failed"
              ? "danger"
              : status === "waiting_for_send_confirmation"
                ? "warning"
                : status === "no_target"
                  ? "default"
                : "default";
    return <Chip color={color} size="sm" variant="flat">{label}</Chip>;
}

function isDesktopInteractionTask(type: InteractionTaskType) {
    return ["wechat-reply-draft", "wechat-group-broadcast"].includes(type);
}

function resultSummaryChipColor(kind: NonNullable<InteractionTask["resultSummary"]>["kind"]) {
    const colors = {
        success: "success",
        failure: "danger",
        skipped: "warning",
        no_target: "default",
        waiting: "warning",
        running: "primary",
    } as const;
    return colors[kind];
}

function resultSummaryTone(kind: NonNullable<InteractionTask["resultSummary"]>["kind"]) {
    const tones = {
        success: "border-success-200 bg-success-50 text-success-700",
        failure: "border-danger-200 bg-danger-50 text-danger-700",
        skipped: "border-warning-200 bg-warning-50 text-warning-700",
        no_target: "border-default-200 bg-default-100 text-default-700",
        waiting: "border-warning-200 bg-warning-50 text-warning-700",
        running: "border-primary-200 bg-primary-50 text-primary-700",
    };
    return tones[kind];
}

function parseBatchTargets(batchText: string, defaultTarget: string, defaultReply?: string) {
    return batchText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const parts = line.split(/[|｜]/);
            const hasTarget = parts.length > 1;
            const targetName = hasTarget ? parts[0].trim() : `${defaultTarget} ${index + 1}`;
            const sourceText = hasTarget ? parts.slice(1).join("｜").trim() : line;

            return {
                targetName: targetName || `${defaultTarget} ${index + 1}`,
                sourceText,
                replyText: defaultReply,
            };
        })
        .filter((target) => target.sourceText)
        .slice(0, 100);
}

function targetStatusToTaskStatus(status: NonNullable<InteractionTask["batchTargets"]>[number]["status"]): InteractionTask["status"] {
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "skipped") return "skipped";
    if (status === "no_target") return "no_target";
    return "queued";
}

function targetStatusLabel(status: NonNullable<InteractionTask["batchTargets"]>[number]["status"]) {
    const map = {
        queued: "排队中",
        running: "执行中",
        waiting_confirmation: "待确认",
        completed: "已完成",
        failed: "失败",
        skipped: "已跳过",
        no_target: "无对象",
    };

    return map[status];
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

function RuntimeStateChip({ state }: { state: NonNullable<InteractionTask["runtimeState"]> }) {
    const map = {
        preflight_only: { color: "primary" as const, label: "需先确认" },
        executor_missing: { color: "warning" as const, label: "需要配置" },
        live_ready: { color: "success" as const, label: "可处理" },
        record_ready: { color: "default" as const, label: "内部记录" },
    };
    const item = map[state];
    return <Chip color={item.color} size="sm" variant="flat">{item.label}</Chip>;
}

function executorStatusLabel(status: LocalEngineExecutorsStatus["executors"][number]["status"]) {
    const map = {
        ready: "可直接处理",
        preflight_only: "需先确认",
        missing: "需要配置",
    };

    return map[status];
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

function deriveTaskFailureContext(task: InteractionTask): LocalEngineFailureContext | null {
    if (task.failureContext) return task.failureContext;
    if (task.status !== "failed" && !task.failureReason && !task.diagnostics?.failureReason) return null;
    return {
        platform: task.platformName || task.diagnostics?.platform || task.typeLabel,
        account: task.accountName || task.diagnostics?.account,
        target: task.targetName,
        stage: task.diagnostics?.currentStep || task.diagnostics?.currentStepMessage || task.statusLabel,
        reason: task.failureReason || task.diagnostics?.failureReason || task.diagnostics?.summary || "执行失败",
        nextAction: task.diagnostics?.nextAction || task.nextAction || "处理账号、对象或服务问题后重试。",
    };
}

function ActionBlockerList({ blockers }: { blockers: LocalEngineActionBlocker[] }) {
    if (!blockers.length) return null;
    return (
        <div className="grid gap-2">
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

function FailureContextBox({ context }: { context: LocalEngineFailureContext }) {
    return (
        <div className="mt-4 rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
            <div className="flex items-center gap-2 font-semibold">
                <Icon icon="solar:close-circle-linear" />
                <span>失败提示</span>
            </div>
            <p className="mt-2">{formatFailureContext(context)}</p>
        </div>
    );
}

function StepStatusChip({ status }: { status: NonNullable<InteractionTask["steps"]>[number]["status"] }) {
    const map = {
        pending: { color: "default" as const, label: "待执行" },
        running: { color: "primary" as const, label: "执行中" },
        completed: { color: "success" as const, label: "完成" },
        blocked: { color: "danger" as const, label: "需要处理" },
        skipped: { color: "warning" as const, label: "跳过" },
    };
    const item = map[status];
    return <Chip color={item.color} size="sm" variant="flat">{item.label}</Chip>;
}

function QueueItem({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
            <p className="text-tiny text-default-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-default-900">{value}</p>
        </div>
    );
}

function StatusItem({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={wide ? "md:col-span-2" : ""}>
            <p className="text-tiny text-default-400">{label}</p>
            <p className="mt-1 break-all text-small font-medium text-default-800">{value}</p>
        </div>
    );
}

function sendModeLabel(value: InteractionSendMode) {
    const item = sendModes.find((mode) => mode.key === value);
    return item?.label || value;
}

function evidenceTypeLabel(type: NonNullable<InteractionTask["events"][number]["evidence"]>["type"]) {
    const map: Record<NonNullable<InteractionTask["events"][number]["evidence"]>["type"], string> = {
        text: "文本证据",
        snapshot: "页面快照",
        screenshot: "截图证据",
        page_snapshot: "页面快照",
        desktop_screenshot: "桌面截图",
        stage_log: "阶段日志",
        failure_reason: "失败原因",
        diagnostic_bundle: "诊断包",
        file: "文件证据",
    };

    return map[type];
}

function fileKindLabel(kind: "directory" | "file" | "missing" | "unknown") {
    const map = {
        directory: "目录",
        file: "文件",
        missing: "不存在",
        unknown: "未知",
    };

    return map[kind];
}

function formatBytes(value?: number) {
    if (typeof value !== "number") return "-";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value?: string | null) {
    if (!value) return "-";
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString();
}
