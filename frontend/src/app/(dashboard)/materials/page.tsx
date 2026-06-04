"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    Table,
    TableHeader,
    TableColumn,
    TableBody,
    TableRow,
    TableCell,
    Input,
    Button,
    Chip,
    Pagination,
    Tooltip,
    Selection,
    SortDescriptor,
    Select,
    SelectItem,
    Spinner,
    addToast,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    useDisclosure,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { columns, statusMap } from "./data";
import { materialsApi, Material, type MaterialCollectStatus } from "@/lib/api/materials";
import ReactMarkdown from "react-markdown";

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "未知错误";
}

const platformDisplayNameMap: Record<string, string> = {
    "36Kr": "36氪",
    "HubToday": "HubToday",
    "Juejin": "掘金",
    "Zhihu": "知乎",
    "WeChat": "微信公众号",
    "V2EX": "V2EX",
    "X/Twitter": "X (Twitter)",
    "Tophub": "今日热榜",
};

const runningCollectStates = new Set(["waiting", "active", "delayed", "paused", "waiting-children"]);

const collectStateLabelMap: Record<string, string> = {
    waiting: "排队中",
    active: "采集中",
    delayed: "等待重试",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    "waiting-children": "等待子任务",
};

function formatCollectTime(value?: string | null) {
    if (!value) return "刚刚";
    return new Date(value).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export default function MaterialsPage() {
    const [filterValue, setFilterValue] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [platformFilter, setPlatformFilter] = useState("all");
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set([]));
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
        column: "collectDate",
        direction: "descending",
    });
    const [isCollecting, setIsCollecting] = useState(false);
    const [collectStatus, setCollectStatus] = useState<MaterialCollectStatus | null>(null);
    const [collectJobIds, setCollectJobIds] = useState<string[]>([]);
    const [collectStartedAt, setCollectStartedAt] = useState<string | null>(null);
    const [lastCollectRefreshAt, setLastCollectRefreshAt] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    // 服务端数据状态
    const [items, setItems] = useState<Material[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [platforms, setPlatforms] = useState<{ platform: string; count: number }[]>([]);
    const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
    const { isOpen, onOpen, onClose } = useDisclosure();

    // 用于搜索防抖的计时器
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 从服务端获取数据
    const fetchData = useCallback(async (options?: { silent?: boolean }) => {
        if (!options?.silent) setIsLoading(true);
        try {
            // 构建排序字段映射
            const sortBy = sortDescriptor.column as string;
            const sortOrder = sortDescriptor.direction === "descending" ? "desc" : "asc";

            const [result, stats] = await Promise.all([
                materialsApi.list({
                    page,
                    limit: rowsPerPage,
                    keyword: filterValue || undefined,
                    status: statusFilter !== "all" ? statusFilter : undefined,
                    platform: platformFilter !== "all" ? platformFilter : undefined,
                    sortBy,
                    sortOrder,
                }),
                materialsApi.stats()
            ]);

            setItems(result.items);
            setTotal(result.total);
            setTotalPages(result.totalPages);
            setPlatforms(stats.byPlatform);
        } catch (error: unknown) {
            addToast({ title: "加载素材失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            if (!options?.silent) setIsLoading(false);
        }
    }, [page, rowsPerPage, filterValue, statusFilter, platformFilter, sortDescriptor]);

    // 筛选条件变化时重新请求
    useEffect(() => {
        setIsMounted(true);
        fetchData();
    }, [fetchData]);

    // 搜索输入防抖处理
    const onSearchChange = useCallback((value?: string) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            setFilterValue(value || "");
            setPage(1);
        }, 300);
    }, []);

    // 筛选条件变化时重置页码
    const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setStatusFilter(e.target.value);
        setPage(1);
    }, []);

    const handlePlatformChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setPlatformFilter(e.target.value);
        setPage(1);
    }, []);

    const fetchCollectStatus = useCallback(async (
        jobIds = collectJobIds,
        options?: { silent?: boolean },
    ) => {
        try {
            const status = await materialsApi.collectStatus(jobIds);
            setCollectStatus(status);
            setLastCollectRefreshAt(status.checkedAt);
            if (!status.active) {
                setIsCollecting(false);
            }
            return status;
        } catch (error: unknown) {
            if (!options?.silent) {
                addToast({ title: "读取采集状态失败", description: getErrorMessage(error), color: "warning" });
            }
            return null;
        }
    }, [collectJobIds]);

    useEffect(() => {
        let active = true;
        const refreshStatus = async () => {
            const status = await fetchCollectStatus(collectJobIds, { silent: true });
            if (!active || !status?.active) return;
            await fetchData({ silent: true });
        };

        refreshStatus();
        const intervalMs = isCollecting || collectStatus?.active ? 3000 : 8000;
        const timer = setInterval(refreshStatus, intervalMs);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [collectJobIds, collectStatus?.active, fetchCollectStatus, fetchData, isCollecting]);

    // 触发自动采集任务
    const handleCollect = useCallback(async () => {
        setIsCollecting(true);
        setCollectStartedAt(new Date().toISOString());
        setCollectStatus(null);
        try {
            const result = await materialsApi.collect();
            setCollectJobIds(result.jobIds || []);
            addToast({
                title: "采集任务已启动",
                description: `${result.message}，共 ${result.jobCount} 个来源。页面会自动刷新进度。`,
                color: "success",
            });
            const status = await fetchCollectStatus(result.jobIds || [], { silent: false });
            if (result.jobCount === 0 || status?.active === false) {
                setIsCollecting(false);
            }
            await fetchData({ silent: true });
        } catch (error: unknown) {
            addToast({ title: "采集失败", description: getErrorMessage(error), color: "danger" });
            setIsCollecting(false);
        }
    }, [fetchCollectStatus, fetchData]);

    // 批量删除
    const handleBulkDelete = useCallback(async () => {
        const ids = selectedKeys === "all"
            ? items.map(item => item.id)
            : Array.from(selectedKeys) as string[];

        if (ids.length === 0) return;

        try {
            const result = await materialsApi.batchRemove(ids);
            addToast({ title: "批量删除成功", description: `已删除 ${result.deleted} 条素材`, color: "success" });
            setSelectedKeys(new Set([]));
            await fetchData();
        } catch (error: unknown) {
            addToast({ title: "批量删除失败", description: getErrorMessage(error), color: "danger" });
        }
    }, [selectedKeys, items, fetchData]);

    // 单条删除
    const handleDelete = useCallback(async (id: string) => {
        try {
            await materialsApi.remove(id);
            addToast({ title: "删除成功", color: "success" });
            await fetchData();
        } catch (error: unknown) {
            addToast({ title: "删除失败", description: getErrorMessage(error), color: "danger" });
        }
    }, [fetchData]);

    // 查看详情
    const handleView = useCallback((item: Material) => {
        setSelectedMaterial(item);
        onOpen();
    }, [onOpen]);

    const renderCell = useCallback((item: Material, columnKey: React.Key) => {
        const cellValue = item[columnKey as keyof Material];

        switch (columnKey) {
            case "title":
                return (
                    <div className="flex flex-col gap-1 max-w-[300px]">
                        <span className="text-small text-default-900 truncate font-medium">{item.title}</span>
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-tiny text-primary truncate hover:underline">
                            {item.sourceUrl}
                        </a>
                    </div>
                );
            case "platform":
                return (
                    <Chip size="sm" variant="flat" className="capitalize bg-default-100 text-default-800">
                        {platformDisplayNameMap[item.platform] || item.platform}
                    </Chip>
                );
            case "status":
                const statusConfig = statusMap[item.status];
                return (
                    <Chip size="sm" variant="flat" color={statusConfig.color}>
                        {statusConfig.label}
                    </Chip>
                );
            case "keywords":
                return (
                    <div className="flex gap-1 flex-wrap">
                        {item.keywords.map((kw, idx) => {
                            const colors: ("primary" | "secondary" | "success" | "warning" | "danger" | "default")[] = [
                                "primary", "secondary", "success", "warning", "default"
                            ];
                            const color = colors[idx % colors.length];
                            return (
                                <Chip key={idx} size="sm" variant="flat" color={color} className="text-tiny h-5">
                                    {kw}
                                </Chip>
                            );
                        })}
                    </div>
                );
            case "collectDate":
                return (
                    <span className="text-small text-default-500">
                        {new Date(cellValue as string).toLocaleString("zh-CN", {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                        })}
                    </span>
                );
            case "actions":
                return (
                    <div className="flex items-center gap-2">
                        <Tooltip content="查看详情">
                            <Button isIconOnly size="sm" variant="light" onClick={() => handleView(item)}>
                                <Icon icon="solar:eye-linear" width={18} />
                            </Button>
                        </Tooltip>
                        <Tooltip content="删除素材" color="danger">
                            <Button isIconOnly size="sm" variant="light" color="danger" onClick={() => handleDelete(item.id)}>
                                <Icon icon="solar:trash-bin-trash-linear" width={18} />
                            </Button>
                        </Tooltip>
                    </div>
                );
            default:
                return null;
        }
    }, [handleDelete, handleView]);

    const trackedCollectJobs = collectStatus?.trackedJobs || [];
    const collectVisibleJobs = trackedCollectJobs.length > 0
        ? trackedCollectJobs
        : [
            ...(collectStatus?.activeJobs || []),
            ...(collectStatus?.waitingJobs || []),
            ...(collectStatus?.recentJobs || []),
        ].slice(0, 4);
    const trackedRunningCount = trackedCollectJobs.filter((job) => runningCollectStates.has(job.state)).length;
    const trackedCompletedCount = trackedCollectJobs.filter((job) => job.state === "completed").length;
    const trackedFailedCount = trackedCollectJobs.filter((job) => job.state === "failed").length;
    const collectIsRunning = isCollecting || Boolean(collectStatus?.active) || trackedRunningCount > 0;
    const collectSourceSummary = collectVisibleJobs
        .slice(0, 3)
        .map((job) => job.sourceName)
        .filter(Boolean)
        .join("、");
    const collectStatusTitle = collectIsRunning
        ? "正在采集素材"
        : collectStartedAt
            ? "最近一次采集已结束"
            : collectStatus?.active
                ? "检测到采集队列"
                : "";
    const collectStatusDetail = collectIsRunning
        ? `${collectSourceSummary || "采集队列"}正在处理，列表每 3 秒自动刷新。`
        : collectStartedAt
            ? "队列已清空，素材列表已自动刷新。"
            : "当前没有采集任务。";
    const shouldShowCollectStatus = Boolean(collectStartedAt || collectStatus?.active);

    const topContent = (
        <div className="flex flex-col gap-4 mb-2">
            <div className="flex justify-between gap-3 items-end">
                <div className="flex items-center gap-3 w-full flex-wrap">
                    <Input
                        isClearable
                        classNames={{
                            base: "w-full sm:max-w-[240px]",
                            mainWrapper: "h-full",
                            input: "text-small",
                            inputWrapper: "h-full font-normal text-default-500 bg-default-400/20 dark:bg-default-500/20 backdrop-blur-md",
                        }}
                        size="sm"
                        placeholder="搜索素材标题..."
                        startContent={<Icon icon="solar:magnifer-linear" className="text-default-300" />}
                        defaultValue={filterValue}
                        onClear={() => {
                            setFilterValue("");
                            setPage(1);
                        }}
                        onValueChange={onSearchChange}
                    />
                    <Select
                        className="w-[120px]"
                        size="sm"
                        selectedKeys={[statusFilter]}
                        onChange={handleStatusChange}
                        aria-label="挖掘状态"
                    >
                        <SelectItem key="all">全部状态</SelectItem>
                        <SelectItem key="unmined">待挖掘</SelectItem>
                        <SelectItem key="mined">已挖掘</SelectItem>
                        <SelectItem key="failed">采集失败</SelectItem>
                    </Select>
                    <Select
                        className="w-[160px]"
                        size="sm"
                        selectedKeys={[platformFilter]}
                        onChange={handlePlatformChange}
                        aria-label="来源平台"
                    >
                        {[
                            <SelectItem key="all">全部平台</SelectItem>,
                            ...platforms.map((p) => (
                                <SelectItem key={p.platform}>
                                    {platformDisplayNameMap[p.platform] || p.platform}
                                </SelectItem>
                            ))
                        ]}
                    </Select>
                    {(selectedKeys === "all" || (selectedKeys as Set<string>).size > 0) && (
                        <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            startContent={<Icon icon="solar:trash-bin-trash-bold" width={16} />}
                            onClick={handleBulkDelete}
                        >
                            批量删除 ({selectedKeys === "all" ? items.length : (selectedKeys as Set<string>).size})
                        </Button>
                    )}
                </div>

                <div className="flex gap-3 shrink-0">
                    <Button
                        color="primary"
                        size="sm"
                        startContent={!collectIsRunning ? <Icon icon="solar:cloud-download-linear" width={18} /> : undefined}
                        isLoading={collectIsRunning}
                        isDisabled={collectIsRunning}
                        onClick={handleCollect}
                    >
                        {collectIsRunning ? "正在采集..." : "自动采集任务"}
                    </Button>
                </div>
            </div>
            {shouldShowCollectStatus ? (
                <div className="rounded-[10px] border border-primary/20 bg-primary/10 px-4 py-3 text-small">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/20 text-primary">
                                {collectIsRunning ? (
                                    <Spinner size="sm" color="primary" />
                                ) : (
                                    <Icon icon="solar:check-circle-linear" width={18} />
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="font-semibold text-foreground">{collectStatusTitle}</div>
                                <div className="mt-1 text-default-500">{collectStatusDetail}</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <Chip size="sm" variant="flat" color={collectIsRunning ? "primary" : "success"}>
                                        队列中 {collectStatus?.pendingCount ?? (collectIsRunning ? collectJobIds.length : 0)}
                                    </Chip>
                                    <Chip size="sm" variant="flat" color="success">
                                        本次完成 {trackedCompletedCount}
                                    </Chip>
                                    <Chip size="sm" variant="flat" color={trackedFailedCount > 0 ? "danger" : "default"}>
                                        本次失败 {trackedFailedCount}
                                    </Chip>
                                    {collectStatus ? (
                                        <Chip size="sm" variant="flat">
                                            累计完成 {collectStatus.counts.completed}
                                        </Chip>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-2 text-tiny text-default-500 lg:items-end">
                            <span>启动：{formatCollectTime(collectStartedAt)}</span>
                            <span>刷新：{formatCollectTime(lastCollectRefreshAt)}</span>
                            <Button
                                size="sm"
                                variant="flat"
                                onClick={() => {
                                    void fetchCollectStatus(collectJobIds, { silent: false });
                                    void fetchData({ silent: true });
                                }}
                            >
                                立即刷新
                            </Button>
                        </div>
                    </div>
                    {collectVisibleJobs.length > 0 ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            {collectVisibleJobs.slice(0, 4).map((job) => (
                                <div key={job.id} className="rounded-[8px] border border-white/10 bg-background/50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-tiny font-semibold text-foreground">{job.sourceName}</span>
                                        <Chip
                                            size="sm"
                                            variant="flat"
                                            color={
                                                job.state === "failed"
                                                    ? "danger"
                                                    : job.state === "completed"
                                                        ? "success"
                                                        : "primary"
                                            }
                                        >
                                            {collectStateLabelMap[job.state] || job.state}
                                        </Chip>
                                    </div>
                                    <div className="mt-1 truncate text-tiny text-default-500">
                                        {job.result
                                            ? `拉取 ${job.result.total ?? 0}，入库 ${job.result.saved ?? 0}`
                                            : job.platform || "等待队列调度"}
                                    </div>
                                    {job.failedReason ? (
                                        <div className="mt-1 truncate text-tiny text-danger">{job.failedReason}</div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="flex justify-between items-center">
                <span className="text-default-400 text-small">总共 {total} 个储备素材</span>
                <label className="flex items-center text-default-400 text-small">
                    每页显示:
                    <select
                        className="bg-transparent outline-none text-default-400 text-small ml-1"
                        value={rowsPerPage.toString()}
                        onChange={(e) => {
                            setRowsPerPage(Number(e.target.value));
                            setPage(1);
                        }}
                    >
                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                    </select>
                </label>
            </div>
        </div>
    );

    const bottomContent = (
        <div className="py-4 px-2 flex justify-center items-center w-full">
            <Pagination
                isCompact
                showControls
                showShadow
                color="primary"
                page={page}
                total={totalPages || 1}
                onChange={setPage}
            />
        </div>
    );

    return (
        <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto pb-10">
            <header className="rounded-[10px] border-small border-white/10 flex items-center justify-between gap-3 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">源素材库</h2>
                    <span className="text-small text-default-500 mt-1">管理从全网各个平台自动爬取的未经加工的图文内容，作为下一步智能选题的&quot;矿池&quot;。</span>
                </div>
            </header>

            {isMounted ? (
                <Table
                    aria-label="素材管理列表"
                    isHeaderSticky
                    bottomContent={bottomContent}
                    bottomContentPlacement="outside"
                    classNames={{
                        wrapper: "max-h-[calc(100vh-250px)] bg-content1 shadow-sm border-small border-white/10",
                    }}
                    selectedKeys={selectedKeys}
                    selectionMode="multiple"
                    sortDescriptor={sortDescriptor}
                    topContent={topContent}
                    topContentPlacement="outside"
                    onSelectionChange={(keys) => {
                        if (keys === "all") {
                            setSelectedKeys(new Set(items.map(item => item.id)));
                        } else {
                            setSelectedKeys(keys);
                        }
                    }}
                    onSortChange={(descriptor) => {
                        setSortDescriptor(descriptor);
                        setPage(1);
                    }}
                >
                    <TableHeader columns={columns}>
                        {(column) => (
                            <TableColumn
                                key={column.uid}
                                align={column.uid === "actions" ? "center" : "start"}
                                allowsSorting={column.uid !== "actions" && column.uid !== "keywords"}
                            >
                                {column.name}
                            </TableColumn>
                        )}
                    </TableHeader>
                    <TableBody
                        emptyContent={isLoading ? " " : "未找到符合条件的素材"}
                        items={items}
                        isLoading={isLoading}
                        loadingContent={<Spinner label="加载中..." />}
                    >
                        {(item) => (
                            <TableRow key={item.id}>
                                {(columnKey) => <TableCell>{renderCell(item, columnKey)}</TableCell>}
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            ) : (
                <div className="flex justify-center items-center py-20 min-h-[400px]">
                    <Spinner size="lg" label="加载中..." />
                </div>
            )}

            <Modal
                isOpen={isOpen}
                onClose={onClose}
                size="3xl"
                scrollBehavior="inside"
                backdrop="blur"
                classNames={{
                    base: "bg-background/80 backdrop-blur-md border-small border-white/10",
                    header: "border-b-small border-white/10",
                    footer: "border-t-small border-white/10",
                }}
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader className="flex flex-col gap-1">
                                <h3 className="text-[17px] font-bold leading-6">{selectedMaterial?.title}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <Chip size="sm" variant="flat">{selectedMaterial?.platform}</Chip>
                                    <span className="text-tiny text-default-400">{selectedMaterial?.author}</span>
                                    <span className="text-tiny text-default-400">
                                        {selectedMaterial?.collectDate && new Date(selectedMaterial.collectDate).toLocaleString()}
                                    </span>
                                </div>
                            </ModalHeader>
                            <ModalBody className="py-6">
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <ReactMarkdown>
                                        {selectedMaterial?.content || "暂无正文内容"}
                                    </ReactMarkdown>
                                </div>
                                {selectedMaterial?.sourceUrl && (
                                    <div className="mt-6 pt-4 border-t-small border-white/5">
                                        <p className="text-tiny text-default-500 mb-1">原文链接：</p>
                                        <a
                                            href={selectedMaterial.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-small text-primary hover:underline break-all"
                                        >
                                            {selectedMaterial.sourceUrl}
                                        </a>
                                    </div>
                                )}
                            </ModalBody>
                            <ModalFooter>
                                <Button color="default" variant="flat" onClick={onClose}>
                                    关闭
                                </Button>
                                <Button
                                    color="primary"
                                    onClick={() => window.open(selectedMaterial?.sourceUrl, '_blank')}
                                >
                                    浏览原文
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}
