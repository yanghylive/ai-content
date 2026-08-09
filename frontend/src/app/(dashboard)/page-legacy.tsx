"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Button, Chip, Spinner } from "@heroui/react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";
import {
  dashboardApi,
  type DashboardStats,
  type DraftArticle,
  type SystemLog,
  type TrendDataPoint,
} from "@/lib/api/dashboard";
import {
  fetchGeoBridgeTasks,
  type GeoBridgeStatus,
  type GeoBridgeTask,
} from "@/lib/geo-bridge";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { ContentResultEntry } from "./components/content-result-entry";
import {
  OpsDenseTable,
  OpsDesktopPage,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsToolbar,
} from "./components/desktop-ops-ui";

const taskStatusLabels: Record<GeoBridgeStatus, string> = {
  sent_to_ai_content: "已接收",
  running: "执行中",
  published: "已发布",
  waiting_retest: "待复核",
  completed: "已完成",
  blocked: "需处理",
};

const taskStatusColors: Record<
  GeoBridgeStatus,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  sent_to_ai_content: "primary",
  running: "warning",
  published: "success",
  waiting_retest: "warning",
  completed: "success",
  blocked: "danger",
};

const DASHBOARD_REQUEST_TIMEOUT_MS = 10_000;

const dashboardRequestLabels = [
  "核心指标",
  "采集趋势",
  "创作趋势",
  "待发布草稿",
  "任务记录",
  "任务队列",
] as const;

function withDashboardTimeout<T>(
  label: string,
  request: Promise<T>,
  onTimeout: () => void,
) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${label}请求超时`));
      onTimeout();
    }, DASHBOARD_REQUEST_TIMEOUT_MS);

    request.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function getTaskHref(task: GeoBridgeTask) {
  const action = `${task.actionType} ${task.actionTitle}`.toLowerCase();
  if (/publish|发布/.test(action)) return "/distribution?tab=tasks";
  if (/topic|选题|keyword|关键词/.test(action)) return "/content/topics";
  if (/article|文章|content|内容|小红书/.test(action)) {
    return "/content/articles";
  }
  return "/tasks/records";
}

function formatTime(value: string | number | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return format(date, "MM-dd HH:mm", { locale: zhCN });
}

function logTone(level: string): "default" | "success" | "warning" | "danger" {
  if (level === "success") return "success";
  if (level === "warning") return "warning";
  if (level === "error") return "danger";
  return "default";
}

function logLabel(level: string) {
  if (level === "success") return "完成";
  if (level === "warning") return "提醒";
  if (level === "error") return "异常";
  return "记录";
}

function dashboardLogText(value: unknown) {
  const text = commercialDisplayText(value, "任务状态已更新")
    .replace(/^[\s🚀✅⚠️❌ℹ️]+/u, "")
    .replace(/\s*[（(](?:模型|model)\s*[：:][^)）]+[)）]/giu, "")
    .replace(/爬虫(?:采集)?/g, "信息采集")
    .replace(/拉取/g, "获取")
    .replace(/入库/g, "保存")
    .replace(/系统日志/g, "任务记录")
    .replace(/\s+/g, " ")
    .trim();
  return text || "任务状态已更新";
}

function isAccountIssueLog(log: SystemLog) {
  return (
    log.level !== "success" &&
    /账号|登录|授权|过期|失效|微信账号|异常/.test(dashboardLogText(log.content))
  );
}

function collectDashboardIssueLogs(logs: SystemLog[]) {
  const uniqueLogs = Array.from(
    logs.reduce((byId, log) => {
      if (!byId.has(log.id)) {
        byId.set(log.id, log);
      }
      return byId;
    }, new Map<string, SystemLog>()).values(),
  );
  const accountIssueLogs = uniqueLogs.filter(isAccountIssueLog);
  const accountIssueIds = new Set(accountIssueLogs.map((log) => log.id));
  const issueLogs = uniqueLogs.filter(
    (log) => log.level === "error" || accountIssueIds.has(log.id),
  );

  return { accountIssueLogs, issueLogs };
}

export default function DashboardPage() {
  const requestIdRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [collectionTrends, setCollectionTrends] = useState<TrendDataPoint[]>([]);
  const [creationTrends, setCreationTrends] = useState<TrendDataPoint[]>([]);
  const [draftArticles, setDraftArticles] = useState<DraftArticle[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [tasks, setTasks] = useState<GeoBridgeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestControllerRef.current?.abort();

    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    activeRequestControllerRef.current = controller;

    try {
      setLoading(true);
      setLoadError(null);
      const [
        statsResult,
        collectionResult,
        creationResult,
        draftResult,
        logsResult,
        taskResult,
      ] = await Promise.allSettled([
        withDashboardTimeout(
          "核心指标",
          dashboardApi.stats(controller.signal),
          abortRequest,
        ),
        withDashboardTimeout(
          "采集趋势",
          dashboardApi.collectionTrends(7, controller.signal),
          abortRequest,
        ),
        withDashboardTimeout(
          "创作趋势",
          dashboardApi.creationTrends(7, controller.signal),
          abortRequest,
        ),
        withDashboardTimeout(
          "待发布草稿",
          dashboardApi.draftArticles(8, controller.signal),
          abortRequest,
        ),
        withDashboardTimeout(
          "任务记录",
          dashboardApi.systemLogs(30, controller.signal),
          abortRequest,
        ),
        withDashboardTimeout(
          "任务队列",
          fetchGeoBridgeTasks(12, controller.signal),
          abortRequest,
        ),
      ] as const);

      if (requestId !== requestIdRef.current) return;

      if (statsResult.status === "fulfilled") setStats(statsResult.value);
      if (collectionResult.status === "fulfilled") {
        setCollectionTrends(collectionResult.value || []);
      }
      if (creationResult.status === "fulfilled") {
        setCreationTrends(creationResult.value || []);
      }
      if (draftResult.status === "fulfilled") {
        setDraftArticles(draftResult.value || []);
      }
      if (logsResult.status === "fulfilled") {
        setSystemLogs(logsResult.value || []);
      }
      if (taskResult.status === "fulfilled") setTasks(taskResult.value || []);

      const results = [
        statsResult,
        collectionResult,
        creationResult,
        draftResult,
        logsResult,
        taskResult,
      ] as const;
      const failedRequests = results.flatMap((result, index) =>
        result.status === "rejected" ? [dashboardRequestLabels[index]] : [],
      );

      if (failedRequests.length > 0) {
        console.error("[dashboard] 部分数据加载失败", {
          failedRequests,
          reasons: results.flatMap((result) =>
            result.status === "rejected" ? [String(result.reason)] : [],
          ),
        });
        setLoadError(
          `${failedRequests.join("、")}暂未加载，已保留其余可用数据。`,
        );
      }
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error("[dashboard] 今日状态加载失败", error);
        setLoadError("今日状态加载失败，请重试。");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        if (activeRequestControllerRef.current === controller) {
          activeRequestControllerRef.current = null;
        }
        setHasLoaded(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchData();
    return () => {
      requestIdRef.current += 1;
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = null;
    };
  }, [fetchData]);

  const pendingTasks = tasks.filter((task) =>
    ["sent_to_ai_content", "waiting_retest", "blocked"].includes(task.status),
  );
  const runningTasks = tasks.filter((task) => task.status === "running");
  const completedTasks = tasks.filter((task) =>
    ["published", "completed"].includes(task.status),
  );
  const { accountIssueLogs, issueLogs } = useMemo(
    () => collectDashboardIssueLogs(systemLogs),
    [systemLogs],
  );
  const todayCreated = creationTrends.at(-1)?.draft || 0;
  const todayCollected = collectionTrends.at(-1)?.total || 0;

  const workRows = [
    {
      label: "待执行任务",
      value: pendingTasks.length,
      status: pendingTasks.length ? "待处理" : "已清空",
      tone: pendingTasks.length ? ("warning" as const) : ("success" as const),
      next: pendingTasks.length ? "先处理确认、复核和待处理项" : "继续保持任务队列为空",
      href: "/tasks",
      action: "打开任务中心",
      icon: Clock3,
    },
    {
      label: "正在运行",
      value: runningTasks.length,
      status: runningTasks.length ? "执行中" : "空闲",
      tone: runningTasks.length ? ("warning" as const) : ("default" as const),
      next: runningTasks.length ? "查看 AI 员工状态和时间线" : "可以开始新的自动任务",
      href: "/tasks/runs",
      action: "看进度",
      icon: Send,
    },
    {
      label: "异常提醒",
      value: issueLogs.length,
      status: issueLogs.length ? "需处理" : "正常",
      tone: issueLogs.length ? ("danger" as const) : ("success" as const),
      next: issueLogs.length ? "先看失败原因和账号状态" : "暂无异常",
      href: "/tasks",
      action: "处理异常",
      icon: AlertTriangle,
    },
    {
      label: "发布准备",
      value: draftArticles.length,
      status: draftArticles.length ? "有草稿" : "无待发布",
      tone: draftArticles.length ? ("brand" as const) : ("default" as const),
      next: draftArticles.length ? "选择账号后创建发布任务" : "先准备素材或内容",
      href: "/distribution?tab=article",
      action: "新建发布",
      icon: FileText,
    },
    {
      label: "账号状态",
      value: accountIssueLogs.length,
      status: accountIssueLogs.length ? "有提醒" : "正常",
      tone: accountIssueLogs.length ? ("warning" as const) : ("success" as const),
      next: accountIssueLogs.length ? "检查登录、授权和平台状态" : "账号状态正常",
      href: "/distribution?tab=accounts",
      action: "检查账号",
      icon: ShieldAlert,
    },
  ];

  const pageActions = (
    <>
      <Button
        as={Link}
        href="/tasks"
        size="sm"
        startContent={<CheckCircle2 size={15} />}
        variant="flat"
      >
        AI员工状态
      </Button>
      <Button
        as={Link}
        color="primary"
        href="/solutions"
        size="sm"
        variant="flat"
      >
        开始任务
      </Button>
      <Button
        color="primary"
        isLoading={loading}
        size="sm"
        startContent={loading ? null : <RefreshCw size={15} />}
        variant="flat"
        onPress={fetchData}
      >
        刷新
      </Button>
    </>
  );

  if (loading && !hasLoaded) {
    return (
      <Layout height="fill">
        <LayoutContent padding={6}>
            <VStack gap={3}>
              <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
                <VStack gap={2}>
                  <Text color="secondary" type="supporting">
                    商业增长 · 今日工作台
                  </Text>
                  <Heading level={1}>今日工作台</Heading>
                  <Text color="secondary">
                    集中查看今日待执行、运行中、异常提醒、发布准备和账号状态。
                  </Text>
                </VStack>
                <div className="flex flex-wrap items-center gap-1.5">
                  {pageActions}
                </div>
              </HStack>
            </VStack>
          </LayoutContent>
        <OpsDesktopPage>
          <OpsPanel>
            <div className="flex min-h-[220px] items-center justify-center">
              <Spinner label="正在读取今日状态" />
            </div>
          </OpsPanel>
          <ContentResultEntry />
        </OpsDesktopPage>
      </Layout>
    );
  }

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
          <VStack gap={3}>
            <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
              <VStack gap={2}>
                <Text color="secondary" type="supporting">
                  商业增长 · 今日工作台
                </Text>
                <Heading level={1}>今日工作台</Heading>
                <Text color="secondary">
                  集中查看今日待执行、运行中、异常提醒、发布准备和账号状态。
                </Text>
              </VStack>
              <div className="flex flex-wrap items-center gap-1.5">
                {pageActions}
              </div>
            </HStack>
          </VStack>
        </LayoutContent>
      <OpsDesktopPage>
      {loadError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-2 text-[13px] text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/15 dark:text-warning-300"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" size={16} />
            {loadError}
          </span>
          <Button
            color="warning"
            isLoading={loading}
            size="sm"
            variant="flat"
            onPress={fetchData}
          >
            重试
          </Button>
        </div>
      ) : null}

      <ContentResultEntry />

      <OpsToolbar>
        <OpsMetric label="今日待执行" tone="brand" value={pendingTasks.length} />
        <OpsMetric label="正在运行" tone="warning" value={runningTasks.length} />
        <OpsMetric label="异常提醒" tone="danger" value={issueLogs.length} />
        <OpsMetric label="账号提醒" tone="warning" value={accountIssueLogs.length} />
        <OpsMetric label="今日素材" value={todayCollected} />
        <OpsMetric label="今日草稿" value={todayCreated} />
      </OpsToolbar>

      <OpsPanel title="AI员工今日状态">
        <OpsDenseTable>
          <table>
            <thead>
              <tr>
                <th>事项</th>
                <th>数量</th>
                <th>状态</th>
                <th>下一步</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {workRows.map((item) => {
                const IconComponent = item.icon;
                return (
                  <tr key={item.label}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-divider bg-default-50">
                          <IconComponent size={15} />
                        </span>
                        <span className="font-semibold">{item.label}</span>
                      </div>
                    </td>
                    <td className="font-semibold">{item.value}</td>
                    <td>
                      <OpsStatusPill tone={item.tone}>{item.status}</OpsStatusPill>
                    </td>
                    <td>{item.next}</td>
                    <td>
                      <Button
                        as={Link}
                        href={item.href}
                        size="sm"
                        variant="flat"
                      >
                        {item.action}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </OpsDenseTable>
      </OpsPanel>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <OpsPanel
          extra={
            <Button as={Link} href="/tasks" size="sm" variant="flat">
              全部任务
            </Button>
          }
          title="待执行任务队列"
        >
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(pendingTasks.length ? pendingTasks : tasks.slice(0, 5)).map(
                  (task) => (
                    <tr key={task.id}>
                      <td>
                        <div className="max-w-[360px]">
                          <div className="truncate font-semibold">
                            {commercialDisplayText(task.actionTitle)}
                          </div>
                          <div className="mt-1 line-clamp-1 text-[12px] text-default-500">
                            {commercialDisplayText(
                              task.goal || task.reason || task.brief || "等待执行",
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{task.platform || task.brandName || "任务中心"}</td>
                      <td>
                        <Chip
                          color={taskStatusColors[task.status]}
                          size="sm"
                          variant="flat"
                        >
                          {taskStatusLabels[task.status]}
                        </Chip>
                      </td>
                      <td>{formatTime(task.updatedAt)}</td>
                      <td>
                        <Button
                          as={Link}
                          href={getTaskHref(task)}
                          size="sm"
                          variant="flat"
                        >
                          查看
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
                {!tasks.length ? (
                  <tr>
                    <td colSpan={5}>当前没有待执行任务。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>

        <OpsPanel
          extra={
            <Button as={Link} href="/distribution?tab=accounts" size="sm" variant="flat">
              账号管理
            </Button>
          }
          title="异常提醒"
        >
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>内容</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {issueLogs.slice(0, 8).map((log) => (
                  <tr key={log.id}>
                    <td>
                      <OpsStatusPill tone={logTone(log.level)}>
                        {logLabel(log.level)}
                      </OpsStatusPill>
                    </td>
                    <td>{dashboardLogText(log.content)}</td>
                    <td>{formatTime(log.createdAt)}</td>
                  </tr>
                ))}
                {!issueLogs.length ? (
                  <tr>
                    <td colSpan={3}>当前没有账号或运行异常。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <OpsPanel
          extra={
            <Button as={Link} href="/distribution?tab=article" size="sm" variant="flat">
              新建发布
            </Button>
          }
          title="发布准备"
        >
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>草稿标题</th>
                  <th>类型</th>
                  <th>关键词</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {draftArticles.slice(0, 6).map((article) => (
                  <tr key={article.id}>
                    <td className="max-w-[420px] truncate">
                      {commercialDisplayText(article.title)}
                    </td>
                    <td>{article.contentFormat === "html" ? "网页内容" : "图文"}</td>
                    <td>
                      {article.keywords
                        .slice(0, 3)
                        .map((keyword) => `#${commercialDisplayText(keyword)}`)
                        .join(" ")}
                    </td>
                    <td>{formatTime(article.createdAt)}</td>
                  </tr>
                ))}
                {!draftArticles.length ? (
                  <tr>
                    <td colSpan={4}>当前没有待发布草稿。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>

        <OpsPanel
          extra={
            <Button as={Link} href="/tasks/records" size="sm" variant="flat">
              查看记录
            </Button>
          }
          title="任务动态"
        >
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>记录</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {systemLogs.slice(0, 10).map((log) => (
                  <tr key={log.id}>
                    <td>
                      <OpsStatusPill tone={logTone(log.level)}>
                        {logLabel(log.level)}
                      </OpsStatusPill>
                    </td>
                    <td>{dashboardLogText(log.content)}</td>
                    <td>{formatTime(log.createdAt)}</td>
                  </tr>
                ))}
                {!systemLogs.length ? (
                  <tr>
                    <td colSpan={3}>目前暂无任务记录。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      </div>

      <OpsPanel title="运行摘要">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[6px] border border-divider bg-default-50 p-3">
            <div className="text-[12px] text-default-500">素材采集成功率</div>
            <div className="mt-1 text-[18px] font-semibold">
              {stats?.collection.successRate || "0%"}
            </div>
          </div>
          <div className="rounded-[6px] border border-divider bg-default-50 p-3">
            <div className="text-[12px] text-default-500">待发布草稿</div>
            <div className="mt-1 text-[18px] font-semibold">
              {stats?.pendingDraftArticles || 0}
            </div>
          </div>
          <div className="rounded-[6px] border border-divider bg-default-50 p-3">
            <div className="text-[12px] text-default-500">今日内容产出</div>
            <div className="mt-1 text-[18px] font-semibold">
              {stats?.articles.todayCount || 0}
            </div>
          </div>
          <div className="rounded-[6px] border border-divider bg-default-50 p-3">
            <div className="text-[12px] text-default-500">最近完成</div>
            <div className="mt-1 text-[18px] font-semibold">
              {completedTasks.length}
            </div>
          </div>
        </div>
      </OpsPanel>
    </OpsDesktopPage>
    </Layout>
  );
}
