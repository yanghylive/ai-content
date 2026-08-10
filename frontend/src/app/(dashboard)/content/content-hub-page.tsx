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
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Item } from "@astryxdesign/core/Item";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { BusinessToolResultContext } from "../components/business-tool-result-context";
import { materialsApi, type Material, type MaterialCollectStatus, type MaterialStats } from "@/lib/api/materials";
import { commercialDisplayText } from "@/lib/commercial-display-text";

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
      onClick: () => router.push("/content/topics"),
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
      onClick: () => router.push("/distribution?tab=compliance"),
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
      <Center axis="horizontal" minHeight={560} width="100%">
        <Section maxWidth={1280} padding={6} variant="section" width="100%">
          <VStack gap={6}>
            {error ? (
              <Banner
                container="section"
                description={error}
                status="warning"
                title="部分数据暂时不可用"
              />
            ) : null}

            <Grid columns={{ minWidth: 360, max: 2 }} gap={6} width="100%">
              <Card padding={6} variant="muted">
                <VStack gap={4}>
                  <VStack gap={1}>
                    <Text color="secondary" type="supporting">
                      内容运营 · 中枢入口
                    </Text>
                    <Heading level={1}>素材与品牌</Heading>
                    <Text as="p" color="secondary" type="supporting">
                      先看素材，再去选题、创作、发布或知识沉淀。旧素材管理页仍然保留，
                      这里只做更快的任务入口。
                    </Text>
                  </VStack>

                  <Banner
                    container="section"
                    description="这个页面已经切到 Astryx 结构，功能没有减少，只是把首页从重表格改成更适合任务起步的中枢页。"
                    status="info"
                    title="Astryx 中枢页"
                  />

                  <MetadataList columns="single" label={{ position: "start", width: 96 }}>
                    <MetadataListItem label="可见入口">
                      素材、选题、创作、改写、发布、知识
                    </MetadataListItem>
                    <MetadataListItem label="旧入口">
                      /materials 继续保留为完整管理页
                    </MetadataListItem>
                    <MetadataListItem label="下一步">
                      {nextAction}
                    </MetadataListItem>
                  </MetadataList>
                </VStack>
              </Card>

              <Card padding={6}>
                <VStack gap={4}>
                  <Grid columns={{ minWidth: 160, max: 2 }} gap={3}>
                    {quickActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <VStack key={action.label} gap={1}>
                          <Button
                            label={action.label}
                            onClick={action.onClick}
                            icon={
                              <Icon aria-hidden="true" className="h-4 w-4" />
                            }
                            variant={action.variant || "ghost"}
                            width="100%"
                          />
                          <Text as="p" color="secondary" type="supporting">
                            {action.description}
                          </Text>
                        </VStack>
                      );
                    })}
                  </Grid>

                  <Button
                    label="刷新素材概览"
                    onClick={() => void load()}
                    icon={<RefreshCcw aria-hidden="true" className="h-4 w-4" />}
                    variant="secondary"
                    width="100%"
                  />
                </VStack>
              </Card>
            </Grid>

            <Grid columns={{ minWidth: 180, max: 4 }} gap={4} width="100%">
              <MetricCard label="素材总数" value={stats?.total} />
              <MetricCard label="待挖掘" value={stats?.unmined} tone="warning" />
              <MetricCard label="已挖掘" value={stats?.mined} tone="success" />
              <MetricCard label="采集失败" value={stats?.failed} tone="danger" />
            </Grid>

            <Grid columns={{ minWidth: 280, max: 3 }} gap={4} width="100%">
              <Card padding={4}>
                <VStack gap={3}>
                  <Heading level={2}>采集队列</Heading>
                  {loading ? (
                    <Center minHeight={150} width="100%">
                      <Spinner label="正在读取采集状态..." />
                    </Center>
                  ) : (
                    <MetadataList
                      columns="single"
                      label={{ position: "start", width: 88 }}
                    >
                      <MetadataListItem label="待处理">
                        {formatCount(collectStatus?.pendingCount)}
                      </MetadataListItem>
                      <MetadataListItem label="活跃任务">
                        {formatCount(activeJobs.length)}
                      </MetadataListItem>
                      <MetadataListItem label="等待中">
                        {formatCount(collectStatus?.counts.waiting)}
                      </MetadataListItem>
                      <MetadataListItem label="失败">
                        {formatCount(collectStatus?.counts.failed)}
                      </MetadataListItem>
                      <MetadataListItem label="最近检查">
                        {formatDateTime(collectStatus?.checkedAt)}
                      </MetadataListItem>
                    </MetadataList>
                  )}
                </VStack>
              </Card>

              <Card padding={4}>
                <VStack gap={3}>
                  <Heading level={2}>平台分布</Heading>
                  {loading ? (
                    <Center minHeight={150} width="100%">
                      <Spinner label="正在读取平台分布..." />
                    </Center>
                  ) : topPlatformItems.length ? (
                    <VStack gap={2}>
                      {topPlatformItems.map((item) => (
                        <Item
                          key={item.platform}
                          align="start"
                          density="compact"
                          description={`${formatCount(item.count)} 条素材`}
                          label={materialPlatformLabel(item.platform)}
                          startContent={
                            <Sparkles
                              aria-hidden="true"
                              className="mt-0.5 h-4 w-4 text-primary"
                            />
                          }
                        />
                      ))}
                    </VStack>
                  ) : (
                    <Center minHeight={150} width="100%">
                      <Text as="p" color="secondary" type="supporting">
                        暂无平台分布数据。
                      </Text>
                    </Center>
                  )}
                </VStack>
              </Card>

              <Card padding={4}>
                <VStack gap={3}>
                  <Heading level={2}>下一步建议</Heading>
                  <Text as="p" color="secondary" type="supporting">
                    {nextAction}
                  </Text>
                  <MetadataList columns="single" label={{ position: "start", width: 88 }}>
                    <MetadataListItem label="推荐动作">
                      {stats?.total
                        ? stats.unmined > 0
                          ? "先挖掘再创作"
                          : "直接去选题和改写"
                        : "先采集素材"}
                    </MetadataListItem>
                    <MetadataListItem label="完整流程">
                      素材 → 选题 → 创作 → 发布检查 → 发布中心
                    </MetadataListItem>
                  </MetadataList>
                </VStack>
              </Card>
            </Grid>

            <Card padding={4}>
              <VStack gap={4}>
                <Grid columns={{ minWidth: 220, max: 2 }} gap={3} width="100%">
                  <Heading level={2}>最近素材</Heading>
                  <Button
                    label="打开完整素材库"
                    onClick={() => router.push("/materials")}
                    icon={
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    }
                    variant="ghost"
                    width="100%"
                  />
                </Grid>

                {loading ? (
                  <Center minHeight={220} width="100%">
                    <Spinner label="正在读取最近素材..." />
                  </Center>
                ) : materials.length ? (
                  <VStack gap={2}>
                    {materials.map((material) => (
                      <Item
                        key={material.id}
                        align="start"
                        density="compact"
                        description={[
                          materialSummary(material),
                          `平台 ${materialPlatformLabel(material.platform)} · 作者 ${commercialDisplayText(material.author) || "—"} · 采集 ${formatDateTime(material.collectDate)}`,
                          material.keywords.length
                            ? `关键词：${material.keywords.join(" / ")}`
                            : "关键词：暂无",
                        ].join(" · ")}
                        endContent={
                          <Text as="span" color="secondary" type="supporting">
                            {statusLabelMap[material.status]}
                          </Text>
                        }
                        label={commercialDisplayText(material.title)}
                        startContent={
                          <Database
                            aria-hidden="true"
                            className="mt-0.5 h-4 w-4 text-primary"
                          />
                        }
                      />
                    ))}
                  </VStack>
                ) : (
                  <Center minHeight={220} width="100%">
                    <VStack gap={2}>
                      <Heading level={3}>暂无最近素材</Heading>
                      <Text as="p" color="secondary" type="supporting">
                        可以先去完整素材库采集一批内容，再回到这里继续选题和创作。
                      </Text>
                      <Button
                        label="去完整素材库"
                        onClick={() => router.push("/materials")}
                        icon={
                          <Search aria-hidden="true" className="h-4 w-4" />
                        }
                        variant="primary"
                        width="100%"
                      />
                    </VStack>
                  </Center>
                )}
              </VStack>
            </Card>
          </VStack>
        </Section>
      </Center>
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
    <Card padding={4} variant="muted">
      <VStack gap={1}>
        <Text color="secondary" type="supporting">
          {label}
        </Text>
        <Heading className={toneClass} level={3}>
          {formatCount(value)}
        </Heading>
      </VStack>
    </Card>
  );
}
