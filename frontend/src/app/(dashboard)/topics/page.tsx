"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { Card, CardBody, CardHeader, Button, Progress, Chip, Divider, Pagination, Input, Select, SelectItem, Spinner, Textarea, addToast } from "@heroui/react";
import { Icon } from "@iconify/react";
import { topicsApi } from "@/lib/api/topics";
import { articlesApi } from "@/lib/api/articles";
import { Topic, mapApiTopic } from "./data";

export default function TopicsPage() {
    const [topics, setTopics] = useState<Topic[]>([]);
    const [discoveredTopics, setDiscoveredTopics] = useState<Topic[]>([]);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(true);
    // 用于标记正在进行 AI 评估的选题 ID（乐观 UI）
    const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
    // 一键挖掘 loading 状态
    const [isMining, setIsMining] = useState(false);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [seedInput, setSeedInput] = useState("");
    const [discoverySummary, setDiscoverySummary] = useState<null | {
        normalizedSeed: string;
        intent: string;
        audience: string;
        keywords: string[];
        searchQueries: string[];
        retrieval: {
            scannedSources: number;
            fetchedCount: number;
            candidateCount: number;
            matchedCount: number;
            rejectedCount: number;
            savedCount: number;
        };
    }>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("date-desc");
    const [publishFilter, setPublishFilter] = useState("all");
    const [page, setPage] = useState(1);
    const itemsPerPage = 6;

    // 防抖搜索定时器
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 从服务端获取选题列表
    const fetchTopics = useCallback(async (currentPage?: number) => {
        try {
            setLoading(true);
            const query: Record<string, unknown> = {
                page: currentPage ?? page,
                limit: itemsPerPage,
                sortBy,
            };
            if (searchQuery) query.keyword = searchQuery;
            if (publishFilter === "published") query.isPublished = true;
            if (publishFilter === "unpublished") query.isPublished = false;

            const res = await topicsApi.list(query as Record<string, unknown>);
            setTopics(res.items.map(mapApiTopic));
            setTotalPages(res.totalPages);
        } catch (error: unknown) {
            addToast({ title: "加载选题失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setLoading(false);
        }
    }, [page, searchQuery, sortBy, publishFilter]);

    // 初始加载 & 筛选/排序/分页变化时重新请求
    useEffect(() => {
        fetchTopics();
    }, [fetchTopics]);

    // 搜索条件变化时重置到第 1 页（防抖 400ms）
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setPage(1);
        }, 400);
    }, []);

    // 排序 / 发布状态筛选变化时重置到第 1 页
    useEffect(() => {
        setPage(1);
    }, [sortBy, publishFilter]);

    // 一键挖掘新选题
    const handleMine = useCallback(async () => {
        setIsMining(true);
        try {
            const result = await topicsApi.mine();
            addToast({ title: "挖掘完成", description: result.message, color: "success" });
            setPage(1);
            await fetchTopics(1);
        } catch (error: unknown) {
            addToast({ title: "挖掘失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsMining(false);
        }
    }, [fetchTopics]);

    const handleDiscover = useCallback(async () => {
        if (!seedInput.trim()) {
            addToast({ title: "请输入关键词、事件或一段描述", color: "warning" });
            return;
        }

        setIsDiscovering(true);
        try {
            const result = await topicsApi.discover(seedInput.trim());
            const nextTopics = result.topics.map(mapApiTopic);
            setDiscoveredTopics(nextTopics);
            setDiscoverySummary({
                ...result.analysis,
                retrieval: result.retrieval,
            });
            addToast({ title: "智能挖题完成", description: result.message, color: "success" });
            setPage(1);
            await fetchTopics(1);
        } catch (error: unknown) {
            addToast({ title: "智能挖题失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setIsDiscovering(false);
        }
    }, [fetchTopics, seedInput]);

    // AI 全维度评估
    const handleGenerate = useCallback(async (id: string) => {
        setGeneratingIds((prev) => new Set(prev).add(id));
        try {
            await topicsApi.generate(id);
            addToast({ title: "AI 评估完成", color: "success" });
            await fetchTopics();
        } catch (error: unknown) {
            addToast({ title: "AI 评估失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setGeneratingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [fetchTopics]);

    // 发布（以此创作文章 / 图文自动生成）
    const handleCreateContent = useCallback(async (id: string, type: "article" | "xiaohongshu", title?: string) => {
        setGeneratingIds((prev) => new Set(prev).add(id));
        try {
            const contentLabel = type === "xiaohongshu" ? "小红书笔记" : "文章";
            addToast({
                title: `正在为选题创作${contentLabel}...`,
                description: `正在调用 AI 模型为您创作${contentLabel}并进行配图，请耐心等待（通常需30-60秒） ${title || ""}`,
                color: "primary",
            });
            const result = await articlesApi.generate(id, true, type);
            addToast({
                title: `${contentLabel}创作完成！`,
                description: `《${result.title}》已储存在${type === "xiaohongshu" ? "小红书笔记" : "文章库"}中。`,
                color: "success",
            });
            await fetchTopics();
        } catch (error: unknown) {
            addToast({ title: "内容创作失败", description: getErrorMessage(error), color: "danger" });
        } finally {
            setGeneratingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [fetchTopics]);

    // 删除选题
    const handleDelete = useCallback(async (id: string) => {
        try {
            await topicsApi.remove(id);
            addToast({ title: "选题已删除", color: "success" });
            await fetchTopics();
        } catch (error: unknown) {
            addToast({ title: "删除失败", description: getErrorMessage(error), color: "danger" });
        }
    }, [fetchTopics]);

    // 合并服务端状态与本地 generating 乐观状态
    const discoveredIds = new Set(discoveredTopics.map((topic) => topic.id));
    const displayTopics = topics
        .filter((topic) => !discoveredIds.has(topic.id))
        .map((t) =>
        generatingIds.has(t.id) ? { ...t, status: "generating" as const } : t
    );

    const hasVisibleTopics = discoveredTopics.length > 0 || displayTopics.length > 0;

    return (
        <div className="flex flex-col gap-6 max-w-[1400px] mx-auto w-full pb-10">
            <Card className="border-small border-primary/15 bg-background/60 backdrop-blur-md shadow-sm">
                <CardHeader className="flex flex-col items-start gap-2 p-5 pb-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Icon icon="solar:magic-stick-3-bold-duotone" width={22} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-default-900">智能挖题</h3>
                            <p className="text-small text-default-500">输入一个关键词、事件或一段描述，系统会先主动检索相关信息，再整理出 3-5 个不同切入点的候选选题。</p>
                        </div>
                    </div>
                </CardHeader>
                <CardBody className="px-5 pb-5 pt-3">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                        <Textarea
                            minRows={3}
                            placeholder="例如：输入一个关键词（私域运营）、一个事件（某品牌开始用 AI 导购）、或者一段描述（我想写关于餐饮门店如何提升复购的内容）"
                            value={seedInput}
                            variant="bordered"
                            onValueChange={setSeedInput}
                        />
                        <div className="flex items-end">
                            <Button
                                color="primary"
                                className="h-12 min-w-36"
                                isLoading={isDiscovering}
                                startContent={<Icon icon="solar:bolt-bold-duotone" width={18} />}
                                onClick={handleDiscover}
                            >
                                检索并挖题
                            </Button>
                        </div>
                    </div>

                    {discoverySummary ? (
                        <div className="mt-4 rounded-[14px] border border-default-200 bg-default-50/70 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-small text-default-600">
                                <Chip size="sm" color="primary" variant="flat">归一主题：{discoverySummary.normalizedSeed}</Chip>
                                <Chip size="sm" variant="flat">目标读者：{discoverySummary.audience}</Chip>
                            </div>
                            <p className="mt-3 text-small text-default-700">{discoverySummary.intent}</p>
                            <p className="mt-3 text-small text-default-500">
                                本次已主动检索 {discoverySummary.retrieval.scannedSources} 个渠道，抓取 {discoverySummary.retrieval.fetchedCount} 条最新信息，
                                临时池候选 {discoverySummary.retrieval.candidateCount} 条，过滤掉 {discoverySummary.retrieval.rejectedCount} 条低质量或低相关素材，
                                最终保留 {discoverySummary.retrieval.matchedCount} 条，其中新增入库 {discoverySummary.retrieval.savedCount} 条。
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {discoverySummary.keywords.slice(0, 6).map((keyword) => (
                                    <Chip key={keyword} size="sm" variant="flat" className="bg-default-100 text-default-600">{keyword}</Chip>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </CardBody>
            </Card>

            <header className="rounded-[10px] border-small border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 bg-background/60 backdrop-blur-md shadow-sm">
                <div className="flex flex-col">
                    <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">精选选题库</h2>
                    <span className="text-small text-default-500 mt-1">AI 基于您的采集源深度挖掘出具有爆款潜质的内容方向。</span>
                </div>

                <div className="flex w-full md:w-auto items-center gap-3">
                    <Input
                        classNames={{
                            base: "w-full md:max-w-[200px]",
                            mainWrapper: "h-full",
                            input: "text-small",
                            inputWrapper: "h-full font-normal text-default-500 bg-default-400/20 dark:bg-default-500/20",
                        }}
                        placeholder="搜索选题名称..."
                        size="sm"
                        startContent={<Icon icon="solar:magnifer-linear" width={18} />}
                        value={searchQuery}
                        onValueChange={handleSearchChange}
                        isClearable
                    />
                    <Select
                        className="w-[120px]"
                        size="sm"
                        selectedKeys={[publishFilter]}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPublishFilter(e.target.value)}
                        aria-label="创作状态"
                    >
                        <SelectItem key="all">全部创作状态</SelectItem>
                        <SelectItem key="unpublished">未创作</SelectItem>
                        <SelectItem key="published">已创作</SelectItem>
                    </Select>
                    <Select
                        className="w-[140px]"
                        size="sm"
                        selectedKeys={[sortBy]}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value)}
                        aria-label="排序方式"
                    >
                        <SelectItem key="date-desc">最新创建</SelectItem>
                        <SelectItem key="date-asc">最早创建</SelectItem>
                        <SelectItem key="score-desc">AI 评分最高</SelectItem>
                        <SelectItem key="score-asc">AI 评分最低</SelectItem>
                    </Select>
                    <Button color="primary" size="sm" startContent={<Icon icon="solar:magic-stick-3-linear" width={18} />} isLoading={isMining} onClick={handleMine}>
                        一键挖掘新选题
                    </Button>
                </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Spinner size="lg" />
                </div>
            ) : hasVisibleTopics ? (
                <>
                    {discoveredTopics.length > 0 && (
                        <section className="flex flex-col gap-4">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-bold text-default-900">本次候选选题</h3>
                                    <p className="text-small text-default-500">这批选题围绕你的输入自动挖出，切入点彼此不同，可以直接选择创作文章或小红书。</p>
                                </div>
                                <Button
                                    variant="light"
                                    color="primary"
                                    onClick={() => {
                                        setDiscoveredTopics([]);
                                        setDiscoverySummary(null);
                                    }}
                                >
                                    收起本次结果
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {discoveredTopics.map((topic) => (
                                    <TopicCard
                                        key={topic.id}
                                        topic={topic}
                                        onGenerate={handleGenerate}
                                        onDelete={handleDelete}
                                        onCreateContent={(id, type) => handleCreateContent(id, type, topic.title)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {displayTopics.map((topic) => (
                            <TopicCard
                                key={topic.id}
                                topic={topic}
                                onGenerate={handleGenerate}
                                onDelete={handleDelete}
                                onCreateContent={(id, type) => handleCreateContent(id, type, topic.title)}
                            />
                        ))}
                    </div>
                    {totalPages > 1 && (
                        <div className="flex w-full justify-center mt-4">
                            <Pagination
                                isCompact
                                showControls
                                showShadow
                                color="primary"
                                page={page}
                                total={totalPages}
                                onChange={setPage}
                            />
                        </div>
                    )}
                </>
            ) : (
                <Card className="p-12 flex flex-col items-center justify-center bg-content1/50 border border-white/5 shadow-none mt-10">
                    <Icon icon="solar:folder-error-bold-duotone" width={48} className="text-default-300 mb-4" />
                    <p className="text-default-500">没有找到匹配的选题记录</p>
                </Card>
            )}
        </div>
    );
}

const TopicCard = ({
    topic,
    onGenerate,
    onDelete,
    onCreateContent
}: {
    topic: Topic;
    onGenerate: (id: string) => void;
    onDelete: (id: string) => void;
    onCreateContent: (id: string, type: "article" | "xiaohongshu") => void;
}) => {
    const isGenerating = topic.status === "generating";
    const isCompleted = topic.status === "completed";
    const isPublished = topic.isPublished;

    const chartData = [
        { subject: "画像贴合", A: topic.details.audienceFit, fullMark: 100 },
        { subject: "情绪价值", A: topic.details.emotionalValue, fullMark: 100 },
        { subject: "降维科普", A: topic.details.simplificationPotential, fullMark: 100 },
        { subject: "全网声量", A: topic.details.networkVolume, fullMark: 100 },
        { subject: "内容价值", A: topic.details.contentValue, fullMark: 100 },
    ];

    return (
        <Card className="bg-background/60 dark:bg-content1/80 backdrop-blur-md shadow-medium border-small border-white/10 flex flex-col h-full hover:border-primary/50 transition-colors">
            <CardHeader className="flex flex-col items-start gap-2 p-5 pb-3">
                <div className="flex w-full justify-between items-start gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                        {isPublished && (
                            <Chip size="sm" color="success" variant="flat" className="shrink-0 mt-0.5" startContent={<Icon icon="solar:check-circle-bold" className="ml-1" />}>
                                已创作
                            </Chip>
                        )}
                        <h3 className="text-medium font-bold text-default-900 line-clamp-2 leading-snug break-words">
                            {topic.title}
                        </h3>
                    </div>
                    <Chip
                        size="sm"
                        variant={isCompleted ? "solid" : "flat"}
                        color={isCompleted ? "primary" : isGenerating ? "secondary" : "default"}
                        className="shrink-0"
                    >
                        {isCompleted ? `${topic.score} 分` : isGenerating ? "分析中" : "待评估"}
                    </Chip>
                </div>
                <div className="flex gap-2 items-center text-tiny text-default-500 mt-1">
                    <Icon icon="solar:folder-with-files-linear" />
                    <span>{topic.sourceType}</span>
                    <span className="mx-1 opacity-50">•</span>
                    <span>{new Date(topic.createDate).toLocaleDateString()}</span>
                </div>
            </CardHeader>
            <Divider className="opacity-50" />
            <CardBody className="p-5 flex-1 flex flex-col gap-4">
                {isGenerating ? (
                    <div className="flex flex-col flex-1 items-center justify-center gap-4 py-8">
                        <Progress
                            size="sm"
                            isIndeterminate
                            aria-label="Loading..."
                            className="max-w-xs w-full"
                            color="secondary"
                        />
                        <span className="text-small text-default-500 animate-pulse">AI 正在进行推演与创作...请稍候</span>
                    </div>
                ) : !isCompleted ? (
                    <div className="flex flex-col flex-1 items-center justify-center gap-4 py-8">
                        <p className="text-small text-default-600 line-clamp-3">
                            {topic.summary}
                        </p>
                    </div>
                ) : (
                    <>
                        <p className="text-small text-default-600 line-clamp-3">
                            {topic.summary}
                        </p>

                        {isCompleted && topic.reasoning && (
                            <div className="bg-warning/10 dark:bg-warning/5 border-l-3 border-warning p-3 rounded-r-medium">
                                <p className="text-tiny text-warning-700 dark:text-warning-500 font-medium">✨ 商业转化分析</p>
                                <p className="text-small text-default-700 mt-1 line-clamp-3 leading-snug">
                                    {topic.reasoning}
                                </p>
                            </div>
                        )}

                        {isCompleted && (
                            <div className="w-full flex-1 min-h-[160px] relative mt-2 -mb-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartData}>
                                        <PolarGrid stroke="hsl(var(--heroui-default-200))" />
                                        <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--heroui-default-500))', fontSize: 10 }} />
                                        <Radar name="AI 评分" dataKey="A" stroke="hsl(var(--heroui-primary))" fill="hsl(var(--heroui-primary))" fillOpacity={0.3} />
                                    </RadarChart>
                                </ResponsiveContainer>
                            </div>
                        )}

                        {topic.keywords && topic.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-auto pt-2">
                                {topic.keywords.slice(0, 3).map((kw, i) => (
                                    <Chip key={i} size="sm" variant="flat" className="text-tiny h-6 bg-default-100 text-default-600">
                                        {kw}
                                    </Chip>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </CardBody>
            <Divider className="opacity-50" />
            <div className="p-4 flex justify-between items-center bg-default-50/30 mt-auto rounded-b-medium">
                <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isDisabled={isGenerating}
                    onClick={() => onDelete(topic.id)}
                    startContent={<Icon icon="solar:trash-bin-trash-linear" />}
                    isIconOnly
                    aria-label="删除选题"
                />

                <div className="flex gap-2">
                    {!isCompleted && !isGenerating ? (
                        <Button
                            size="sm"
                            color="secondary"
                            variant="flat"
                            onClick={() => onGenerate(topic.id)}
                            startContent={<Icon icon="solar:cpu-bold" />}
                        >
                            全维度评估
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            color="primary"
                            variant={isPublished ? "flat" : "solid"}
                            isDisabled={isGenerating}
                            onClick={() => onCreateContent(topic.id, "article")}
                            startContent={<Icon icon={isPublished ? "solar:pen-new-square-bold-duotone" : "solar:pen-new-square-linear"} />}
                        >
                            {isPublished ? "再写一篇文章" : "创作文章"}
                        </Button>
                    )}
                    {isCompleted && (
                        <Button
                            size="sm"
                            color="secondary"
                            variant="flat"
                            isDisabled={isGenerating}
                            onClick={() => onCreateContent(topic.id, "xiaohongshu")}
                            startContent={<Icon icon="solar:chat-round-dots-linear" />}
                        >
                            创作笔记
                        </Button>
                    )}
                </div>
            </div>
        </Card >
    );
}
    const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "未知错误";
