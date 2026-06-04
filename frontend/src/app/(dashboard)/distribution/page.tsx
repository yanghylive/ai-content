"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    Button,
    Card,
    CardBody,
    Checkbox,
    Chip,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
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
import { articlesApi, type Article } from "@/lib/api/articles";
import {
    autoUploadApi,
    buildRiskConfirmation,
    type AutoUploadAccount,
    type AutoUploadEngineHealth,
    type AutoUploadLogFile,
    type AutoUploadMaterial,
    type AutoUploadPublishPayload,
    type AutoUploadPublishPreflightIssue,
    type AutoUploadPublishPreflightResult,
    type AutoUploadPublishResult,
    type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import type { LocalEngineActionBlocker, LocalEngineFailureContext } from "@/lib/api/local-engine";
import { localEngineApi } from "@/lib/api/local-engine";
import { loadLocalPlatformAccounts } from "@/lib/ops-workbench/local-platform-accounts";

type SourceDraft = {
    articleId: string;
    contentType: "article" | "xiaohongshu";
    title: string;
} | null;

type SourceContent = {
    article: Article;
    caption: string;
    hashtags: string[];
    description: string;
} | null;

type PublishResultItem = NonNullable<AutoUploadPublishResult["results"]>[number] & {
    accountName?: string;
    status?: NonNullable<AutoUploadPublishResult["platforms"]>[number]["status"];
    nextAction?: string;
    publishTaskId?: string;
};

type DistributionTabKey = "article" | "video" | "materials" | "accounts" | "engine" | "tasks" | "logs";

const loginPlatforms = [
    { type: 3, name: "抖音" },
    { type: 1, name: "小红书" },
    { type: 2, name: "视频号" },
    { type: 4, name: "快手" },
    { type: 5, name: "B站" },
];

const publishPlatformOrder: Record<number, number> = {
    3: 0,
    2: 1,
    5: 2,
    1: 3,
    4: 4,
};

const platformPublishRules: Record<number, { titleLimit: number; tagLimit: number }> = {
    1: { titleLimit: 20, tagLimit: 5 },
    2: { titleLimit: 16, tagLimit: 5 },
    3: { titleLimit: 30, tagLimit: 5 },
    4: { titleLimit: 30, tagLimit: 4 },
    5: { titleLimit: 80, tagLimit: 5 },
};

function normalizeTags(tags: string[], limit: number) {
    return Array.from(new Set(tags.map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean))).slice(0, limit);
}

function trimTitleForPlatform(value: string, type: number) {
    const limit = platformPublishRules[type]?.titleLimit || 80;
    return value.trim().slice(0, limit);
}

function resolvePublishResultColor(ok: boolean | null | undefined) {
    if (ok === true) return "success" as const;
    if (ok === false) return "danger" as const;
    return "warning" as const;
}

function resolvePublishResultLabel(item: Pick<PublishResultItem, "ok" | "status">) {
    if (item.ok === true) return "平台已确认";
    if (item.ok === false) return "失败";
    if (item.status === "pending_manual") return "待人工确认";
    if (item.status === "not_integrated") return "未接入回读";
    if (item.status === "account_expired") return "账号失效";
    if (item.status === "material_error") return "素材异常";
    if (item.status === "login_required") return "需登录";
    return "未确认";
}

function getMaterialKind(filename: string) {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (["mp4", "mov", "m4v", "webm"].includes(ext)) return { label: "视频", color: "secondary" as const, icon: "solar:videocamera-record-linear" };
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return { label: "图片", color: "primary" as const, icon: "solar:gallery-linear" };
    return { label: ext ? ext.toUpperCase() : "文件", color: "default" as const, icon: "solar:file-linear" };
}

function formatMaterialSize(value: number | null) {
    if (value === null || Number.isNaN(value)) return "大小未知";
    return `${value} MB`;
}

function summarizeTaskResult(result: Record<string, unknown> | null) {
    const results = normalizePublishResultItems(result as AutoUploadPublishResult | null);
    return {
        results,
        failures: results.filter((item) => item.ok === false),
        succeeded: results.filter((item) => item.ok === true),
        pending: results.filter((item) => item.ok !== true && item.ok !== false),
    };
}

function normalizePublishResultItems(result: AutoUploadPublishResult | null | undefined): PublishResultItem[] {
    if (Array.isArray(result?.platforms)) {
        return result.platforms.map((entry, index) => ({
            type: index,
            ok: entry.status === "success" ? true : entry.status === "failed" ? false : null,
            status: entry.status,
            message: entry.failureReason || entry.nextAction || (entry.status === "success" ? "平台回执或回读证据已确认" : "发布结果待确认"),
            platform: entry.platform,
            account: entry.accountId,
            accountName: entry.accountId,
            nextAction: entry.nextAction,
            publishTaskId: entry.publishTaskId,
            publishUrl: entry.publishUrl,
            externalId: entry.externalId,
            evidence: entry.evidence,
        }));
    }

    return Array.isArray(result?.results) ? result.results as PublishResultItem[] : [];
}

function createRequestId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function formatPreflightIssue(issue: AutoUploadPublishPreflightIssue) {
    return [
        issue.platform ? `平台：${issue.platform}` : null,
        issue.account ? `账号：${issue.account}` : issue.accountFile ? `账号：${issue.accountFile}` : null,
        issue.filePath ? `${issue.scope === "cover" ? "封面" : "素材"}：${issue.filePath}` : null,
        issue.stage ? `阶段：${issue.stage}` : null,
        issue.expected ? `期望：${issue.expected}` : null,
        issue.actual ? `实际：${issue.actual}` : null,
        `原因：${issue.message}`,
        `下一步：${issue.nextAction}`,
    ].filter(Boolean).join("；");
}

export default function DistributionPage() {
    return (
        <React.Suspense
            fallback={
                <div className="flex min-h-[360px] items-center justify-center">
                    <Spinner size="sm" />
                </div>
            }
        >
            <DistributionContent />
        </React.Suspense>
    );
}

function DistributionContent() {
    const searchParams = useSearchParams();
    const requestedTab = searchParams.get("tab");
    const selectedTab = React.useMemo<DistributionTabKey>(() => {
        if (sourceTabKeys.includes(requestedTab || "")) {
            return requestedTab as DistributionTabKey;
        }
        if (searchParams.get("source") === "article") {
            return "article";
        }
        return "article";
    }, [requestedTab, searchParams]);
    const [health, setHealth] = React.useState<AutoUploadEngineHealth | null>(null);
    const [accounts, setAccounts] = React.useState<AutoUploadAccount[]>([]);
    const [materials, setMaterials] = React.useState<AutoUploadMaterial[]>([]);
    const [error, setError] = React.useState("");
    const [accountsError, setAccountsError] = React.useState("");
    const [materialsError, setMaterialsError] = React.useState("");
    const [logsError, setLogsError] = React.useState("");
    const [loading, setLoading] = React.useState(true);
    const [accountsLoading, setAccountsLoading] = React.useState(true);
    const [materialsLoading, setMaterialsLoading] = React.useState(true);
    const [logsLoading, setLogsLoading] = React.useState(true);
    const [logs, setLogs] = React.useState<AutoUploadLogFile[]>([]);
    const [tasks, setTasks] = React.useState<AutoUploadPublishTask[]>([]);
    const [tasksLoading, setTasksLoading] = React.useState(true);
    const [tasksError, setTasksError] = React.useState("");
    const [sourceContent, setSourceContent] = React.useState<SourceContent>(null);
    const [sourceContentLoading, setSourceContentLoading] = React.useState(false);

    const fetchHealth = React.useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await autoUploadApi.health();
            setHealth(result);
        } catch (e: unknown) {
            setHealth(null);
            setError(e instanceof Error ? e.message : "本地发布引擎未启动");
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchAccounts = React.useCallback(async () => {
        setAccountsLoading(true);
        setAccountsError("");
        try {
            const result = await loadLocalPlatformAccounts();
            setAccounts(result);
        } catch (e: unknown) {
            setAccounts([]);
            setAccountsError(e instanceof Error ? e.message : "平台账号读取失败");
        } finally {
            setAccountsLoading(false);
        }
    }, []);

    const fetchMaterials = React.useCallback(async () => {
        setMaterialsLoading(true);
        setMaterialsError("");
        try {
            const result = await autoUploadApi.materials();
            setMaterials(result);
        } catch (e: unknown) {
            setMaterials([]);
            setMaterialsError(e instanceof Error ? e.message : "发布素材读取失败");
        } finally {
            setMaterialsLoading(false);
        }
    }, []);

    const fetchLogs = React.useCallback(async () => {
        setLogsLoading(true);
        setLogsError("");
        try {
            const result = await autoUploadApi.logs();
            setLogs(result);
        } catch (e: unknown) {
            setLogs([]);
            setLogsError(e instanceof Error ? e.message : "运行日志读取失败");
        } finally {
            setLogsLoading(false);
        }
    }, []);

    const fetchTasks = React.useCallback(async () => {
        setTasksLoading(true);
        setTasksError("");
        try {
            const result = await autoUploadApi.tasks();
            setTasks(result);
        } catch (e: unknown) {
            setTasks([]);
            setTasksError(e instanceof Error ? e.message : "发布任务读取失败");
        } finally {
            setTasksLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchHealth();
        fetchAccounts();
        fetchMaterials();
        fetchLogs();
        fetchTasks();
    }, [fetchAccounts, fetchHealth, fetchLogs, fetchMaterials, fetchTasks]);

    const statusColor = health?.online ? "success" : "danger";
    const sourceDraft = React.useMemo<SourceDraft>(() => {
        if (searchParams.get("source") !== "article") {
            return null;
        }

        const articleId = searchParams.get("articleId") || "";
        const title = searchParams.get("title") || "";
        const contentType = searchParams.get("contentType") === "xiaohongshu" ? "xiaohongshu" : "article";
        if (!articleId) {
            return null;
        }

        return { articleId, contentType, title };
    }, [searchParams]);

    React.useEffect(() => {
        if (!sourceDraft?.articleId || sourceDraft.articleId === "test") {
            setSourceContent(null);
            return;
        }

        let cancelled = false;
        setSourceContentLoading(true);
        articlesApi.getById(sourceDraft.articleId)
            .then((article) => {
                if (cancelled) return;
                const caption = article.xiaohongshuData?.caption || article.content || "";
                const hashtags = article.xiaohongshuData?.hashtags || article.topic?.keywords || [];
                const description = article.finalHtml || article.rawHtml || article.content || caption;
                setSourceContent({ article, caption, hashtags, description });
            })
            .catch(() => {
                if (!cancelled) {
                    setSourceContent(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setSourceContentLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [sourceDraft?.articleId]);

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <header className="flex flex-col gap-4 rounded-[10px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                        <Icon icon="solar:share-circle-linear" width={26} />
                    </div>
                    <div>
                        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">发布中心</h2>
                        <p className="mt-1 text-small text-default-500">
                            图文、视频、本地素材和平台账号统一在这里处理，发布动作由本地发布服务执行。
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Chip color={statusColor} variant="flat">
                        {loading ? "检查中" : health?.online ? "引擎在线" : "引擎离线"}
                    </Chip>
                    <Button
                        color="primary"
                        isLoading={loading}
                        startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            fetchHealth().catch(() => {
                                addToast({ title: "刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新状态
                    </Button>
                </div>
            </header>

            {selectedTab === "article" ? (
                    <PublishPanel
                        accounts={accounts}
                        accountsLoading={accountsLoading}
                        health={health}
                        materials={materials}
                        materialsLoading={materialsLoading}
                        onMaterialsRefresh={fetchMaterials}
                        onTasksRefresh={fetchTasks}
                        sourceContent={sourceContent}
                        sourceContentLoading={sourceContentLoading}
                        sourceDraft={sourceDraft}
                        variant="article"
                    />
            ) : null}

            {selectedTab === "video" ? (
                    <PublishPanel
                        accounts={accounts}
                        accountsLoading={accountsLoading}
                        health={health}
                        materials={materials}
                        materialsLoading={materialsLoading}
                        onMaterialsRefresh={fetchMaterials}
                        onTasksRefresh={fetchTasks}
                        sourceContent={sourceContent}
                        sourceContentLoading={sourceContentLoading}
                        sourceDraft={sourceDraft}
                        variant="video"
                    />
            ) : null}

            {selectedTab === "accounts" ? (
                    <AccountsPanel
                        accounts={accounts}
                        error={accountsError}
                        loading={accountsLoading}
                        onRefresh={fetchAccounts}
                        onSetAccounts={setAccounts}
                    />
            ) : null}

            {selectedTab === "materials" ? (
                    <MaterialsPanel
                        error={materialsError}
                        loading={materialsLoading}
                        materials={materials}
                        onRefresh={fetchMaterials}
                    />
            ) : null}

            {selectedTab === "tasks" ? (
                    <TasksPanel
                        error={tasksError}
                        loading={tasksLoading}
                        onRefresh={fetchTasks}
                        tasks={tasks}
                    />
            ) : null}

            {selectedTab === "engine" ? (
                    <EnginePanel
                        error={error}
                        health={health}
                        loading={loading}
                        onRefresh={fetchHealth}
                    />
            ) : null}

            {selectedTab === "logs" ? (
                    <LogsPanel
                        error={logsError}
                        loading={logsLoading}
                        logs={logs}
                        onRefresh={fetchLogs}
                    />
            ) : null}
        </div>
    );
}

const sourceTabKeys = ["article", "video", "materials", "accounts", "engine", "tasks", "logs"];

function MaterialPathSelect({
    label,
    materials,
    value,
    onChange,
}: {
    label: string;
    materials: AutoUploadMaterial[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-tiny font-medium text-default-600">{label}</span>
            <select
                className="h-10 rounded-[10px] border-small border-divider bg-background px-3 text-small text-default-800 outline-none transition-colors focus:border-primary"
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                <option value="">不指定</option>
                {materials
                    .filter((material) => material.filePath)
                    .map((material) => (
                        <option key={`${label}-${material.id}`} value={material.filePath || ""}>
                            {material.filename}
                        </option>
                    ))}
            </select>
        </label>
    );
}

function PublishPanel({
    accounts,
    accountsLoading,
    health,
    materials,
    materialsLoading,
    onMaterialsRefresh,
    onTasksRefresh,
    sourceContent,
    sourceContentLoading,
    sourceDraft,
    variant,
}: {
    accounts: AutoUploadAccount[];
    accountsLoading: boolean;
    health: AutoUploadEngineHealth | null;
    materials: AutoUploadMaterial[];
    materialsLoading: boolean;
    onMaterialsRefresh: () => Promise<void>;
    onTasksRefresh: () => Promise<void>;
    sourceContent: SourceContent;
    sourceContentLoading: boolean;
    sourceDraft: SourceDraft;
    variant: "article" | "video";
}) {
    const normalAccounts = React.useMemo(
        () => accounts.filter((account) => account.status === 1),
        [accounts],
    );
    const invalidAccounts = React.useMemo(
        () => accounts.filter((account) => account.status !== 1),
        [accounts],
    );
    const [selectedAccountIds, setSelectedAccountIds] = React.useState<number[]>([]);
    const [selectedMaterialPaths, setSelectedMaterialPaths] = React.useState<string[]>([]);
    const [title, setTitle] = React.useState("");
    const [tagsText, setTagsText] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [timerEnabled, setTimerEnabled] = React.useState(false);
    const [videosPerDay, setVideosPerDay] = React.useState("1");
    const [dailyTimesText, setDailyTimesText] = React.useState("10:00");
    const [startDays, setStartDays] = React.useState("0");
    const [timeJitterMinutes, setTimeJitterMinutes] = React.useState("0");
    const [scheduleTime, setScheduleTime] = React.useState("");
    const [coverPath, setCoverPath] = React.useState("");
    const [coverPath34, setCoverPath34] = React.useState("");
    const [coverPath43, setCoverPath43] = React.useState("");
    const [coverPath169, setCoverPath169] = React.useState("");
    const [biliTitle, setBiliTitle] = React.useState("");
    const [biliType, setBiliType] = React.useState("自制");
    const [biliPartition, setBiliPartition] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);
    const [importingSource, setImportingSource] = React.useState(false);
    const [realPublishEnabled, setRealPublishEnabled] = React.useState(false);
    const [confirmPublishOpen, setConfirmPublishOpen] = React.useState(false);
    const [statusMessage, setStatusMessage] = React.useState("");
    const [publishResults, setPublishResults] = React.useState<PublishResultItem[]>([]);
    const [preflightResult, setPreflightResult] = React.useState<AutoUploadPublishPreflightResult | null>(null);

    React.useEffect(() => {
        if (!sourceDraft?.title) {
            return;
        }

        setTitle((current) => current || sourceDraft.title);
    }, [sourceDraft?.articleId, sourceDraft?.title]);

    React.useEffect(() => {
        if (!sourceContent) {
            return;
        }

        setTitle((current) => current || sourceContent.article.title);
        setBiliTitle((current) => current || sourceContent.article.title);
        setTagsText((current) => current || sourceContent.hashtags.join(" "));
        setDescription((current) => current || sourceContent.caption || sourceContent.description);
    }, [sourceContent]);

    React.useEffect(() => {
        setSelectedAccountIds((current) =>
            current.filter((id) => normalAccounts.some((account) => account.id === id)),
        );
    }, [normalAccounts]);

    React.useEffect(() => {
        setSelectedMaterialPaths((current) =>
            current.filter((path) => materials.some((material) => material.filePath === path)),
        );
    }, [materials]);

    React.useEffect(() => {
        const existingPaths = new Set(materials.map((material) => material.filePath).filter(Boolean));
        if (coverPath && !existingPaths.has(coverPath)) setCoverPath("");
        if (coverPath34 && !existingPaths.has(coverPath34)) setCoverPath34("");
        if (coverPath43 && !existingPaths.has(coverPath43)) setCoverPath43("");
        if (coverPath169 && !existingPaths.has(coverPath169)) setCoverPath169("");
    }, [coverPath, coverPath169, coverPath34, coverPath43, materials]);

    const selectedAccounts = React.useMemo(
        () => normalAccounts
            .filter((account) => selectedAccountIds.includes(account.id))
            .sort((a, b) => (publishPlatformOrder[a.type] ?? 99) - (publishPlatformOrder[b.type] ?? 99)),
        [normalAccounts, selectedAccountIds],
    );
    const publishBlockers = React.useMemo<LocalEngineActionBlocker[]>(() => {
        const items: LocalEngineActionBlocker[] = [];
        const target = title.trim() || "未填写标题";
        if (!health?.online) {
            items.push({
                platform: "本地发布服务",
                account: "自动化服务",
                target,
                stage: "发布提交",
                reason: "本地发布引擎离线，无法提交预发布检查或真实发布。",
                nextAction: "先到发布中心-引擎刷新或启动 发布服务 服务。",
                capability: "auto-upload-engine",
            });
        }
        if (!normalAccounts.length) {
            items.push({
                platform: "发布平台",
                account: "无可用平台账号",
                target,
                stage: "账号选择",
                reason: "没有已登录且可用的平台账号。",
                nextAction: "到平台账号页完成登录、重登或账号校验。",
                capability: "account",
            });
        }
        if (!selectedAccounts.length) {
            items.push({
                platform: "发布平台",
                account: "未选择账号",
                target,
                stage: "账号选择",
                reason: "发布任务必须绑定至少一个可用账号。",
                nextAction: "勾选一个可用平台账号。",
                capability: "account",
            });
        }
        if (!selectedMaterialPaths.length) {
            items.push({
                platform: selectedAccounts.map((account) => account.platform).join("、") || "发布平台",
                account: selectedAccounts.map((account) => account.profileName || account.userName).join("、") || "未选择账号",
                target,
                stage: "素材选择",
                reason: "没有选择可发布素材。",
                nextAction: "选择带本地路径的素材；缺少素材时先上传或从内容库导入。",
                capability: "materials",
            });
        }
        return items;
    }, [health?.online, normalAccounts.length, selectedAccounts, selectedMaterialPaths.length, title]);
    const canSubmitPublish = publishBlockers.length === 0;

    const toggleAccount = (accountId: number, checked: boolean) => {
        setSelectedAccountIds((current) => {
            if (checked) {
                return current.includes(accountId) ? current : [...current, accountId];
            }
            return current.filter((id) => id !== accountId);
        });
    };

    const toggleMaterial = (filePath: string | null, checked: boolean) => {
        if (!filePath) return;
        setSelectedMaterialPaths((current) => {
            if (checked) {
                return current.includes(filePath) ? current : [...current, filePath];
            }
            return current.filter((path) => path !== filePath);
        });
    };

    const importSourceMaterials = async () => {
        if (!sourceDraft?.articleId) {
            return;
        }

        setImportingSource(true);
        setStatusMessage("正在把来源内容的卡图导入本地素材库...");
        try {
            const result = await autoUploadApi.importArticleMaterials(sourceDraft.articleId);
            const importedPaths = result.imported
                .map((material) => material.filePath)
                .filter((path): path is string => Boolean(path));
            setSelectedMaterialPaths((current) => Array.from(new Set([...current, ...importedPaths])));
            await onMaterialsRefresh();
            setStatusMessage(`已导入 ${importedPaths.length} 个素材到本地素材库。`);
            addToast({
                title: "卡图已导入",
                description: result.failures.length ? `有 ${result.failures.length} 张卡图导入失败` : undefined,
                color: result.failures.length ? "warning" : "success",
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "素材导入失败";
            setStatusMessage(message);
            addToast({ title: "素材导入失败", description: message, color: "danger" });
        } finally {
            setImportingSource(false);
        }
    };

    const validatePublishForm = () => {
        const finalTitle = title.trim();
        if (!finalTitle) {
            addToast({ title: "请填写发布标题", color: "warning" });
            return null;
        }
        if (!selectedAccounts.length) {
            addToast({ title: "请选择发布账号", color: "warning" });
            return null;
        }
        if (!selectedMaterialPaths.length) {
            addToast({ title: "请选择发布素材", color: "warning" });
            return null;
        }

        const tags = tagsText
            .split(/[,，#\s]+/)
            .map((tag) => tag.trim())
            .filter(Boolean);
        const dailyTimes = dailyTimesText
            .split(/[,，\s]+/)
            .map((item) => item.trim())
            .filter(Boolean);

        return { finalTitle, tags, dailyTimes };
    };

    const buildPublishPayloads = (formData: NonNullable<ReturnType<typeof validatePublishForm>>, dryRun: boolean): AutoUploadPublishPayload[] => {
        const ratioCoverPaths = {
            ...(coverPath34 ? { "3:4": coverPath34 } : {}),
            ...(coverPath43 ? { "4:3": coverPath43 } : {}),
            ...(coverPath169 ? { "16:9": coverPath169 } : {}),
        };

        return selectedAccounts.map((account) => {
            const rules = platformPublishRules[account.type] || { titleLimit: 80, tagLimit: 5 };
            const finalBiliTitle = biliTitle.trim() || formData.finalTitle;
            const platformTitle = account.type === 5 ? finalBiliTitle : formData.finalTitle;

            return {
                type: account.type,
                accountIds: [account.id],
                contentKind: variant,
                title: trimTitleForPlatform(platformTitle, account.type),
                tags: normalizeTags(formData.tags, rules.tagLimit),
                fileList: selectedMaterialPaths,
                accountList: [account.filePath],
                enableTimer: timerEnabled ? 1 as const : 0 as const,
                videosPerDay: Number(videosPerDay) || 1,
                dailyTimes: formData.dailyTimes.length ? formData.dailyTimes : ["10:00"],
                startDays: Number(startDays) || 0,
                timeJitterMinutes: Number(timeJitterMinutes) || 0,
                scheduleTime: scheduleTime.trim() || undefined,
                debugDryRun: dryRun,
                debugDryRunHoldBrowser: dryRun,
                category: 0,
                coverPath: coverPath || undefined,
                coverPaths: Object.keys(ratioCoverPaths).length ? ratioCoverPaths : undefined,
                biliDesc: description.trim() || undefined,
                biliTitle: trimTitleForPlatform(finalBiliTitle, 5),
                biliType: biliType.trim() || undefined,
                biliPartition: biliPartition.trim() || undefined,
            };
        });
    };

    const runPublishPreflight = async (payloads: AutoUploadPublishPayload[]) => {
        const result = await autoUploadApi.preflight(payloads);
        setPreflightResult(result);
        if (!result.ok) {
            const details = result.issues.map(formatPreflightIssue).join("\n");
            setStatusMessage(details);
            addToast({
                title: "发布前检查未通过",
                description: result.issues[0] ? formatPreflightIssue(result.issues[0]) : result.summary,
                color: "danger",
            });
            return false;
        }
        return true;
    };

    const submitPublish = async (dryRun: boolean) => {
        const formData = validatePublishForm();
        if (!formData) {
            return;
        }
        if (publishBlockers.length) {
            addToast({
                title: "发布已阻断",
                description: publishBlockers[0].nextAction,
                color: "warning",
            });
            return;
        }

        const payloads = buildPublishPayloads(formData, dryRun);

        setSubmitting(true);
        setPublishResults([]);
        setPreflightResult(null);
        setStatusMessage("正在检查 发布服务 在线、账号登录态、素材/封面可读和平台参数...");
        try {
            const preflightOk = await runPublishPreflight(payloads);
            if (!preflightOk) {
                return;
            }
            setStatusMessage(dryRun ? "发布前检查通过，正在提交到本地发布引擎做预发布检查..." : "发布前检查通过，正在提交真实发布任务到本地发布引擎...");
            const result = await autoUploadApi.publish(payloads, buildRiskConfirmation('publish'));
            const accountByType = new Map(selectedAccounts.map((account) => [account.type, account]));
            const resultItems = normalizePublishResultItems(result).map((item) => {
                const account = accountByType.get(item.type);
                return {
                    ...item,
                    platform: item.platform || account?.platform || `平台 ${item.type}`,
                    accountName: item.account || account?.profileName || account?.userName || account?.filePath,
                };
            });
            setPublishResults(resultItems);
            const failures = resultItems.filter((item) => item.ok === false);
            const succeeded = resultItems.filter((item) => item.ok === true);
            const pending = resultItems.filter((item) => item.ok !== true && item.ok !== false);
            if (failures.length) {
                setStatusMessage(
                    failures.map((item) => formatFailureContext({
                        platform: item.platform || `平台 ${item.type}`,
                        account: item.accountName || item.account || "未识别账号",
                        target: formData.finalTitle,
                        stage: dryRun ? "预发布检查" : "真实发布",
                        reason: item.message || "发布失败",
                        nextAction: "检查平台登录态、素材和页面权限后重试。",
                    })).join("\n"),
                );
                addToast({ title: dryRun ? "预发布检查失败" : "真实发布失败", color: "danger" });
                return;
            }

            setStatusMessage(
                resultItems.length
                    ? `已提交 ${payloads.length} 个平台的${dryRun ? "预发布检查" : "真实发布任务"}：平台已确认 ${succeeded.length}，待确认 ${pending.length}。`
                    : `已提交 ${payloads.length} 个平台的${dryRun ? "预发布检查" : "真实发布任务"}。`,
            );
            addToast({ title: dryRun ? "已提交预发布检查" : "真实发布任务已提交，等待平台证据", color: pending.length ? "warning" : "success" });
            await onTasksRefresh();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "发布任务提交失败";
            const failure = formatFailureContext({
                platform: selectedAccounts.map((account) => account.platform).join("、") || "发布平台",
                account: selectedAccounts.map((account) => account.profileName || account.userName).join("、") || "未选择账号",
                target: formData.finalTitle,
                stage: dryRun ? "预发布检查提交" : "真实发布提交",
                reason: message,
                nextAction: "确认 发布服务 引擎在线、账号可用、素材路径存在后重试。",
            });
            setStatusMessage(failure);
            addToast({ title: "提交失败", description: failure, color: "danger" });
        } finally {
            setSubmitting(false);
            setConfirmPublishOpen(false);
        }
    };

    const submitPublishConfirmation = async () => {
        const formData = validatePublishForm();
        if (!formData) {
            return;
        }
        if (publishBlockers.length) {
            addToast({
                title: "真实发布已阻断",
                description: publishBlockers[0].nextAction,
                color: "warning",
            });
            return;
        }

        setSubmitting(true);
        setPreflightResult(null);
        setStatusMessage("正在检查 发布服务 在线、账号登录态、素材/封面可读和平台参数...");
        try {
            const payloads = buildPublishPayloads(formData, false);
            const preflightOk = await runPublishPreflight(payloads);
            if (!preflightOk) {
                return;
            }
            setStatusMessage("发布前检查通过，正在创建统一发布确认，会进入“待我确认”后继续。");
            const platformNames = selectedAccounts
                .map((account) => account.platform || account.profileName || account.userName || account.filePath)
                .join("、");
            const session = await localEngineApi.createAgentSession({
                source: "publishing",
                executionScope: "browser",
                targetApp: "本地发布服务",
                dryRun: true,
                commercialExecutionRequested: true,
                title: `真实发布确认：${formData.finalTitle}`,
                resumeAction: {
                    kind: "auto-upload-publish",
                    label: `真实发布《${formData.finalTitle}》`,
                    payloads,
                },
                instruction: [
                    `准备真实发布内容《${formData.finalTitle}》。`,
                    `平台账号：${platformNames || `${selectedAccounts.length} 个账号`}。`,
                    `素材数量：${selectedMaterialPaths.length}。`,
                    `标签：${formData.tags.join("、") || "未填写"}。`,
                    timerEnabled ? `定时发布：${formData.dailyTimes.join("、") || dailyTimesText}` : "不启用定时发布。",
                    "请先进入待我确认；确认后再由本机发布引擎继续执行真实发布。",
                ].join("\n"),
            });
            setStatusMessage(`已创建发布确认：${session.title}。请到“待我确认”继续。`);
            addToast({
                title: "已进入待我确认",
                description: "真实发布不会直接提交，确认后才继续原会话。",
                color: "success",
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "发布确认创建失败";
            const failure = formatFailureContext({
                platform: selectedAccounts.map((account) => account.platform).join("、") || "发布平台",
                account: selectedAccounts.map((account) => account.profileName || account.userName).join("、") || "未选择账号",
                target: formData.finalTitle,
                stage: "创建真实发布确认",
                reason: message,
                nextAction: "确认本机 Agent 会话接口可用后重试；真实发布仍不会直接提交。",
            });
            setStatusMessage(failure);
            addToast({ title: "确认创建失败", description: failure, color: "danger" });
        } finally {
            setSubmitting(false);
            setConfirmPublishOpen(false);
        }
    };

    const handleSubmit = async () => {
        if (!realPublishEnabled) {
            await submitPublish(true);
            return;
        }

        if (!validatePublishForm()) {
            return;
        }
        if (publishBlockers.length) {
            addToast({
                title: "发布已阻断",
                description: publishBlockers[0].nextAction,
                color: "warning",
            });
            return;
        }
        setConfirmPublishOpen(true);
    };

    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-5">
                <div className="flex flex-col gap-1">
                    <h3 className="text-medium font-semibold text-default-900">
                        {variant === "article" ? "图文发布" : "视频发布"}
                    </h3>
                    <p className="text-small text-default-500">
                        {variant === "article"
                            ? "适合发布文章、小红书笔记和带图内容；从内容库进入时会自动带入标题、文案和标签。"
                            : "适合发布本地视频文件；先选择视频素材，再补标题、简介、封面和平台参数。"}
                    </p>
                </div>

                {sourceDraft ? (
                    <div className="flex flex-col gap-3 rounded-[10px] border-small border-primary-200 bg-primary-50 p-4 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <Chip color="primary" size="sm" variant="flat">
                                    {sourceDraft.contentType === "xiaohongshu" ? "小红书笔记" : "文章"}
                                </Chip>
                                <span className="text-small font-semibold text-primary-700">待分发内容</span>
                            </div>
                            <p className="truncate text-medium font-semibold text-default-900" title={sourceDraft.title}>
                                {sourceDraft.title || "未命名内容"}
                            </p>
                            <p className="mt-1 text-tiny text-default-500">
                                {sourceContentLoading
                                    ? "正在读取来源内容详情..."
                                    : sourceContent
                                        ? "已读取来源内容的文案和标签，可继续导入卡图或调整发布字段。"
                                        : "当前只接收标题和来源标记；图片或视频仍从本地发布素材中选择。"}
                            </p>
                        </div>
                        <Button
                            as={Link}
                            color="primary"
                            href={sourceDraft.contentType === "xiaohongshu" ? "/xiaohongshu" : "/articles"}
                            size="sm"
                            startContent={<Icon icon="solar:arrow-left-linear" />}
                            variant="flat"
                        >
                            返回内容库
                        </Button>
                        {sourceDraft.contentType === "xiaohongshu" ? (
                            <Button
                                color="primary"
                                isLoading={importingSource}
                                size="sm"
                                startContent={importingSource ? null : <Icon icon="solar:download-minimalistic-linear" />}
                                onPress={importSourceMaterials}
                            >
                                导入卡图到素材库
                            </Button>
                        ) : null}
                    </div>
                ) : null}

                {invalidAccounts.length ? (
                    <div className="flex flex-col gap-3 rounded-[10px] border-small border-warning-200 bg-warning-50 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-small font-semibold text-warning-700">有 {invalidAccounts.length} 个平台账号已失效或不可用</p>
                            <p className="mt-1 text-tiny text-warning-700">
                                失效账号不会出现在可选列表。请先在平台账号中重新登录或刷新校验，避免提交后才失败。
                            </p>
                        </div>
                        <Button
                            as={Link}
                            color="warning"
                            href="/distribution?tab=accounts"
                            size="sm"
                            startContent={<Icon icon="solar:key-minimalistic-square-linear" />}
                            variant="flat"
                        >
                            处理账号
                        </Button>
                    </div>
                ) : null}

                {publishBlockers.length ? <ActionBlockerList blockers={publishBlockers} /> : null}

                <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
                    <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h4 className="text-small font-semibold text-default-900">选择账号</h4>
                            <Chip size="sm" variant="flat">
                                已选 {selectedAccountIds.length}
                            </Chip>
                        </div>
                        <p className="mb-3 text-tiny text-default-500">
                            提交时按抖音、视频号、B站、小红书、快手的本地引擎顺序执行。
                        </p>
                        <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
                            {accountsLoading ? (
                                <div className="flex items-center gap-2 text-small text-default-500">
                                    <Spinner size="sm" />
                                    正在加载账号...
                                </div>
                            ) : normalAccounts.length ? (
                                normalAccounts.map((account) => (
                                    <Checkbox
                                        key={account.id}
                                        isSelected={selectedAccountIds.includes(account.id)}
                                        onValueChange={(checked) => toggleAccount(account.id, checked)}
                                    >
                                        <span className="flex flex-wrap items-center gap-2 text-small">
                                            <Chip size="sm" variant="flat">
                                                {account.platform}
                                            </Chip>
                                            <span className="font-medium text-default-900">
                                                {account.profileName || account.userName || `账号 ${account.id}`}
                                            </span>
                                        </span>
                                    </Checkbox>
                                ))
                            ) : (
                                <p className="text-small text-default-500">暂无可用账号。</p>
                            )}
                        </div>
                    </section>

                    <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h4 className="text-small font-semibold text-default-900">选择素材</h4>
                            <Chip size="sm" variant="flat">
                                已选 {selectedMaterialPaths.length}
                            </Chip>
                        </div>
                        <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
                            {materialsLoading ? (
                                <div className="flex items-center gap-2 text-small text-default-500">
                                    <Spinner size="sm" />
                                    正在加载素材...
                                </div>
                            ) : materials.length ? (
                                materials.map((material) => (
                                    <Checkbox
                                        key={material.id}
                                        isDisabled={!material.filePath}
                                        isSelected={Boolean(
                                            material.filePath && selectedMaterialPaths.includes(material.filePath),
                                        )}
                                        onValueChange={(checked) => toggleMaterial(material.filePath, checked)}
                                    >
                                        <span className="flex flex-col text-small">
                                            <span className="flex flex-wrap items-center gap-2 font-medium text-default-900">
                                                <Chip color={getMaterialKind(material.filename).color} size="sm" variant="flat">
                                                    {getMaterialKind(material.filename).label}
                                                </Chip>
                                                {material.filename}
                                                {!material.filePath ? (
                                                    <Chip color="danger" size="sm" variant="flat">
                                                        缺少路径
                                                    </Chip>
                                                ) : null}
                                            </span>
                                            <span className="break-all text-tiny text-default-500">
                                                {formatMaterialSize(material.filesizeMb)} · {material.filePath || "不可发布"}
                                            </span>
                                        </span>
                                    </Checkbox>
                                ))
                            ) : (
                                <p className="text-small text-default-500">暂无可用素材。</p>
                            )}
                        </div>
                    </section>
                </div>

                <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
                    <Input
                        isRequired
                        label="发布标题"
                        labelPlacement="outside"
                        placeholder="输入各平台共用标题"
                        value={title}
                        onValueChange={setTitle}
                    />
                    <Input
                        label="标签"
                        labelPlacement="outside"
                        placeholder="用逗号、空格或 # 分隔"
                        value={tagsText}
                        onValueChange={setTagsText}
                    />
                </div>

                <Textarea
                    label="发布文案 / B站简介"
                    labelPlacement="outside"
                    minRows={4}
                    placeholder="小红书笔记会从来源 caption 预填；B站发布会把这里作为简介传给 发布服务。"
                    value={description}
                    onValueChange={setDescription}
                />

                <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                    <div className="mb-4 flex flex-col gap-1">
                        <h4 className="text-small font-semibold text-default-900">封面策略</h4>
                        <p className="text-tiny text-default-500">
                            从本地素材库选择封面路径；快手优先 3:4/4:3，B站优先 16:9/4:3，其他平台使用默认封面。
                        </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <MaterialPathSelect
                            label="默认封面"
                            materials={materials}
                            value={coverPath}
                            onChange={setCoverPath}
                        />
                        <MaterialPathSelect
                            label="3:4 封面"
                            materials={materials}
                            value={coverPath34}
                            onChange={setCoverPath34}
                        />
                        <MaterialPathSelect
                            label="4:3 封面"
                            materials={materials}
                            value={coverPath43}
                            onChange={setCoverPath43}
                        />
                        <MaterialPathSelect
                            label="16:9 封面"
                            materials={materials}
                            value={coverPath169}
                            onChange={setCoverPath169}
                        />
                    </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                    <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h4 className="text-small font-semibold text-default-900">定时发布</h4>
                                <p className="mt-1 text-tiny text-default-500">
                                    传给 发布服务 的批量排期参数；关闭时立即进入发布流程。
                                </p>
                            </div>
                            <Switch isSelected={timerEnabled} onValueChange={setTimerEnabled}>
                                启用
                            </Switch>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <Input
                                isDisabled={!timerEnabled}
                                label="每天条数"
                                labelPlacement="outside"
                                min={1}
                                type="number"
                                value={videosPerDay}
                                onValueChange={setVideosPerDay}
                            />
                            <Input
                                isDisabled={!timerEnabled}
                                label="起始天数"
                                labelPlacement="outside"
                                min={0}
                                type="number"
                                value={startDays}
                                onValueChange={setStartDays}
                            />
                            <Input
                                isDisabled={!timerEnabled}
                                label="每日时间"
                                labelPlacement="outside"
                                placeholder="10:00, 18:30"
                                value={dailyTimesText}
                                onValueChange={setDailyTimesText}
                            />
                            <Input
                                isDisabled={!timerEnabled}
                                label="随机浮动分钟"
                                labelPlacement="outside"
                                min={0}
                                type="number"
                                value={timeJitterMinutes}
                                onValueChange={setTimeJitterMinutes}
                            />
                            <Input
                                className="md:col-span-2"
                                isDisabled={!timerEnabled}
                                label="固定发布时间"
                                labelPlacement="outside"
                                placeholder="可选，例如 2026-05-29 10:00"
                                value={scheduleTime}
                                onValueChange={setScheduleTime}
                            />
                        </div>
                    </section>

                    <section className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-4">
                            <h4 className="text-small font-semibold text-default-900">B站参数</h4>
                            <p className="mt-1 text-tiny text-default-500">
                                仅 B站账号使用；其他平台会忽略这些字段。
                            </p>
                        </div>
                        <div className="grid gap-3">
                            <Input
                                label="B站标题"
                                labelPlacement="outside"
                                placeholder="不填则使用发布标题"
                                value={biliTitle}
                                onValueChange={setBiliTitle}
                            />
                            <div className="grid gap-3 md:grid-cols-2">
                                <Input
                                    label="类型"
                                    labelPlacement="outside"
                                    placeholder="自制 / 转载"
                                    value={biliType}
                                    onValueChange={setBiliType}
                                />
                                <Input
                                    label="分区"
                                    labelPlacement="outside"
                                    placeholder="例如 生活 / 科技"
                                    value={biliPartition}
                                    onValueChange={setBiliPartition}
                                />
                            </div>
                        </div>
                    </section>
                </div>

                <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-small font-semibold text-default-900">执行方式</p>
                            <p className="mt-1 text-small text-default-500">
                                {realPublishEnabled
                                    ? "真实发布会由本机浏览器实际提交到平台，点击提交后还需要二次确认。"
                                    : "预发布检查会打开平台页面并停在最终发布前，适合确认账号、素材和页面流程。"}
                            </p>
                        </div>
                        <Switch
                            color="danger"
                            isSelected={realPublishEnabled}
                            onValueChange={setRealPublishEnabled}
                        >
                            真实发布
                        </Switch>
                    </div>
                </div>

                {statusMessage ? (
                    <div className="flex flex-col gap-3 rounded-[10px] border-small border-divider bg-default-50 p-3 text-small text-default-600 md:flex-row md:items-center md:justify-between">
                        <span className="whitespace-pre-wrap">{statusMessage}</span>
                        <div className="flex flex-wrap gap-2">
                            <Button as={Link} href="/confirmations" size="sm" variant="flat">
                                待我确认
                            </Button>
                            <Button as={Link} href="/artifacts" size="sm" variant="flat">
                                操作证据
                            </Button>
                            <Button as={Link} href="/distribution?tab=tasks" size="sm" variant="flat">
                                发布任务
                            </Button>
                        </div>
                    </div>
                ) : null}

                {preflightResult && !preflightResult.ok ? (
                    <PreflightIssueList result={preflightResult} />
                ) : null}

                {publishResults.length ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-small font-semibold text-default-900">本次发布结果</p>
                            <Chip size="sm" variant="flat">
                                {publishResults.length} 个平台
                            </Chip>
                        </div>
                        <div className="grid gap-2">
                            {publishResults.map((item, index) => (
                                <div
                                    key={`${item.type}-${item.accountName || item.account || index}`}
                                    className="flex flex-col gap-2 rounded-[10px] border-small border-divider bg-background p-3 md:flex-row md:items-start md:justify-between"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Chip color={resolvePublishResultColor(item.ok)} size="sm" variant="flat">
                                                {resolvePublishResultLabel(item)}
                                            </Chip>
                                            <span className="text-small font-semibold text-default-900">
                                                {item.platform || `平台 ${item.type}`}
                                            </span>
                                            <span className="text-small text-default-500">
                                                {item.accountName || item.account || "-"}
                                            </span>
                                        </div>
                                        <p className="mt-1 break-words text-small text-default-600">
                                            {item.message || (item.ok ? "已提交" : "暂无详情")}
                                        </p>
                                        {item.nextAction ? (
                                            <p className="mt-1 break-words text-tiny text-default-500">
                                                下一步：{item.nextAction}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="flex justify-end">
                    <Button
                        color={realPublishEnabled ? "danger" : "primary"}
                        isDisabled={!canSubmitPublish}
                        isLoading={submitting}
                        startContent={submitting ? null : <Icon icon="solar:send-square-linear" />}
                        onPress={handleSubmit}
                    >
                        {canSubmitPublish ? (realPublishEnabled ? "提交真实发布" : "提交预发布检查") : "已阻断，先处理条件"}
                    </Button>
                </div>
            </CardBody>
            <Modal isOpen={confirmPublishOpen} onOpenChange={setConfirmPublishOpen} size="md">
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className="flex flex-col gap-1">确认真实发布</ModalHeader>
                            <ModalBody>
                                <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                                    这一步会让本地发布服务实际操作平台发布流程，不再停在最终确认前。
                                </div>
                                <div className="grid gap-3 text-small text-default-700">
                                    <StatusItem label="标题" value={title.trim() || "-"} />
                                    <StatusItem label="平台账号" value={`${selectedAccounts.length} 个`} />
                                    <StatusItem label="素材" value={`${selectedMaterialPaths.length} 个`} />
                                    <StatusItem
                                        label="封面"
                                        value={[
                                            coverPath ? "默认" : "",
                                            coverPath34 ? "3:4" : "",
                                            coverPath43 ? "4:3" : "",
                                            coverPath169 ? "16:9" : "",
                                        ].filter(Boolean).join("、") || "-"}
                                    />
                                    <StatusItem label="标签" value={tagsText.trim() || "-"} />
                                    <StatusItem label="定时" value={timerEnabled ? `启用，${dailyTimesText}` : "关闭"} />
                                    <StatusItem label="文案" value={description.trim() ? `${description.trim().slice(0, 80)}${description.trim().length > 80 ? "..." : ""}` : "-"} wide />
                                </div>
                            </ModalBody>
                            <ModalFooter>
                                <Button variant="light" onPress={onClose} isDisabled={submitting}>
                                    取消
                                </Button>
                                <Button
                                    color="danger"
                                    isLoading={submitting}
                                    onPress={() => {
                                        void submitPublishConfirmation();
                                    }}
                                >
                                    进入待我确认
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </Card>
    );
}

function AccountsPanel({
    accounts,
    error,
    loading,
    onRefresh,
    onSetAccounts,
}: {
    accounts: AutoUploadAccount[];
    error: string;
    loading: boolean;
    onRefresh: () => Promise<void>;
    onSetAccounts: (accounts: AutoUploadAccount[]) => void;
}) {
    const [checking, setChecking] = React.useState(false);
    const [openingId, setOpeningId] = React.useState<number | null>(null);
    const [refreshingAvatarId, setRefreshingAvatarId] = React.useState<number | null>(null);
    const [accountToDelete, setAccountToDelete] = React.useState<AutoUploadAccount | null>(null);
    const [deleting, setDeleting] = React.useState(false);
    const [loginOpen, setLoginOpen] = React.useState(false);
    const [loginProfileName, setLoginProfileName] = React.useState("");
    const [loginPlatformType, setLoginPlatformType] = React.useState(3);
    const [loginRecord, setLoginRecord] = React.useState<AutoUploadAccount | null>(null);
    const [loginRequestId, setLoginRequestId] = React.useState("");
    const [loginQrCode, setLoginQrCode] = React.useState("");
    const [loginStatus, setLoginStatus] = React.useState("");
    const [loginError, setLoginError] = React.useState("");
    const [loginConnecting, setLoginConnecting] = React.useState(false);
    const eventSourceRef = React.useRef<EventSource | null>(null);
    const loginTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const closeLoginStream = React.useCallback(() => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        if (loginTimerRef.current) {
            clearTimeout(loginTimerRef.current);
            loginTimerRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        return () => {
            closeLoginStream();
        };
    }, [closeLoginStream]);

    const openLoginModal = (account?: AutoUploadAccount) => {
        closeLoginStream();
        setLoginRecord(account || null);
        setLoginProfileName(account?.profileName || account?.userName || "");
        setLoginPlatformType(account?.type || 3);
        setLoginRequestId("");
        setLoginQrCode("");
        setLoginStatus("");
        setLoginError("");
        setLoginConnecting(false);
        setLoginOpen(true);
    };

    const cancelLogin = async (closeModal = true) => {
        const requestId = loginRequestId;
        closeLoginStream();
        if (loginConnecting && requestId) {
            try {
                await autoUploadApi.cancelLogin(requestId);
            } catch {
                addToast({ title: "已关闭登录窗口", color: "warning" });
            }
        }
        setLoginConnecting(false);
        setLoginQrCode("");
        setLoginStatus("");
        setLoginError("");
        setLoginRequestId("");
        if (closeModal) {
            setLoginOpen(false);
        }
    };

    const startLogin = () => {
        const profileName = loginProfileName.trim();
        if (!profileName) {
            addToast({ title: "请填写账号主体名称", color: "warning" });
            return;
        }

        closeLoginStream();
        const requestId = createRequestId();
        setLoginRequestId(requestId);
        setLoginQrCode("");
        setLoginStatus("");
        setLoginError("");
        setLoginConnecting(true);

        let hasQrCode = false;
        let completed = false;
        const source = new EventSource(
            autoUploadApi.loginUrl({
                type: loginPlatformType,
                profileName,
                requestId,
                update: Boolean(loginRecord),
                recordId: loginRecord?.id,
            }),
            { withCredentials: true },
        );
        eventSourceRef.current = source;
        loginTimerRef.current = setTimeout(() => {
            if (!hasQrCode && !completed) {
                setLoginStatus("500");
                setLoginError("登录页面加载超时，暂未获取到二维码。");
                closeLoginStream();
                setLoginConnecting(false);
            }
        }, 65000);

        source.onmessage = (event) => {
            const data = event.data;
            if (data.startsWith("ERROR:")) {
                const message = data.replace(/^ERROR:\s*/, "") || "绑定失败，请稍后再试";
                completed = true;
                setLoginStatus("500");
                setLoginError(message);
                closeLoginStream();
                setLoginConnecting(false);
                addToast({ title: "登录失败", description: message, color: "danger" });
                return;
            }

            if (data === "CANCELLED") {
                completed = true;
                closeLoginStream();
                setLoginConnecting(false);
                setLoginOpen(false);
                return;
            }

            if (data.startsWith("ACCOUNT_ID:")) {
                return;
            }

            if (!hasQrCode && data.length > 100) {
                hasQrCode = true;
                setLoginQrCode(data.startsWith("data:image") ? data : `data:image/png;base64,${data}`);
                return;
            }

            if (data === "200" || data === "500") {
                completed = true;
                setLoginStatus(data);
                closeLoginStream();
                setLoginConnecting(false);
                if (data === "200") {
                    addToast({ title: loginRecord ? "重新登录成功" : "绑定成功", color: "success" });
                    onRefresh().catch(() => undefined);
                    setTimeout(() => setLoginOpen(false), 900);
                } else {
                    setLoginError("绑定失败，请稍后再试");
                }
            }
        };

        source.onerror = () => {
            completed = true;
            closeLoginStream();
            setLoginConnecting(false);
            setLoginStatus("500");
            setLoginError("登录连接中断，请确认本地服务仍在运行。");
            addToast({ title: "登录连接中断", color: "danger" });
        };
    };

    const handleCheckAccounts = async () => {
        setChecking(true);
        try {
            const result = await loadLocalPlatformAccounts({ validate: true, force: true });
            onSetAccounts(result);
            addToast({ title: "账号状态校验完成", color: "success" });
        } catch (e: unknown) {
            addToast({
                title: "账号校验失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setChecking(false);
        }
    };

    const handleOpenAccount = async (account: AutoUploadAccount) => {
        setOpeningId(account.id);
        try {
            await autoUploadApi.openAccounts([account.id]);
            addToast({ title: "已请求打开平台后台", color: "success" });
        } catch (e: unknown) {
            addToast({
                title: "打开失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setOpeningId(null);
        }
    };

    const handleRefreshAvatar = async (account: AutoUploadAccount) => {
        setRefreshingAvatarId(account.id);
        try {
            await autoUploadApi.refreshAccountAvatar(account.id);
            await onRefresh();
            addToast({ title: "账号头像已刷新", color: "success" });
        } catch (e: unknown) {
            addToast({
                title: "头像刷新失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setRefreshingAvatarId(null);
        }
    };

    const handleDeleteAccount = async () => {
        if (!accountToDelete) return;

        setDeleting(true);
        try {
            await autoUploadApi.deleteAccount(accountToDelete.id, buildRiskConfirmation('platform-account-delete'));
            addToast({ title: "账号已删除", color: "success" });
            setAccountToDelete(null);
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "删除失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">平台账号</h3>
                        <p className="text-small text-default-500">
                            账号由 3010 统一读取，本地浏览器账号会同步校验登录态。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            color="primary"
                            startContent={<Icon icon="solar:add-circle-linear" />}
                            variant="flat"
                            onPress={() => openLoginModal()}
                        >
                            绑定平台
                        </Button>
                        <Button
                            color="primary"
                            isLoading={loading}
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            variant="flat"
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "账号刷新失败", color: "danger" });
                                });
                            }}
                        >
                            刷新账号
                        </Button>
                        <Button
                            color="primary"
                            isLoading={checking}
                            startContent={checking ? null : <Icon icon="solar:shield-check-linear" />}
                            variant="solid"
                            onPress={handleCheckAccounts}
                        >
                            校验状态
                        </Button>
                    </div>
                </div>
                {error ? (
                    <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                        {error}
                    </div>
                ) : null}
                <Table
                    aria-label="平台账号列表"
                    className="border-small border-divider rounded-[10px]"
                    removeWrapper
                >
                    <TableHeader>
                        <TableColumn>平台</TableColumn>
                        <TableColumn>账号</TableColumn>
                        <TableColumn>状态</TableColumn>
                        <TableColumn>Cookie 文件</TableColumn>
                        <TableColumn>更新时间</TableColumn>
                        <TableColumn>操作</TableColumn>
                    </TableHeader>
                    <TableBody
                        emptyContent={loading ? "正在加载账号..." : "暂无平台账号"}
                        isLoading={loading}
                        loadingContent={<Spinner size="sm" />}
                    >
                        {accounts.map((account) => (
                            <TableRow key={account.id}>
                                <TableCell>
                                    <Chip size="sm" variant="flat">
                                        {account.platform}
                                    </Chip>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-small font-medium text-default-900">
                                            {account.profileName || account.userName || `账号 ${account.id}`}
                                        </span>
                                        <span className="text-tiny text-default-400">
                                            ID {account.id}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {account.sessionStatus && account.sessionStatus !== "unknown" ? (
                                        <Chip
                                            color={
                                                account.sessionStatus === "logged_in"
                                                    ? "success"
                                                    : account.sessionStatus === "needs_login"
                                                        ? "warning"
                                                        : "danger"
                                            }
                                            size="sm"
                                            variant="flat"
                                            title={`最近 dispatch: ${account.lastDispatchAt || "-"} (${account.lastDispatchReason || "-"})`}
                                        >
                                            {account.sessionStatus === "logged_in"
                                                ? "已登录"
                                                : account.sessionStatus === "needs_login"
                                                    ? "未登录"
                                                    : "异常"}
                                        </Chip>
                                    ) : (
                                        <Chip
                                            color="default"
                                            size="sm"
                                            variant="flat"
                                            title="24h 内无 dispatch, 无法判定 session 状态"
                                        >
                                            待验证
                                        </Chip>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <span className="break-all text-tiny text-default-500">
                                        {account.filePath}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="text-small text-default-500">
                                        {account.avatarUpdatedAt || "-"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            size="sm"
                                            startContent={<Icon icon="solar:external-link-linear" />}
                                            variant="flat"
                                            isLoading={openingId === account.id}
                                            onPress={() => handleOpenAccount(account)}
                                        >
                                            打开
                                        </Button>
                                        <Button
                                            size="sm"
                                            startContent={<Icon icon="solar:user-check-linear" />}
                                            variant="flat"
                                            isLoading={refreshingAvatarId === account.id}
                                            onPress={() => handleRefreshAvatar(account)}
                                        >
                                            刷新头像
                                        </Button>
                                        <Button
                                            color="danger"
                                            size="sm"
                                            startContent={<Icon icon="solar:trash-bin-minimalistic-linear" />}
                                            variant="flat"
                                            onPress={() => setAccountToDelete(account)}
                                        >
                                            删除
                                        </Button>
                                        <Button
                                            color="warning"
                                            size="sm"
                                            startContent={<Icon icon="solar:restart-circle-linear" />}
                                            variant="flat"
                                            onPress={() => openLoginModal(account)}
                                        >
                                            重登
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </CardBody>
            </Card>
            <Modal
                isOpen={Boolean(accountToDelete)}
                onOpenChange={(open) => {
                    if (!open && !deleting) {
                        setAccountToDelete(null);
                    }
                }}
            >
                <ModalContent>
                    <ModalHeader>确认删除账号</ModalHeader>
                    <ModalBody>
                        <p className="text-small text-default-600">
                            删除后会移除 发布服务 本地账号记录和 Cookie 文件：
                        </p>
                        <p className="text-small font-medium text-default-900">
                            {accountToDelete?.platform} · {accountToDelete?.profileName || accountToDelete?.userName}
                        </p>
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            isDisabled={deleting}
                            variant="light"
                            onPress={() => setAccountToDelete(null)}
                        >
                            取消
                        </Button>
                        <Button color="danger" isLoading={deleting} onPress={handleDeleteAccount}>
                            删除
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
            <Modal
                isOpen={loginOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        cancelLogin(true).catch(() => undefined);
                    }
                }}
            >
                <ModalContent>
                    <ModalHeader>{loginRecord ? "重新登录平台账号" : "绑定平台账号"}</ModalHeader>
                    <ModalBody>
                        <Input
                            isDisabled={loginConnecting}
                            isRequired
                            label="账号主体"
                            labelPlacement="outside"
                            placeholder="例如：矩阵账号01"
                            value={loginProfileName}
                            onValueChange={setLoginProfileName}
                        />
                        <div>
                            <p className="mb-2 text-tiny font-medium text-default-500">绑定平台</p>
                            <div className="flex flex-wrap gap-2">
                                {loginPlatforms.map((platform) => (
                                    <Button
                                        key={platform.type}
                                        color={loginPlatformType === platform.type ? "primary" : "default"}
                                        isDisabled={loginConnecting}
                                        size="sm"
                                        variant={loginPlatformType === platform.type ? "solid" : "flat"}
                                        onPress={() => setLoginPlatformType(platform.type)}
                                    >
                                        {platform.name}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        {loginConnecting || loginQrCode || loginStatus ? (
                            <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-center">
                                {loginQrCode && !loginStatus ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <p className="text-small text-default-600">请使用对应平台 APP 扫码登录</p>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            alt="登录二维码"
                                            className="h-52 w-52 rounded-[10px] bg-white object-contain p-2"
                                            src={loginQrCode}
                                        />
                                    </div>
                                ) : null}
                                {!loginQrCode && !loginStatus ? (
                                    <div className="flex items-center justify-center gap-2 text-small text-default-500">
                                        <Spinner size="sm" />
                                        正在请求登录二维码...
                                    </div>
                                ) : null}
                                {loginStatus === "200" ? (
                                    <p className="text-small font-medium text-success">绑定成功</p>
                                ) : null}
                                {loginStatus === "500" ? (
                                    <p className="text-small font-medium text-danger">
                                        {loginError || "绑定失败，请稍后再试"}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            variant="light"
                            onPress={() => {
                                cancelLogin(true).catch(() => undefined);
                            }}
                        >
                            取消
                        </Button>
                        <Button
                            color="primary"
                            isDisabled={loginConnecting}
                            isLoading={loginConnecting}
                            onPress={startLogin}
                        >
                            {loginConnecting ? "请求中" : "开始绑定"}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}

function MaterialsPanel({
    error,
    loading,
    materials,
    onRefresh,
}: {
    error: string;
    loading: boolean;
    materials: AutoUploadMaterial[];
    onRefresh: () => Promise<void>;
}) {
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
    const [customFilename, setCustomFilename] = React.useState("");
    const [uploading, setUploading] = React.useState(false);
    const [previewMaterial, setPreviewMaterial] = React.useState<AutoUploadMaterial | null>(null);
    const [materialToDelete, setMaterialToDelete] = React.useState<AutoUploadMaterial | null>(null);
    const [deleting, setDeleting] = React.useState(false);

    const handleUpload = async () => {
        if (!selectedFile) {
            addToast({ title: "请选择要上传的文件", color: "warning" });
            return;
        }

        const formData = new FormData();
        formData.append("file", selectedFile);
        if (customFilename.trim()) {
            formData.append("filename", customFilename.trim());
        }

        setUploading(true);
        try {
            await autoUploadApi.uploadMaterial(formData);
            addToast({ title: "上传成功", color: "success" });
            setSelectedFile(null);
            setCustomFilename("");
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "上传失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async () => {
        if (!materialToDelete) return;

        setDeleting(true);
        try {
            await autoUploadApi.deleteMaterial(materialToDelete.id, buildRiskConfirmation('local-file-delete'));
            addToast({ title: "素材已删除", color: "success" });
            if (previewMaterial?.id === materialToDelete.id) {
                setPreviewMaterial(null);
            }
            setMaterialToDelete(null);
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "删除失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">发布素材</h3>
                        <p className="text-small text-default-500">
                            素材来自 本地文件库，可直接用于图文发布、视频发布和任务重试。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button as={Link} href="/distribution?tab=article" size="sm" variant="flat">
                            图文发布
                        </Button>
                        <Button as={Link} href="/distribution?tab=video" size="sm" variant="flat">
                            视频发布
                        </Button>
                        <Button
                            color="primary"
                            isLoading={loading}
                            size="sm"
                            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                            variant="flat"
                            onPress={() => {
                                onRefresh().catch(() => {
                                    addToast({ title: "素材刷新失败", color: "danger" });
                                });
                            }}
                        >
                            刷新素材
                        </Button>
                    </div>
                </div>
                {error ? (
                    <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                        {error}
                    </div>
                ) : null}
                <div className="grid gap-3 rounded-[10px] border-small border-divider bg-default-50 p-4 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
                    <div>
                        <p className="mb-2 text-tiny font-medium text-default-500">选择文件</p>
                        <input
                            ref={fileInputRef}
                            className="block w-full text-small text-default-600 file:mr-3 file:rounded-[10px] file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-small file:font-medium file:text-primary"
                            type="file"
                            onChange={(event) => {
                                setSelectedFile(event.target.files?.[0] || null);
                            }}
                        />
                    </div>
                    <Input
                        label="自定义文件名"
                        labelPlacement="outside"
                        placeholder="选填，不含扩展名"
                        value={customFilename}
                        onValueChange={setCustomFilename}
                    />
                    <Button
                        color="primary"
                        isDisabled={!selectedFile}
                        isLoading={uploading}
                        startContent={uploading ? null : <Icon icon="solar:upload-linear" />}
                        onPress={handleUpload}
                    >
                        上传素材
                    </Button>
                </div>
                <Table
                    aria-label="发布素材列表"
                    className="border-small border-divider rounded-[10px]"
                    removeWrapper
                >
                    <TableHeader>
                        <TableColumn>文件名</TableColumn>
                        <TableColumn>大小</TableColumn>
                        <TableColumn>上传时间</TableColumn>
                        <TableColumn>本地文件</TableColumn>
                        <TableColumn>操作</TableColumn>
                    </TableHeader>
                    <TableBody
                        emptyContent={loading ? "正在加载素材..." : "暂无发布素材"}
                        isLoading={loading}
                        loadingContent={<Spinner size="sm" />}
                    >
                        {materials.map((material) => (
                            <TableRow key={material.id}>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Icon className="text-primary" icon={getMaterialKind(material.filename).icon} width={18} />
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Chip color={getMaterialKind(material.filename).color} size="sm" variant="flat">
                                                    {getMaterialKind(material.filename).label}
                                                </Chip>
                                                {!material.filePath ? (
                                                    <Chip color="danger" size="sm" variant="flat">
                                                        不可发布
                                                    </Chip>
                                                ) : null}
                                            </div>
                                            <span className="break-all text-small font-medium text-default-900">
                                                {material.filename}
                                            </span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className="text-small text-default-500">
                                        {formatMaterialSize(material.filesizeMb)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="text-small text-default-500">
                                        {material.uploadTime || "-"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="break-all text-tiny text-default-500">
                                        {material.filePath || "-"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            isDisabled={!material.filePath}
                                            size="sm"
                                            startContent={<Icon icon="solar:eye-linear" />}
                                            variant="flat"
                                            onPress={() => setPreviewMaterial(material)}
                                        >
                                            预览
                                        </Button>
                                        <Button
                                            color="danger"
                                            size="sm"
                                            startContent={<Icon icon="solar:trash-bin-minimalistic-linear" />}
                                            variant="flat"
                                            onPress={() => setMaterialToDelete(material)}
                                        >
                                            删除
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {previewMaterial ? (
                    <div className="rounded-[10px] border-small border-divider bg-default-50 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h4 className="text-small font-semibold text-default-900">素材预览</h4>
                                <p className="break-all text-tiny text-default-500">{previewMaterial.filename}</p>
                            </div>
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                onPress={() => setPreviewMaterial(null)}
                            >
                                <Icon icon="solar:close-circle-linear" width={18} />
                            </Button>
                        </div>
                        <MaterialPreview material={previewMaterial} />
                    </div>
                ) : null}
                </CardBody>
            </Card>
            <Modal
                isOpen={Boolean(materialToDelete)}
                onOpenChange={(open) => {
                    if (!open && !deleting) {
                        setMaterialToDelete(null);
                    }
                }}
            >
                <ModalContent>
                    <ModalHeader>确认删除素材</ModalHeader>
                    <ModalBody>
                        <p className="text-small text-default-600">
                            删除后会同时移除 本地数据库记录和本地文件：
                        </p>
                        <p className="break-all text-small font-medium text-default-900">
                            {materialToDelete?.filename}
                        </p>
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            isDisabled={deleting}
                            variant="light"
                            onPress={() => setMaterialToDelete(null)}
                        >
                            取消
                        </Button>
                        <Button color="danger" isLoading={deleting} onPress={handleDelete}>
                            删除
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}

function TasksPanel({
    error,
    loading,
    onRefresh,
    tasks,
}: {
    error: string;
    loading: boolean;
    onRefresh: () => Promise<void>;
    tasks: AutoUploadPublishTask[];
}) {
    const [selectedTask, setSelectedTask] = React.useState<AutoUploadPublishTask | null>(null);
    const [retryingTaskId, setRetryingTaskId] = React.useState<number | null>(null);

    const handleRetry = async (task: AutoUploadPublishTask) => {
        setRetryingTaskId(task.id);
        try {
            const retry = await autoUploadApi.retryTask(task.id, buildRiskConfirmation('retry-publish'));
            const results = retry.result?.results || [];
            const failures = results.filter((item) => item.ok === false);
            const pending = results.filter((item) => item.ok !== true && item.ok !== false);
            const missingFields = retry.missingFields || [];
            const restoredText = retry.restoredFields?.length
                ? `已恢复：${retry.restoredFields.join("、")}`
                : retry.payloadSource === "reconstructed"
                    ? "未找到原始参数，已按任务记录重建基础参数"
                    : undefined;
            const missingText = missingFields.length
                ? `缺少字段：${missingFields.join("、")}`
                : undefined;
            addToast({
                title: missingFields.length ? "重试参数不完整" : failures.length ? "重试已提交但仍有失败" : pending.length ? "重试已提交，等待平台证据" : "重试任务已确认",
                description: [
                    failures.length ? failures.map((item) => `${item.platform || item.type}：${item.message || "失败"}`).join("；") : null,
                    pending.length ? pending.map((item) => `${item.platform || item.type}：${item.message || "待平台回执或回读"}`).join("；") : null,
                    restoredText,
                    missingText,
                ].filter(Boolean).join("；") || undefined,
                color: missingFields.length || failures.length || pending.length ? "warning" : "success",
            });
            await onRefresh();
        } catch (e: unknown) {
            addToast({
                title: "重试失败",
                description: e instanceof Error ? e.message : "未知错误",
                color: "danger",
            });
        } finally {
            setRetryingTaskId(null);
        }
    };

    return (
        <>
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody className="gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-medium font-semibold text-default-900">发布任务</h3>
                            <p className="text-small text-default-500">
                                发布中心提交后会写入 本地任务表。
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button as={Link} href="/execution-records" size="sm" variant="flat">
                                执行记录
                            </Button>
                            <Button as={Link} href="/artifacts" size="sm" variant="flat">
                                操作证据
                            </Button>
                            <Button
                                color="primary"
                                isLoading={loading}
                                size="sm"
                                startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                                variant="flat"
                                onPress={() => {
                                    onRefresh().catch(() => {
                                        addToast({ title: "任务刷新失败", color: "danger" });
                                    });
                                }}
                            >
                                刷新任务
                            </Button>
                        </div>
                    </div>
                    {error ? (
                        <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                            {error}
                        </div>
                    ) : null}
                    <Table
                        aria-label="发布任务列表"
                        className="border-small border-divider rounded-[10px]"
                        removeWrapper
                    >
                        <TableHeader>
                            <TableColumn>任务</TableColumn>
                            <TableColumn>平台</TableColumn>
                            <TableColumn>模式</TableColumn>
                            <TableColumn>状态</TableColumn>
                            <TableColumn>素材</TableColumn>
                            <TableColumn>更新时间</TableColumn>
                            <TableColumn>操作</TableColumn>
                        </TableHeader>
                        <TableBody
                            emptyContent={loading ? "正在加载任务..." : "暂无发布任务"}
                            isLoading={loading}
                            loadingContent={<Spinner size="sm" />}
                        >
                            {tasks.map((task) => (
                                <TableRow key={task.id}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-small font-medium text-default-900">
                                                {task.title || `任务 ${task.id}`}
                                            </span>
                                            <span className="text-tiny text-default-500">
                                                {task.message || "-"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="sm" variant="flat">
                                            {task.platform}
                                        </Chip>
                                    </TableCell>
                                    <TableCell>
                                        <Chip color={task.dry_run ? "warning" : "success"} size="sm" variant="flat">
                                            {task.dry_run ? "预发布" : "发布"}
                                        </Chip>
                                    </TableCell>
                                    <TableCell>
                                        <Chip color={getTaskStatusColor(task.status)} size="sm" variant="flat">
                                            {resolveTaskStatus(task.status)}
                                        </Chip>
                                    </TableCell>
                                    <TableCell>
                                        <span className="line-clamp-2 break-all text-tiny text-default-500">
                                            {(task.file_list || []).join("、") || "-"}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-small text-default-500">
                                            {new Date(task.updated_at).toLocaleString()}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                size="sm"
                                                startContent={<Icon icon="solar:eye-linear" />}
                                                variant="flat"
                                                onPress={() => setSelectedTask(task)}
                                            >
                                                详情
                                            </Button>
                                            <Button
                                                color={task.status === "failed" ? "danger" : "default"}
                                                isLoading={retryingTaskId === task.id}
                                                size="sm"
                                                startContent={retryingTaskId === task.id ? null : <Icon icon="solar:restart-linear" />}
                                                variant="flat"
                                                onPress={() => {
                                                    void handleRetry(task);
                                                }}
                                            >
                                                重试
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardBody>
            </Card>

            <Modal
                isOpen={Boolean(selectedTask)}
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectedTask(null);
                    }
                }}
                scrollBehavior="inside"
                size="3xl"
            >
                <ModalContent>
                    <ModalHeader className="flex flex-col gap-1">
                        <span>任务详情</span>
                        <span className="text-small font-normal text-default-500">
                            #{selectedTask?.id} · {selectedTask?.platform}
                        </span>
                    </ModalHeader>
                    <ModalBody>
                        {selectedTask ? <TaskDetail task={selectedTask} /> : null}
                    </ModalBody>
                    <ModalFooter>
                        {selectedTask ? (
                            <Button
                                color={selectedTask.status === "failed" ? "danger" : "default"}
                                isLoading={retryingTaskId === selectedTask.id}
                                startContent={retryingTaskId === selectedTask.id ? null : <Icon icon="solar:restart-linear" />}
                                variant="flat"
                                onPress={() => {
                                    void handleRetry(selectedTask);
                                }}
                            >
                                重试任务
                            </Button>
                        ) : null}
                        <Button color="primary" variant="flat" onPress={() => setSelectedTask(null)}>
                            关闭
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}

function TaskDetail({ task }: { task: AutoUploadPublishTask }) {
    const summary = summarizeTaskResult(task.result);
    const failureContext: LocalEngineFailureContext | null = task.status === "failed" || summary.failures.length
        ? {
            platform: summary.failures[0]?.platform || task.platform || String(task.platform_type),
            account: summary.failures[0]?.account || task.account_file || "未识别账号",
            target: task.title || `任务 ${task.id}`,
            stage: task.dry_run ? "预发布检查" : "真实发布",
            reason: summary.failures[0]?.message || task.message || "发布任务失败",
            nextAction: "处理账号登录态、素材路径或平台页面权限后重试。",
        }
        : null;

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2">
                <StatusItem label="标题" value={task.title || "-"} />
                <StatusItem label="平台" value={task.platform || String(task.platform_type)} />
                <StatusItem label="模式" value={task.dry_run ? "预发布检查" : "真实发布"} />
                <StatusItem label="状态" value={resolveTaskStatus(task.status)} />
                <StatusItem label="账号文件" value={task.account_file || "-"} wide />
                <StatusItem label="创建时间" value={new Date(task.created_at).toLocaleString()} />
                <StatusItem label="更新时间" value={new Date(task.updated_at).toLocaleString()} />
            </div>

            {task.message ? (
                <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                    <p className="text-tiny font-semibold text-default-500">任务消息</p>
                    <p className="mt-1 whitespace-pre-wrap text-small text-default-700">{task.message}</p>
                </div>
            ) : null}

            {failureContext ? <FailureContextBox context={failureContext} /> : null}

            <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-tiny font-semibold text-default-500">平台证据明细</p>
                    <Chip color="success" size="sm" variant="flat">
                        已确认 {summary.succeeded.length}
                    </Chip>
                    <Chip color="danger" size="sm" variant="flat">
                        失败 {summary.failures.length}
                    </Chip>
                    <Chip color="warning" size="sm" variant="flat">
                        未执行 {summary.pending.length}
                    </Chip>
                </div>
                <div className="mt-3 grid gap-2">
                    {summary.results.length ? (
                        summary.results.map((item, index) => (
                            <div
                                key={`${item.type}-${item.account || index}`}
                                className="rounded-small border-small border-divider bg-background p-3"
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <Chip color={resolvePublishResultColor(item.ok)} size="sm" variant="flat">
                                        {resolvePublishResultLabel(item)}
                                    </Chip>
                                    <span className="text-small font-semibold text-default-900">
                                        {item.platform || `平台 ${item.type}`}
                                    </span>
                                    <span className="text-tiny text-default-500">
                                        {item.account || task.account_file || "-"}
                                    </span>
                                </div>
                                <p className="mt-1 break-words text-small text-default-600">
                                    {item.message || (item.ok ? "已提交" : "暂无详情")}
                                </p>
                                {item.nextAction ? (
                                    <p className="mt-1 break-words text-tiny text-default-500">
                                        下一步：{item.nextAction}
                                    </p>
                                ) : null}
                            </div>
                        ))
                    ) : (
                        <p className="text-small text-default-500">当前任务还没有结构化结果，保留原始 JSON 便于排查。</p>
                    )}
                </div>
            </div>

            <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                <p className="text-tiny font-semibold text-default-500">素材文件</p>
                <div className="mt-2 flex flex-col gap-1">
                    {(task.file_list || []).length ? (
                        task.file_list?.map((file) => (
                            <code key={file} className="break-all rounded-small bg-background px-2 py-1 text-tiny text-default-700">
                                {file}
                            </code>
                        ))
                    ) : (
                        <span className="text-small text-default-500">无</span>
                    )}
                </div>
            </div>

            <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                <p className="text-tiny font-semibold text-default-500">标签</p>
                <div className="mt-2 flex flex-wrap gap-2">
                    {(task.tags || []).length ? (
                        task.tags?.map((tag) => (
                            <Chip key={tag} size="sm" variant="flat">
                                {tag}
                            </Chip>
                        ))
                    ) : (
                        <span className="text-small text-default-500">无</span>
                    )}
                </div>
            </div>

            <div className="rounded-[10px] border-small border-divider bg-default-50 p-3">
                <p className="text-tiny font-semibold text-default-500">执行结果</p>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-small bg-background p-3 text-tiny leading-5 text-default-700">
                    {task.result ? JSON.stringify(task.result, null, 2) : "暂无结果"}
                </pre>
            </div>
        </div>
    );
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

function PreflightIssueList({ result }: { result: AutoUploadPublishPreflightResult }) {
    const groups = [
        { key: "engine", label: "发布服务", issues: result.issues.filter((issue) => issue.scope === "engine") },
        { key: "account", label: "账号", issues: result.issues.filter((issue) => issue.scope === "account") },
        { key: "material", label: "素材", issues: result.issues.filter((issue) => issue.scope === "material") },
        { key: "cover", label: "封面", issues: result.issues.filter((issue) => issue.scope === "cover") },
        { key: "payload", label: "参数", issues: result.issues.filter((issue) => issue.scope === "payload") },
    ].filter((group) => group.issues.length);

    return (
        <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Icon className="text-danger-600" icon="solar:shield-warning-linear" />
                <p className="text-small font-semibold text-danger-700">发布前检查未通过</p>
                <Chip color="danger" size="sm" variant="flat">
                    {result.issues.length} 项
                </Chip>
            </div>
            <div className="grid gap-3">
                {groups.map((group) => (
                    <div key={group.key} className="rounded-small border-small border-danger-200 bg-background p-3">
                        <div className="mb-2 flex items-center gap-2">
                            <Chip color="danger" size="sm" variant="flat">
                                {group.label}
                            </Chip>
                            <span className="text-tiny font-semibold text-default-500">{group.issues.length} 项</span>
                        </div>
                        <div className="grid gap-2">
                            {group.issues.map((issue, index) => (
                                <div key={`${issue.code}-${issue.filePath || issue.accountFile || ''}-${index}`} className="text-small text-default-700">
                                    <p className="break-words">{formatPreflightIssue(issue)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function FailureContextBox({ context }: { context: LocalEngineFailureContext }) {
    return (
        <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
            <div className="flex items-center gap-2 font-semibold">
                <Icon icon="solar:close-circle-linear" />
                <span>失败提示</span>
            </div>
            <p className="mt-2">{formatFailureContext(context)}</p>
        </div>
    );
}

function getTaskStatusColor(status: string): "default" | "primary" | "secondary" | "success" | "warning" | "danger" {
    if (status === "failed") return "danger";
    if (status === "running") return "primary";
    if (status === "pending") return "warning";
    if (status === "success") return "warning";
    return "default";
}

function resolveTaskStatus(status: string) {
    const names: Record<string, string> = {
        pending: "等待中",
        running: "执行中",
        success: "引擎完成",
        failed: "失败",
    };

    return names[status] || status;
}

function LogsPanel({
    error,
    loading,
    logs,
    onRefresh,
}: {
    error: string;
    loading: boolean;
    logs: AutoUploadLogFile[];
    onRefresh: () => Promise<void>;
}) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">运行日志</h3>
                        <p className="text-small text-default-500">
                            汇总 本地发布日志和互动任务执行记录。
                        </p>
                    </div>
                    <Button
                        color="primary"
                        isLoading={loading}
                        startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            onRefresh().catch(() => {
                                addToast({ title: "日志刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新日志
                    </Button>
                </div>
                {error ? (
                    <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                        {error}
                    </div>
                ) : null}
                {loading ? (
                    <div className="flex items-center gap-2 text-small text-default-500">
                        <Spinner size="sm" />
                        正在加载日志...
                    </div>
                ) : null}
                <div className="grid gap-4">
                    {logs.map((log) => (
                        <section
                            key={log.key}
                            className="rounded-[10px] border-small border-divider bg-default-50 p-4"
                        >
                            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <div className="flex items-center gap-2">
                                    <Chip size="sm" variant="flat">
                                        {log.platform}
                                    </Chip>
                                    <span className="text-small font-medium text-default-900">{log.filename}</span>
                                </div>
                                <span className="text-tiny text-default-500">
                                    {new Date(log.updatedAt).toLocaleString()} · {(log.size / 1024).toFixed(1)} KB
                                </span>
                            </div>
                            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-small bg-content1 p-3 text-tiny leading-5 text-default-700">
                                {log.lines.length ? log.lines.join("\n") : "暂无日志"}
                            </pre>
                        </section>
                    ))}
                    {!loading && !logs.length ? (
                        <div className="rounded-[10px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                            暂无运行日志。
                        </div>
                    ) : null}
                </div>
            </CardBody>
        </Card>
    );
}

function EnginePanel({
    error,
    health,
    loading,
    onRefresh,
}: {
    error: string;
    health: AutoUploadEngineHealth | null;
    loading: boolean;
    onRefresh: () => Promise<void>;
}) {
    return (
        <Card className="border-small border-divider bg-background shadow-sm">
            <CardBody className="gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-medium font-semibold text-default-900">本地引擎</h3>
                        <p className="text-small text-default-500">
                            查看 本地发布服务、数据库和运行目录状态。
                        </p>
                    </div>
                    <Button
                        color="primary"
                        isLoading={loading}
                        startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                        variant="flat"
                        onPress={() => {
                            onRefresh().catch(() => {
                                addToast({ title: "引擎状态刷新失败", color: "danger" });
                            });
                        }}
                    >
                        刷新状态
                    </Button>
                </div>
                {health ? (
                    <div className="grid gap-4 rounded-[10px] border-small border-divider bg-default-50 p-4 md:grid-cols-3">
                        <StatusItem label="服务" value={health.service} />
                        <StatusItem label="地址" value={health.engineUrl} />
                        <StatusItem label="状态" value={health.online ? "在线" : "离线"} />
                        <StatusItem label="检查时间" value={new Date(health.checkedAt).toLocaleString()} />
                        <StatusItem label="运行目录" value={health.baseDir || "-"} wide />
                        <StatusItem label="数据库" value={health.database?.exists ? health.database.path : "未找到"} wide />
                    </div>
                ) : (
                    <div className="rounded-[10px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
                        {error || "本地发布引擎未启动。请先启动 发布服务 服务后刷新。"}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}

function MaterialPreview({ material }: { material: AutoUploadMaterial }) {
    if (!material.filePath) {
        return <p className="text-small text-default-500">没有可预览的文件路径。</p>;
    }

    const previewUrl = autoUploadApi.materialPreviewUrl(material.filePath);
    const filename = material.filename.toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].some((ext) => filename.endsWith(ext));
    const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].some((ext) => filename.endsWith(ext));

    if (isVideo) {
        return (
            <video className="max-h-[420px] w-full rounded-[10px] bg-black" controls>
                <source src={previewUrl} />
            </video>
        );
    }

    if (isImage) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                alt={material.filename}
                className="max-h-[420px] max-w-full rounded-[10px] object-contain"
                src={previewUrl}
            />
        );
    }

    return (
        <div className="flex flex-col gap-2 text-small text-default-500">
            <p>该文件类型暂不支持内嵌预览。</p>
            <a className="text-primary hover:underline" href={previewUrl} rel="noreferrer" target="_blank">
                在新窗口打开
            </a>
        </div>
    );
}

function StatusItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={wide ? "md:col-span-3" : ""}>
            <p className="text-tiny text-default-400">{label}</p>
            <p className="mt-1 break-all text-small font-medium text-default-800">{value}</p>
        </div>
    );
}
