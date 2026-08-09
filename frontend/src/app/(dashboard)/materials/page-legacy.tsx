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
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import { columns, statusMap } from "./data";
import {
  materialsApi,
  Material,
  buildMaterialRiskConfirmation,
  type MaterialCollectStatus,
} from "@/lib/api/materials";
import ReactMarkdown from "react-markdown";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { FailureActionPanel } from "../components/failure-action-panel";
import { FunctionalEmptyState } from "../components/functional-empty-state";
import { ResultSummaryPanel } from "../components/result-summary-panel";

function getErrorMessage(error: unknown, fallback: string) {
  return toPublicError(error, fallback);
}

const platformDisplayNameMap: Record<string, string> = {
  "36Kr": "36氪",
  HubToday: "HubToday",
  Juejin: "掘金",
  Zhihu: "知乎",
  WeChat: "微信公众号",
  V2EX: "V2EX",
  RedFox: "外部数据",
  redfox: "外部数据",
  "X/Twitter": "X (Twitter)",
  Tophub: "今日热榜",
};

function materialDisplayText(value: unknown, fallback = "-") {
  return commercialDisplayText(value, fallback) || fallback;
}

function materialSourceLabel(value: string | null | undefined) {
  if (!value) return "-";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) {
    return "外部数据来源";
  }
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || "来源已记录";
  } catch {
    return materialDisplayText(value, "来源已记录");
  }
}

function materialPlatformLabel(value: string | null | undefined) {
  if (!value) return "-";
  return platformDisplayNameMap[value] || materialDisplayText(value);
}

const runningCollectStates = new Set([
  "waiting",
  "active",
  "delayed",
  "paused",
  "waiting-children",
]);

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

type DeleteIntent = {
  kind: "single" | "bulk";
  ids: string[];
  title: string;
  description: string;
};

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
  const [collectStatus, setCollectStatus] =
    useState<MaterialCollectStatus | null>(null);
  const [collectJobIds, setCollectJobIds] = useState<string[]>([]);
  const [collectStartedAt, setCollectStartedAt] = useState<string | null>(null);
  const [lastCollectRefreshAt, setLastCollectRefreshAt] = useState<
    string | null
  >(null);
  const [isMounted, setIsMounted] = useState(false);

  // 服务端数据状态
  const [items, setItems] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [platforms, setPlatforms] = useState<
    { platform: string; count: number }[]
  >([]);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(
    null,
  );
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // 用于搜索防抖的计时器
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 从服务端获取数据
  const fetchData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setIsLoading(true);
      try {
        // 构建排序字段映射
        const sortBy = sortDescriptor.column as string;
        const sortOrder =
          sortDescriptor.direction === "descending" ? "desc" : "asc";

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
          materialsApi.stats(),
      ]);

        setLoadError("");
        setItems(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setPlatforms(stats.byPlatform);
      } catch (error: unknown) {
        const message = getErrorMessage(
          error,
          "素材暂时无法加载，请重新加载。",
        );
        setLoadError(message);
        addToast({
          title: "加载素材失败",
          description: message,
          color: "danger",
        });
      } finally {
        if (!options?.silent) setIsLoading(false);
      }
    },
    [
      page,
      rowsPerPage,
      filterValue,
      statusFilter,
      platformFilter,
      sortDescriptor,
    ],
  );

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
  const handleStatusChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setStatusFilter(e.target.value);
      setPage(1);
    },
    [],
  );

  const handlePlatformChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPlatformFilter(e.target.value);
      setPage(1);
    },
    [],
  );

  const fetchCollectStatus = useCallback(
    async (jobIds = collectJobIds, options?: { silent?: boolean }) => {
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
          addToast({
            title: "读取采集状态失败",
            description: getErrorMessage(
              error,
              "采集状态暂时无法更新，请稍后重试。",
            ),
            color: "warning",
          });
        }
        return null;
      }
    },
    [collectJobIds],
  );

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
  }, [
    collectJobIds,
    collectStatus?.active,
    fetchCollectStatus,
    fetchData,
    isCollecting,
  ]);

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
      const status = await fetchCollectStatus(result.jobIds || [], {
        silent: false,
      });
      if (result.jobCount === 0 || status?.active === false) {
        setIsCollecting(false);
      }
      await fetchData({ silent: true });
    } catch (error: unknown) {
      addToast({
        title: "采集失败",
        description: getErrorMessage(error, "素材采集未开始，请稍后重试。"),
        color: "danger",
      });
      setIsCollecting(false);
    }
  }, [fetchCollectStatus, fetchData]);

  // 批量删除
  const handleBulkDelete = useCallback(async () => {
    const ids =
      selectedKeys === "all"
        ? items.map((item) => item.id)
        : (Array.from(selectedKeys) as string[]);

    if (ids.length === 0) return;

    setDeleteIntent({
      kind: "bulk",
      ids,
      title: `删除 ${ids.length} 条素材？`,
      description:
        "删除后会从素材库移除这些记录。后续若需要恢复，只能重新采集或重新导入。",
    });
  }, [selectedKeys, items]);

  const confirmDelete = useCallback(async () => {
    if (!deleteIntent?.ids.length) return;
    setIsDeleting(true);
    try {
      const riskAction =
        deleteIntent.kind === "single"
          ? "material-delete"
          : "material-batch-delete";
      const riskLevel = deleteIntent.kind === "single" ? "medium" : "high";
      const riskConfirmation = {
        ...buildMaterialRiskConfirmation(riskAction, riskLevel),
        reason: deleteIntent.title,
        checklist: {
          noLongerUsed: true,
          recoveryRequiresReimport: true,
        },
      };
      const result =
        deleteIntent.kind === "single"
          ? {
              deleted: await materialsApi
                .remove(deleteIntent.ids[0], riskConfirmation)
                .then(() => 1),
            }
          : await materialsApi.batchRemove(deleteIntent.ids, riskConfirmation);
      addToast({
        title: deleteIntent.kind === "single" ? "删除成功" : "批量删除成功",
        description: `已删除 ${result.deleted} 条素材`,
        color: "success",
      });
      setSelectedKeys(new Set([]));
      setDeleteIntent(null);
      await fetchData();
    } catch (error: unknown) {
      addToast({
        title: deleteIntent.kind === "single" ? "删除失败" : "批量删除失败",
        description: getErrorMessage(error, "素材未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteIntent, fetchData]);

  // 单条删除
  const handleDelete = useCallback(
    async (id: string) => {
      const item = items.find((material) => material.id === id);
      setDeleteIntent({
        kind: "single",
        ids: [id],
        title: "删除这条素材？",
        description: item?.title
          ? `将删除「${materialDisplayText(item.title)}」。删除后需要重新采集或重新导入才能恢复。`
          : "删除后需要重新采集或重新导入才能恢复。",
      });
    },
    [items],
  );

  // 查看详情
  const handleView = useCallback(
    (item: Material) => {
      setSelectedMaterial(item);
      onOpen();
    },
    [onOpen],
  );

  const renderCell = useCallback(
    (item: Material, columnKey: React.Key) => {
      const cellValue = item[columnKey as keyof Material];

      switch (columnKey) {
        case "title":
          return (
            <div className="flex flex-col gap-1 max-w-[300px]">
              <span className="text-small text-default-900 truncate font-medium">
                {materialDisplayText(item.title)}
              </span>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-tiny text-primary truncate hover:underline"
              >
                {materialSourceLabel(item.sourceUrl)}
              </a>
            </div>
          );
        case "platform":
          return (
            <Chip
              size="sm"
              variant="flat"
              className="capitalize bg-default-100 text-default-800"
            >
              {materialPlatformLabel(item.platform)}
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
                const colors: (
                  | "primary"
                  | "secondary"
                  | "success"
                  | "warning"
                  | "danger"
                  | "default"
                )[] = ["primary", "secondary", "success", "warning", "default"];
                const color = colors[idx % colors.length];
                return (
                  <Chip
                    key={idx}
                    size="sm"
                    variant="flat"
                    color={color}
                    className="text-tiny h-5"
                  >
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
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          );
        case "actions":
          return (
            <div className="flex items-center gap-2">
              <Tooltip content="查看详情">
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  onClick={() => handleView(item)}
                >
                  <Icon icon="solar:eye-linear" width={18} />
                </Button>
              </Tooltip>
              <Tooltip content="删除素材" color="danger">
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  color="danger"
                  onClick={() => handleDelete(item.id)}
                >
                  <Icon icon="solar:trash-bin-trash-linear" width={18} />
                </Button>
              </Tooltip>
            </div>
          );
        default:
          return null;
      }
    },
    [handleDelete, handleView],
  );

  const trackedCollectJobs = collectStatus?.trackedJobs || [];
  const collectVisibleJobs =
    trackedCollectJobs.length > 0
      ? trackedCollectJobs
      : [
          ...(collectStatus?.activeJobs || []),
          ...(collectStatus?.waitingJobs || []),
          ...(collectStatus?.recentJobs || []),
        ].slice(0, 4);
  const trackedRunningCount = trackedCollectJobs.filter((job) =>
    runningCollectStates.has(job.state),
  ).length;
  const trackedCompletedCount = trackedCollectJobs.filter(
    (job) => job.state === "completed",
  ).length;
  const trackedFailedCount = trackedCollectJobs.filter(
    (job) => job.state === "failed",
  ).length;
  const collectIsRunning =
    isCollecting || Boolean(collectStatus?.active) || trackedRunningCount > 0;
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
        ? "检测到采集任务"
        : "";
  const collectStatusDetail = collectIsRunning
    ? `${collectSourceSummary || "采集任务"}正在处理，列表每 3 秒自动刷新。`
    : collectStartedAt
      ? "采集任务已结束，素材列表已自动刷新。"
      : "当前没有采集任务。";
  const shouldShowCollectStatus = Boolean(
    collectStartedAt || collectStatus?.active,
  );  const topContent = (
    <div className="flex flex-col gap-4 mb-2">
      <div className="flex justify-between gap-3 items-end">
        <div className="flex items-center gap-3 w-full flex-wrap">
          <Input
            isClearable
            classNames={{
              base: "w-full sm:max-w-[240px]",
              mainWrapper: "h-full",
              input: "text-small",
              inputWrapper:
                "h-full font-normal text-default-500 bg-default-400/20 dark:bg-default-500/20 ",
            }}
            size="sm"
            placeholder="搜索素材标题..."
            startContent={
              <Icon icon="solar:magnifer-linear" className="text-default-300" />
            }
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
                  {materialPlatformLabel(p.platform)}
                </SelectItem>
              )),
            ]}
          </Select>
          {(selectedKeys === "all" ||
            (selectedKeys as Set<string>).size > 0) && (
            <Button
              size="sm"
              color="danger"
              variant="flat"
              startContent={
                <Icon icon="solar:trash-bin-trash-bold" width={16} />
              }
              onClick={handleBulkDelete}
            >
              批量删除 (
              {selectedKeys === "all"
                ? items.length
                : (selectedKeys as Set<string>).size}
              )
            </Button>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          <Button
            color="primary"
            size="sm"
            startContent={
              !collectIsRunning ? (
                <Icon icon="solar:cloud-download-linear" width={18} />
              ) : undefined
            }
            isLoading={collectIsRunning}
            isDisabled={collectIsRunning}
            onClick={handleCollect}
          >
            {collectIsRunning ? "正在采集..." : "自动采集任务"}
          </Button>
        </div>
      </div>
      {shouldShowCollectStatus ? (
        <div className="rounded-[8px] border border-primary/20 bg-primary/10 px-4 py-3 text-small">
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
                <div className="font-semibold text-foreground">
                  {collectStatusTitle}
                </div>
                <div className="mt-1 text-default-500">
                  {collectStatusDetail}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip
                    size="sm"
                    variant="flat"
                    color={collectIsRunning ? "primary" : "success"}
                  >
                    处理中
                    {collectStatus?.pendingCount ??
                      (collectIsRunning ? collectJobIds.length : 0)}
                  </Chip>
                  <Chip size="sm" variant="flat" color="success">
                    本次完成 {trackedCompletedCount}
                  </Chip>
                  <Chip
                    size="sm"
                    variant="flat"
                    color={trackedFailedCount > 0 ? "danger" : "default"}
                  >
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
                <div
                  key={job.id}
                  className="rounded-[8px] border border-divider bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-tiny font-semibold text-foreground">
                      {job.sourceName}
                    </span>
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
                      : job.platform || "等待采集"}
                  </div>
                  {job.failedReason ? (
                    <div className="mt-1 truncate text-tiny text-danger">
                      {job.failedReason}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-between items-center">
        <span className="text-default-400 text-small">
          总共 {total} 个储备素材
        </span>
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
  const resetFilters = () => {
    setFilterValue("");
    setStatusFilter("all");
    setPlatformFilter("all");
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-[1400px] mx-auto pb-10">
      <header className="rounded-[8px] border-small border-divider flex items-center justify-between gap-3 p-5 bg-background shadow-sm">
        <div className="flex flex-col">
          <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
            素材与品牌 · 素材库
          </h2>
          <span className="text-small text-default-500 mt-1">
            管理自动采集和手动导入的素材内容，下一步可以进入选题、创作优化、发布中心或知识库沉淀。
          </span>
        </div>
      </header>
      {loadError ? (
        <FailureActionPanel
          actions={[
            {
              label: "重新加载",
              onPress: () => {
                fetchData().catch(() => undefined);
              },
            },
            {
              label: "重新采集",
              onPress: () => {
                void handleCollect();
              },
            },
          ]}
          impact="素材列表、筛选和详情暂时不可用，发布和内容创作可能拿不到最新素材。"
          nextAction="先重新加载；仍失败时重新采集素材或检查情报数据来源。"
          reason="素材读取失败，可能是素材服务、采集来源或网络连接暂时不可用。"
          technicalDetails={materialDisplayText(loadError, "素材读取失败")}
          title="素材库需要处理"
        />
      ) : null}
      <ResultSummaryPanel
        actions={[
          { label: "自动采集", onPress: () => void handleCollect() },
          { href: "/intelligence", label: "情报中心" },
          { href: "/distribution?tab=materials", label: "发布素材" },
        ]}
        failed={trackedFailedCount}
        skipped={0}
        succeeded={total}
        subtitle="素材库用于承接情报采集、内容创作和发布素材。失败项优先重新采集或回到情报中心检查来源。"
        title="素材库状态"
        total={total + trackedFailedCount}
      />
      {isMounted ? (
        <Table
          aria-label="素材管理列表"
          isHeaderSticky
          bottomContent={bottomContent}
          bottomContentPlacement="outside"
          classNames={{
            wrapper:
              "max-h-[calc(100vh-250px)] bg-content1 shadow-sm border-small border-divider",
          }}
          selectedKeys={selectedKeys}
          selectionMode="multiple"
          sortDescriptor={sortDescriptor}
          topContent={topContent}
          topContentPlacement="outside"
          onSelectionChange={(keys) => {
            if (keys === "all") {
              setSelectedKeys(new Set(items.map((item) => item.id)));
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
                allowsSorting={
                  column.uid !== "actions" && column.uid !== "keywords"
                }
              >
                {column.name}
              </TableColumn>
            )}
          </TableHeader>
          <TableBody
            emptyContent={
              isLoading ? (
                " "
              ) : (
                <FunctionalEmptyState
                  actions={[
                    { label: "清空筛选", onPress: resetFilters },
                    { href: "/intelligence", label: "去找素材" },
                    { label: "自动采集", onPress: () => void handleCollect() },
                  ]}
                  description="当前筛选下没有可用素材。可以先清空筛选；如果素材库本身为空，就从情报中心寻找素材或启动自动采集。"
                  examples={["清空筛选", "情报找素材", "自动采集", "进入发布中心"]}
                  surface="plain"
                  title="当前没有可用素材"
                />
              )
            }
            items={items}
            isLoading={isLoading}
            loadingContent={<Spinner label="加载中..." />}
          >
            {(item) => (
              <TableRow key={item.id}>
                {(columnKey) => (
                  <TableCell>{renderCell(item, columnKey)}</TableCell>
                )}
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
          base: "bg-background  border-small border-divider",
          header: "border-b-small border-divider",
          footer: "border-t-small border-divider",
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h3 className="text-[17px] font-bold leading-6">
                  {materialDisplayText(selectedMaterial?.title)}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Chip size="sm" variant="flat">
                    {materialPlatformLabel(selectedMaterial?.platform)}
                  </Chip>
                  <span className="text-tiny text-default-400">
                    {materialDisplayText(selectedMaterial?.author)}
                  </span>
                  <span className="text-tiny text-default-400">
                    {selectedMaterial?.collectDate &&
                      new Date(selectedMaterial.collectDate).toLocaleString()}
                  </span>
                </div>
              </ModalHeader>
              <ModalBody className="py-5">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>
                    {materialDisplayText(
                      selectedMaterial?.content,
                      "暂无正文内容",
                    )}
                  </ReactMarkdown>
                </div>
                {selectedMaterial?.sourceUrl && (
                  <div className="mt-6 border-t-small border-divider pt-4">
                    <p className="text-tiny text-default-500 mb-1">
                      原文链接：
                    </p>
                    <a
                      href={selectedMaterial.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-small text-primary hover:underline break-all"
                    >
                      {materialSourceLabel(selectedMaterial.sourceUrl)}
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
                  onClick={() =>
                    window.open(selectedMaterial?.sourceUrl, "_blank")
                  }
                >
                  浏览原文
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      <RiskConfirmationDialog
        checklist={[
          "确认这些素材不再用于选题、创作优化或发布。",
          "删除后需要重新采集或重新导入才能恢复。",
        ]}
        confirmLabel="确认删除"
        description={deleteIntent?.description || ""}
        impactItems={[
          {
            label: "影响范围",
            value: `${deleteIntent?.ids.length || 0} 条素材`,
          },
          {
            label: "操作结果",
            value: "从素材与品牌素材库移除",
          },
        ]}
        isLoading={isDeleting}
        isOpen={Boolean(deleteIntent)}
        riskLevel={deleteIntent?.kind === "single" ? "medium" : "high"}
        title={deleteIntent?.title || "确认删除素材"}
        onCancel={() => setDeleteIntent(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
