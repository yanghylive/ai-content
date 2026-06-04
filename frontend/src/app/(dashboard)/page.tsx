"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendCard } from "./components/trend-card";
import { BarChartCard } from "./components/bar-chart-card";
import { Card, CardHeader, CardBody, Divider, Spinner, Chip, Button } from "@heroui/react";
import { dashboardApi, DashboardStats, DraftArticle, TrendDataPoint, SystemLog } from "@/lib/api/dashboard";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import Link from "next/link";
import { FileText, RefreshCw, Target } from "lucide-react";
import { GeoBridgeBanner } from "./components/geo-bridge-banner";
import { fetchGeoBridgeTasks, type GeoBridgeStatus, type GeoBridgeTask } from "@/lib/geo-bridge";

const geoStatusLabels: Record<GeoBridgeStatus, string> = {
    sent_to_ai_content: "已接收",
    running: "执行中",
    published: "已发布",
    waiting_retest: "待复测",
    completed: "已完成",
    blocked: "需要处理",
};

const geoStatusColors: Record<GeoBridgeStatus, "default" | "primary" | "success" | "warning" | "danger"> = {
    sent_to_ai_content: "primary",
    running: "warning",
    published: "success",
    waiting_retest: "warning",
    completed: "success",
    blocked: "danger",
};

function getGeoTaskHref(task: GeoBridgeTask) {
    const action = `${task.actionType} ${task.actionTitle}`.toLowerCase();
    if (/publish|发布/.test(action)) return "/distribution";
    if (/topic|选题|keyword|关键词/.test(action)) return "/topics";
    if (/article|文章|content|内容|小红书/.test(action)) return "/articles";
    return "/agent-console";
}

export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [collectionTrends, setCollectionTrends] = useState<TrendDataPoint[]>([]);
    const [creationTrends, setCreationTrends] = useState<TrendDataPoint[]>([]);
    const [draftArticles, setDraftArticles] = useState<DraftArticle[]>([]);
    const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
    const [geoTasks, setGeoTasks] = useState<GeoBridgeTask[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [statsData, collectionData, creationData, draftData, logsData, geoTaskData] = await Promise.all([
                dashboardApi.stats(),
                dashboardApi.collectionTrends(7),
                dashboardApi.creationTrends(7),
                dashboardApi.draftArticles(5),
                dashboardApi.systemLogs(20),
                fetchGeoBridgeTasks(5),
            ]);
            setStats(statsData);
            setCollectionTrends(collectionData);
            setCreationTrends(creationData);
            setDraftArticles(draftData || []);
            setSystemLogs(logsData || []);
            setGeoTasks(geoTaskData || []);
        } catch {
            // 静默处理，显示空数据
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // 将后端数据转为 TrendCard 需要的格式
    const trendData = stats ? [
        {
            title: "今日素材采集量",
            value: stats.collection.todayCount.toLocaleString(),
            change: `成功率 ${stats.collection.successRate}`,
            changeType: parseFloat(stats.collection.successRate) > 80 ? "positive" as const : "negative" as const,
            trendType: "up" as const,
        },
        {
            title: "待发布草稿",
            value: stats.pendingDraftArticles.toLocaleString(),
            change: "去文章库完成发布",
            changeType: stats.pendingDraftArticles > 0 ? "positive" as const : "neutral" as const,
            trendType: "up" as const,
        },
        {
            title: "今日高分风向词",
            value: stats.topKeyword,
            change: "AI挖掘核心词",
            changeType: "neutral" as const,
            trendType: "neutral" as const,
        },
        {
            title: "今日成片 / 累计总计",
            value: `${stats.articles.todayCount} / ${stats.articles.totalCount}`,
            change: "AI生产输出",
            changeType: "positive" as const,
            trendType: "up" as const,
        },
    ] : [];

    // 趋势图表格式转换
    const chartTrends = collectionTrends.map(d => ({
        name: d.date.slice(5),
        count: d.total,
    }));

    const articleCreationChartData = creationTrends.map(d => ({
        name: d.date.slice(5),
        draft: Number(d.draft || 0),
        published: Number(d.published || 0),
    }));

    if (loading) {
        return (
            <div className="flex flex-col gap-6">
                <header className="kaypal-v3-page-header flex items-center justify-between gap-3 p-4">
                    <h1>AI 工作台与监控中心</h1>
                </header>
                <div className="flex justify-center py-20"><Spinner size="lg" /></div>
            </div>
        );
    }

    const getLevelChip = (level: string) => {
        switch (level) {
            case 'success': return <Chip size="sm" color="success" variant="flat">成功</Chip>;
            case 'warning': return <Chip size="sm" color="warning" variant="flat">警告</Chip>;
            case 'error': return <Chip size="sm" color="danger" variant="flat">错误</Chip>;
            default: return <Chip size="sm" color="default" variant="flat">信息</Chip>;
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="kaypal-v3-page-header flex items-center justify-between gap-3 p-4">
                <h1>AI 工作台与监控中心</h1>
                <Button
                    className="h-9 rounded-[10px] font-semibold"
                    color="primary"
                    endContent={<RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />}
                    onClick={fetchData}
                    size="sm"
                >
                    刷新数据
                </Button>
            </header>

            <GeoBridgeBanner />

            {/* 核心指标区域 */}
            <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {trendData.map((data, index) => (
                    <TrendCard key={index} {...data} />
                ))}
            </div>

            {/* 趋势与分析图表区域 */}
            <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
                <BarChartCard
                    title="近七天素材采集趋势"
                    color="primary"
                    categories={["count"]}
                    categoryNames={{ count: "采集量" }}
                    chartData={chartTrends}
                />
                <BarChartCard
                    title="近七天文章创作趋势"
                    color="success"
                    categories={["draft", "published"]}
                    categoryNames={{ draft: "草稿生成", published: "发布完成" }}
                    chartData={articleCreationChartData}
                />
            </div>

            {/* 待办与系统监控 */}
            <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
                {/* GEO 联动任务 */}
                <Card className="flex h-[400px] flex-col border border-transparent bg-content1 shadow-sm dark:border-default-100">
                    <CardHeader className="items-center justify-between px-5 pt-5 text-[15px] font-bold leading-[22px] text-default-700">
                        <div className="flex items-center gap-2">
                            <span className="kaypal-v3-icon-tile">
                                <Target aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                            </span>
                            <span>GEO 联动任务</span>
                        </div>
                        <Button as={Link} className="h-8 rounded-[8px] font-semibold" href="/agent-console" size="sm" variant="light" color="success">去执行</Button>
                    </CardHeader>
                    <Divider />
                    <CardBody className="overflow-y-auto px-5 pb-5 text-sm">
                        {geoTasks.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-default-500">暂无来自 GEO 的执行任务</div>
                        ) : (
                            <ul className="space-y-4">
                                {geoTasks.map((task) => (
                                    <li key={task.id} className="flex flex-col gap-2 rounded-[10px] border border-divider bg-content2 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h4 className="line-clamp-1 text-[14px] font-bold leading-[22px] text-default-900" title={task.actionTitle}>
                                                    {task.actionTitle}
                                                </h4>
                                                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-default-500">
                                                    {task.brandName ? `${task.brandName} · ` : ""}
                                                    {task.goal || task.reason || task.brief || "来自 Kaypal GEO 的执行动作"}
                                                </p>
                                            </div>
                                            <Chip size="sm" color={geoStatusColors[task.status]} variant="flat" className="flex-shrink-0">
                                                {geoStatusLabels[task.status]}
                                            </Chip>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap gap-1">
                                                {task.platform ? (
                                                    <span className="rounded-[8px] border border-divider bg-content1 px-1.5 py-0.5 text-[11px] font-semibold text-default-500">
                                                        {task.platform}
                                                    </span>
                                                ) : null}
                                                {task.keyword ? (
                                                    <span className="rounded-[8px] border border-divider bg-content1 px-1.5 py-0.5 text-[11px] font-semibold text-default-500">
                                                        #{task.keyword}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {task.returnUrl ? (
                                                    <Button as="a" className="h-8 rounded-[8px] font-semibold" href={task.returnUrl} target="_blank" rel="noreferrer" size="sm" variant="flat">
                                                        返回 GEO
                                                    </Button>
                                                ) : null}
                                                <Button as={Link} className="h-8 rounded-[8px] font-semibold" href={getGeoTaskHref(task)} size="sm" color="success" variant="flat">
                                                    去执行
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="text-[11px] leading-4 text-default-500">
                                            {format(new Date(task.updatedAt), "MM-dd HH:mm", { locale: zhCN })}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>

                {/* 待发布草稿 */}
                <Card className="flex h-[400px] flex-col border border-transparent bg-content1 shadow-sm dark:border-default-100">
                    <CardHeader className="items-center justify-between px-5 pt-5 text-[15px] font-bold leading-[22px] text-default-700">
                        <div className="flex items-center gap-2">
                            <span className="kaypal-v3-icon-tile">
                                <FileText aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                            </span>
                            <span>最新待发布草稿</span>
                        </div>
                        <Button as={Link} className="h-8 rounded-[8px] font-semibold" href="/articles" size="sm" variant="light" color="primary">查看全部</Button>
                    </CardHeader>
                    <Divider />
                    <CardBody className="overflow-y-auto px-5 pb-5 text-sm">
                        {draftArticles.length === 0 ? (
                            <div className="py-10 text-center text-default-500">当前没有待发布的草稿文章</div>
                        ) : (
                            <ul className="space-y-4">
                                {draftArticles.map((article) => (
                                    <li key={article.id} className="flex flex-col gap-2 rounded-[10px] border border-divider bg-content2 p-3">
                                        <div className="flex justify-between items-start">
                                            <h4 className="line-clamp-1 flex-1 pr-4 text-[14px] font-bold leading-[22px] text-default-900" title={article.title}>{article.title}</h4>
                                            <Chip size="sm" color="primary" variant="flat" className="flex-shrink-0">
                                                {article.contentFormat === "html" ? "HTML" : "Markdown"}
                                            </Chip>
                                        </div>
                                        <div className="text-[12px] leading-5 text-default-500">
                                            {article.templateName ? `模板：${article.templateName}` : article.topicTitle ? `来自选题：${article.topicTitle}` : "手动草稿"}
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <div className="flex flex-wrap gap-1">
                                                {article.keywords.slice(0, 3).map(k => (
                                                    <span key={k} className="rounded-[8px] border border-divider bg-content1 px-1.5 py-0.5 text-[11px] font-semibold text-default-500">#{k}</span>
                                                ))}
                                            </div>
                                            <Button as={Link} className="h-8 rounded-[8px] font-semibold" href="/articles" size="sm" color="primary" variant="flat">
                                                去发布
                                            </Button>
                                        </div>
                                        <div className="text-[11px] leading-4 text-default-500">
                                            {format(new Date(article.createdAt), "MM-dd HH:mm", { locale: zhCN })}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>

                {/* 系统运行日志 */}
                <Card className="flex h-[400px] flex-col border border-transparent bg-content1 shadow-sm dark:border-default-100">
                    <CardHeader className="px-5 pt-5 text-[15px] font-bold leading-[22px] text-default-700">实时系统日志</CardHeader>
                    <Divider />
                    <CardBody className="overflow-y-auto px-5 pb-5 text-sm text-default-700">
                        {systemLogs.length === 0 ? (
                            <div className="py-10 text-center text-default-500">目前暂无系统运行日志记录</div>
                        ) : (
                            <ul className="space-y-3">
                                {systemLogs.map((log) => (
                                    <li key={log.id} className="flex flex-col gap-2 border-b border-divider pb-3 last:border-b-0 sm:flex-row sm:items-start">
                                        <div className="flex flex-col gap-1 sm:w-28 flex-shrink-0">
                                            {getLevelChip(log.level)}
                                            <span className="text-[11px] leading-4 text-default-500">
                                                {format(new Date(log.createdAt), "MM-dd HH:mm", { locale: zhCN })}
                                            </span>
                                        </div>
                                        <span className={`flex-1 text-[12px] leading-5 ${log.level === 'error' ? 'text-danger flex-wrap break-all' : 'text-default-700'}`}>
                                            {log.content}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardBody>
                </Card>
            </div>
        </div>
    );
}
