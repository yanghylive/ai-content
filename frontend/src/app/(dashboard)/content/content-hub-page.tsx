"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Database,
  FileText,
  LibraryBig,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { BusinessToolResultContext } from "../components/business-tool-result-context";
import { materialsApi, type Material, type MaterialCollectStatus, type MaterialStats } from "@/lib/api/materials";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

type QuickAction = {
  description: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost";
};

const platformLabelMap: Record<string, string> = {
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

const statusLabelMap: Record<Material["status"], string> = {
  unmined: "待挖掘",
  mined: "已挖掘",
  failed: "采集失败",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCount(value: number | null | undefined) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function materialPlatformLabel(value: string | null | undefined) {
  if (!value) return "—";
  return platformLabelMap[value] || commercialDisplayText(value, value);
}

function materialSummary(material: Material) {
  const fallbackContent = material.content
    ? commercialDisplayText(material.content.replace(/\s+/g, " ").slice(0, 120))
    : "";
  return (
    commercialDisplayText(material.summary || fallbackContent) ||
    "暂无摘要"
  );
}

export function ContentHubPage() {
  const router = useRouter();
  const [stats, setStats] = React.useState<MaterialStats | null>(null);
  const [materials, setMaterials] = React.useState<Material[]>([]);
  const [collectStatus, setCollectStatus] =
    React.useState<MaterialCollectStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const [statsResult, materialsResult, collectStatusResult] =
      await Promise.allSettled([
        materialsApi.stats(),
        materialsApi.list({
          limit: 6,
          page: 1,
          sortBy: "collectDate",
          sortOrder: "desc",
        }),
        materialsApi.collectStatus(),
      ]);

    const nextErrors: string[] = [];

    if (statsResult.status === "fulfilled") {
      setStats(statsResult.value);
    } else {
      nextErrors.push("素材统计");
    }

    if (materialsResult.status === "fulfilled") {
      setMaterials(materialsResult.value.items);
    } else {
      nextErrors.push("最近素材");
    }

    if (collectStatusResult.status === "fulfilled") {
      setCollectStatus(collectStatusResult.value);
    } else {
      nextErrors.push("采集队列");
    }

    if (nextErrors.length > 0) {
      setError(`部分数据暂时无法读取：${nextErrors.join("、")}。`);
    }

    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const quickActions: QuickAction[] = [
    {
      label: "进入完整素材库",
      description: "继续筛选、采集、删除与导出素材。",
      icon: Database,
      variant: "primary",
      onClick: () => router.push("/materials"),
    },
    {
      label: "生成选题",
      description: "从素材直接转到选题库。",
      icon: Sparkles,
      onClick: () => router.push("/topics"),
    },
    {
      label: "开始写内容",
      description: "把选题变成可编辑草稿。",
      icon: FileText,
      onClick: () => router.push("/content/articles"),
    },
    {
      label: "内容改写",
      description: "把一份内容改成多平台版本。",
      icon: WandSparkles,
      onClick: () => router.push("/content/optimization"),
    },
    {
      label: "发布前检查",
      description: "先看风险，再进入发布准备。",
      icon: ShieldCheck,
      onClick: () => router.push("/compliance"),
    },
    {
      label: "打开知识库",
      description: "把可复用知识沉淀起来。",
      icon: LibraryBig,
      onClick: () => router.push("/knowledge-base"),
    },
  ];

  const topPlatformItems = (stats?.byPlatform || []).slice(0, 4);
  const activeJobs = collectStatus?.activeJobs || [];
  const nextAction = (() => {
    if (!stats) return "先采集一批素材，再开始选题和写作。";
    if (stats.failed > 0) return "先把采集失败的素材处理掉，再继续内容生产。";
    if (stats.unmined > 0) return "先挖掘待处理素材，再去做选题和改写。";
    if (stats.total > 0) return "可以直接进入选题、创作和发布检查。";
    return "先从外部来源采集素材，再进入内容链路。";
  })();

  return (
    <main aria-label="素材与品牌">
      <BusinessToolResultContext allowedTools={["private-asset-extractor"]} />
      <div className="flex flex-row items-center justify-center min-h-[560px] w-full">
        <section className="max-w-[1280px] mx-auto p-6 w-full">
          <div className="flex flex-col gap-6">
            {error ? (
              <div className="flex flex-col gap-1 rounded-lg border border-warning-200 bg-warning-50 p-4">
                <p className="font-semibold text-warning-700">
                  部分数据暂时不可用
                </p>
                <p className="text-sm text-warning-600">{error}</p>
              </div>
            ) : null}

            <div
              className="grid gap-6 w-full"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              }}
            >
              <Card className="p-6 bg-default-100">
                <CardBody>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-default-500">
                        内容运营 · 中枢入口
                      </span>
                      <h1 className="text-2xl font-bold">素材与品牌</h1>
                      <p className="text-sm text-default-500">
                        先看素材，再去选题、创作、发布或知识沉淀。旧素材管理页仍然保留，
                        这里只做更快的任务入口。
                      </p>
                    </div>

                    <div className="flex flex-col gap-1 rounded-lg border border-primary-200 bg-primary-50 p-4">
                      <p className="font-semibold text-primary-700">
                        Astryx 中枢页
                      </p>
                      <p className="text-sm text-primary-600">
                        这个页面已经切到 Astryx 结构，功能没有减少，只是把首页从重表格改成更适合任务起步的中枢页。
                      </p>
                    </div>

                    <dl className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <dt className="w-[96px] shrink-0 text-sm text-default-500">
                          可见入口
                        </dt>
                        <dd className="text-sm text-foreground">
                          素材、选题、创作、改写、发布、知识
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-[96px] shrink-0 text-sm text-default-500">
                          旧入口
                        </dt>
                        <dd className="text-sm text-foreground">
                          /materials 继续保留为完整管理页
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-[96px] shrink-0 text-sm text-default-500">
                          下一步
                        </dt>
                        <dd className="text-sm text-foreground">{nextAction}</dd>
                      </div>
                    </dl>
                  </div>
                </CardBody>
              </Card>

              <Card className="p-6">
                <CardBody>
                  <div className="flex flex-col gap-4">
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(160px, 1fr))",
                      }}
                    >
                      {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                          <div
                            key={action.label}
                            className="flex flex-col gap-1"
                          >
                            <Button
                              onPress={action.onClick}
                              startContent={
                                <Icon
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                />
                              }
                              color={
                                action.variant === "primary"
                                  ? "primary"
                                  : "default"
                              }
                              variant={
                                action.variant === "primary"
                                  ? "solid"
                                  : action.variant === "secondary"
                                    ? "flat"
                                    : "light"
                              }
                              className="w-full"
                            >
                              {action.label}
                            </Button>
                            <p className="text-sm text-default-500">
                              {action.description}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      onPress={() => void load()}
                      startContent={
                        <RefreshCcw
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                      }
                      variant="flat"
                      className="w-full"
                    >
                      刷新素材概览
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>

            <div
              className="grid gap-4 w-full"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <MetricCard label="素材总数" value={stats?.total} />
              <MetricCard label="待挖掘" value={stats?.unmined} tone="warning" />
              <MetricCard label="已挖掘" value={stats?.mined} tone="success" />
              <MetricCard label="采集失败" value={stats?.failed} tone="danger" />
            </div>

            <div
              className="grid gap-4 w-full"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              <Card className="p-4">
                <CardBody>
                  <div className="flex flex-col gap-3">
                    <h2 className="text-xl font-bold">采集队列</h2>
                    {loading ? (
                      <div className="flex items-center justify-center min-h-[150px] w-full">
                        <div className="flex items-center gap-2">
                          <SkeletonList rows={3} />
                          <span className="text-sm text-default-500">
                            正在读取采集状态...
                          </span>
                        </div>
                      </div>
                    ) : (
                      <dl className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <dt className="w-[88px] shrink-0 text-sm text-default-500">
                            待处理
                          </dt>
                          <dd className="text-sm text-foreground">
                            {formatCount(collectStatus?.pendingCount)}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[88px] shrink-0 text-sm text-default-500">
                            活跃任务
                          </dt>
                          <dd className="text-sm text-foreground">
                            {formatCount(activeJobs.length)}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[88px] shrink-0 text-sm text-default-500">
                            等待中
                          </dt>
                          <dd className="text-sm text-foreground">
                            {formatCount(collectStatus?.counts.waiting)}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[88px] shrink-0 text-sm text-default-500">
                            失败
                          </dt>
                          <dd className="text-sm text-foreground">
                            {formatCount(collectStatus?.counts.failed)}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-[88px] shrink-0 text-sm text-default-500">
                            最近检查
                          </dt>
                          <dd className="text-sm text-foreground">
                            {formatDateTime(collectStatus?.checkedAt)}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card className="p-4">
                <CardBody>
                  <div className="flex flex-col gap-3">
                    <h2 className="text-xl font-bold">平台分布</h2>
                    {loading ? (
                      <div className="flex items-center justify-center min-h-[150px] w-full">
                        <div className="flex items-center gap-2">
                          <SkeletonList rows={3} />
                          <span className="text-sm text-default-500">
                            正在读取平台分布...
                          </span>
                        </div>
                      </div>
                    ) : topPlatformItems.length ? (
                      <div className="flex flex-col gap-2">
                        {topPlatformItems.map((item) => (
                          <div
                            key={item.platform}
                            className="flex items-start gap-2"
                          >
                            <Sparkles
                              aria-hidden="true"
                              className="mt-0.5 h-4 w-4 text-primary"
                            />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-foreground">
                                {materialPlatformLabel(item.platform)}
                              </span>
                              <span className="text-xs text-default-500">
                                {`${formatCount(item.count)} 条素材`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center min-h-[150px] w-full">
                        <p className="text-sm text-default-500">
                          暂无平台分布数据。
                        </p>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card className="p-4">
                <CardBody>
                  <div className="flex flex-col gap-3">
                    <h2 className="text-xl font-bold">下一步建议</h2>
                    <p className="text-sm text-default-500">{nextAction}</p>
                    <dl className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <dt className="w-[88px] shrink-0 text-sm text-default-500">
                          推荐动作
                        </dt>
                        <dd className="text-sm text-foreground">
                          {stats?.total
                            ? stats.unmined > 0
                              ? "先挖掘再创作"
                              : "直接去选题和改写"
                            : "先采集素材"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-[88px] shrink-0 text-sm text-default-500">
                          完整流程
                        </dt>
                        <dd className="text-sm text-foreground">
                          素材 → 选题 → 创作 → 发布检查 → 发布中心
                        </dd>
                      </div>
                    </dl>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card className="p-4">
              <CardBody>
                <div className="flex flex-col gap-4">
                  <div
                    className="grid gap-3 w-full"
                    style={{
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                    }}
                  >
                    <h2 className="text-xl font-bold">最近素材</h2>
                    <Button
                      onPress={() => router.push("/materials")}
                      startContent={
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                      }
                      variant="light"
                      className="w-full"
                    >
                      打开完整素材库
                    </Button>
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center min-h-[220px] w-full">
                      <div className="flex items-center gap-2">
                        <SkeletonList rows={3} />
                        <span className="text-sm text-default-500">
                          正在读取最近素材...
                        </span>
                      </div>
                    </div>
                  ) : materials.length ? (
                    <div className="flex flex-col gap-2">
                      {materials.map((material) => (
                        <div
                          key={material.id}
                          className="flex items-start gap-2"
                        >
                          <Database
                            aria-hidden="true"
                            className="mt-0.5 h-4 w-4 text-primary"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">
                              {commercialDisplayText(material.title)}
                            </span>
                            <span className="text-xs text-default-500">
                              {[
                                materialSummary(material),
                                `平台 ${materialPlatformLabel(material.platform)} · 作者 ${commercialDisplayText(material.author) || "—"} · 采集 ${formatDateTime(material.collectDate)}`,
                                material.keywords.length
                                  ? `关键词：${material.keywords.join(" / ")}`
                                  : "关键词：暂无",
                              ].join(" · ")}
                            </span>
                          </div>
                          <span className="ml-auto text-sm text-default-500">
                            {statusLabelMap[material.status]}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center min-h-[220px] w-full">
                      <div className="flex flex-col gap-2">
                        <h3 className="text-lg font-bold">暂无最近素材</h3>
                        <p className="text-sm text-default-500">
                          可以先去完整素材库采集一批内容，再回到这里继续选题和创作。
                        </p>
                        <Button
                          onPress={() => router.push("/materials")}
                          startContent={
                            <Search
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          }
                          color="primary"
                          className="w-full"
                        >
                          去完整素材库
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
  value: number | undefined | null;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-700"
        : tone === "danger"
          ? "text-danger"
          : "text-default-900";

  return (
    <Card className="p-4 bg-default-100">
      <CardBody>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-default-500">{label}</span>
          <h3 className={`text-lg font-bold ${toneClass}`}>
            {formatCount(value)}
          </h3>
        </div>
      </CardBody>
    </Card>
  );
}
