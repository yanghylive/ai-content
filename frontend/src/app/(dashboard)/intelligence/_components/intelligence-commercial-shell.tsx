"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  ClipboardList,
  Eye,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { Card } from "@astryxdesign/core/Card";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useHotkeys } from "@astryxdesign/core/hooks";
import type { SearchSource } from "@astryxdesign/core/Typeahead";
import { intelligencePages, intelligenceNavItems } from "../data";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type Role = "owner" | "manager" | "operator";

type KpiEntry = {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  caption: string;
};

type FocusEvidence = {
  sources: string[];
  confidence: number;
  ruleHits: string[];
  generatedAt: string;
};

type FocusEntry = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  actionLabel: string;
  actionHref: string;
  tone: "success" | "error" | "warning" | "info";
  evidence: FocusEvidence;
};

type RoiEntry = {
  label: string;
  spent: number;
  unit: string;
  percent: number;
  caption: string;
};

const kpisByRole: Record<Role, KpiEntry[]> = {
  owner: [
    { label: "本周 AI 运营收益", value: "¥42.8k", delta: "+28%", positive: true, caption: "含节省工时 + 线索价值 + 风险规避" },
    { label: "本月效能回报", value: "3.8×", delta: "+0.6×", positive: true, caption: "对比纯人工方案" },
    { label: "已识别线索价值", value: "¥42k", delta: "+18%", positive: true, caption: "按可成单估算" },
    { label: "本月风险拦截", value: "7 次", delta: "+2", positive: true, caption: "按可避免损失估算" },
  ],
  manager: [
    { label: "待我复核", value: "14", delta: "+3", positive: false, caption: "今日新增 6 项" },
    { label: "团队任务完成率", value: "91%", delta: "+4%", positive: true, caption: "本周平均" },
    { label: "本周已派发", value: "38", delta: "+5", positive: true, caption: "其中 9 项待补证" },
    { label: "超时任务", value: "2", delta: "-3", positive: true, caption: "比上周少" },
  ],
  operator: [
    { label: "今日待办", value: "12", delta: "+2", positive: false, caption: "其中 4 项需复核" },
    { label: "今日可生成选题", value: "14", delta: "+5", positive: true, caption: "等待确认" },
    { label: "新进高优线索", value: "21", delta: "+8", positive: true, caption: "来自评论与监控" },
    { label: "今日节省工时", value: "36h", delta: "+9h", positive: true, caption: "折合约 ¥18k" },
  ],
};

const focusByRole: Record<Role, FocusEntry[]> = {
  owner: [
    {
      id: "owner-01",
      eyebrow: "老板聚焦 01",
      title: "本地生活出现低成本获客模板",
      summary: "近 7 天互动增速 28%，建议立即生成 6 个小红书选题并加入监控。",
      actionLabel: "看详情",
      actionHref: "/intelligence/trends",
      tone: "success",
      evidence: {
        sources: ["小红书评论", "抖音账号", "B站长视频"],
        confidence: 92,
        ruleHits: ["低成本获客关键词", "近 7 天互动增速 ≥ 20%", "可复用模板结构"],
        generatedAt: "今日 09:42",
      },
    },
    {
      id: "owner-02",
      eyebrow: "老板聚焦 02",
      title: "短剧投流素材命中版权风险",
      summary: "建议先送风险审核，再决定是否拆解。预计影响 3 个任务。",
      actionLabel: "看风险",
      actionHref: "/intelligence/risks",
      tone: "error",
      evidence: {
        sources: ["抖音投流素材库", "版权方登记"],
        confidence: 87,
        ruleHits: ["第三方素材引用", "已登记版权内容", "近 30 天发布频次"],
        generatedAt: "今日 10:15",
      },
    },
    {
      id: "owner-03",
      eyebrow: "老板聚焦 03",
      title: "评论中出现 21 条成本/落地需求",
      summary: "可转线索并进入协作台，预估价值 ¥8.4k。",
      actionLabel: "看线索",
      actionHref: "/intelligence/leads",
      tone: "warning",
      evidence: {
        sources: ["小红书评论", "B站弹幕", "抖音评论"],
        confidence: 84,
        ruleHits: ["成本关键词", "落地咨询表达", "近 7 天评论"],
        generatedAt: "今日 11:02",
      },
    },
    {
      id: "owner-04",
      eyebrow: "老板聚焦 04",
      title: "竞品账号周报完整度 84%",
      summary: "补 2 条证据后即可交付管理层。",
      actionLabel: "看报告",
      actionHref: "/intelligence/reports",
      tone: "info",
      evidence: {
        sources: ["对标账号", "历史周报"],
        confidence: 96,
        ruleHits: ["周报模板完整字段", "证据覆盖率 ≥ 80%"],
        generatedAt: "今日 14:30",
      },
    },
  ],
  manager: [
    {
      id: "mgr-01",
      eyebrow: "主管聚焦 01",
      title: "14 项待复核，建议先处理高风险",
      summary: "其中 3 项命中版权规则，预计影响 3 个下游任务。",
      actionLabel: "去复核室",
      actionHref: "/intelligence/collaboration",
      tone: "error",
      evidence: {
        sources: ["复核队列", "风险规则库"],
        confidence: 95,
        ruleHits: ["高风险优先级", "影响下游任务数", "复核超时阈值"],
        generatedAt: "今日 09:00",
      },
    },
    {
      id: "mgr-02",
      eyebrow: "主管聚焦 02",
      title: "本周派发 38 项，9 项待补证",
      summary: "建议先批量催办，避免下周阻塞。",
      actionLabel: "看派发",
      actionHref: "/intelligence/dispatch-records",
      tone: "warning",
      evidence: {
        sources: ["派发记录", "证据回执"],
        confidence: 89,
        ruleHits: ["补证超时", "下游任务依赖"],
        generatedAt: "今日 11:20",
      },
    },
    {
      id: "mgr-03",
      eyebrow: "主管聚焦 03",
      title: "团队完成率提升至 91%",
      summary: "运营一线本周回执率 +12%，节奏稳定。",
      actionLabel: "看周报",
      actionHref: "/intelligence/reports",
      tone: "success",
      evidence: {
        sources: ["团队回执", "历史完成率"],
        confidence: 93,
        ruleHits: ["周完成率趋势", "回执及时率"],
        generatedAt: "今日 16:00",
      },
    },
    {
      id: "mgr-04",
      eyebrow: "主管聚焦 04",
      title: "2 项超时，建议介入",
      summary: "已自动催办一次，仍未响应。",
      actionLabel: "去处理",
      actionHref: "/intelligence/operations",
      tone: "info",
      evidence: {
        sources: ["任务超时日志"],
        confidence: 90,
        ruleHits: ["超时阈值", "自动催办次数"],
        generatedAt: "今日 13:45",
      },
    },
  ],
  operator: [
    {
      id: "op-01",
      eyebrow: "运营聚焦 01",
      title: "今日 12 项待办，4 项需复核",
      summary: "按推荐顺序处理：先复核再生成，再发布。",
      actionLabel: "开始处理",
      actionHref: "/intelligence/inbox",
      tone: "success",
      evidence: {
        sources: ["运营收件箱"],
        confidence: 88,
        ruleHits: ["优先级排序", "复核前置依赖"],
        generatedAt: "今日 09:10",
      },
    },
    {
      id: "op-02",
      eyebrow: "运营聚焦 02",
      title: "14 个可生成选题",
      summary: "来自近 7 天热点 + 评论高频词，6 个可直接采用。",
      actionLabel: "看选题",
      actionHref: "/intelligence/trends",
      tone: "info",
      evidence: {
        sources: ["小红书热点", "抖音评论高频词", "B站长视频"],
        confidence: 90,
        ruleHits: ["近 7 天互动增速", "选题可用度评分"],
        generatedAt: "今日 10:00",
      },
    },
    {
      id: "op-03",
      eyebrow: "运营聚焦 03",
      title: "21 条新进高优线索",
      summary: "含成本/落地咨询，可批量转跟进任务。",
      actionLabel: "看线索",
      actionHref: "/intelligence/leads",
      tone: "warning",
      evidence: {
        sources: ["评论监控", "对话监控"],
        confidence: 85,
        ruleHits: ["高优线索识别", "成本与落地关键词"],
        generatedAt: "今日 11:30",
      },
    },
    {
      id: "op-04",
      eyebrow: "运营聚焦 04",
      title: "今日已节省 36h 人工工时",
      summary: "折合 ¥18k，主要来自自动监控与一键发布。",
      actionLabel: "看成本",
      actionHref: "/intelligence/costs",
      tone: "success",
      evidence: {
        sources: ["工时统计", "成本账本"],
        confidence: 92,
        ruleHits: ["自动任务替代人工工时", "按工时折算"],
        generatedAt: "今日 18:00",
      },
    },
  ],
};

const workflowSteps = [
  { step: "发现", detail: "搜索 / 趋势 / 行业 / 爆款" },
  { step: "判断", detail: "证据 / 评分 / 风险" },
  { step: "执行", detail: "素材 / 选题 / 线索" },
  { step: "协作", detail: "复核 / 派发 / 补证" },
  { step: "沉淀", detail: "报告 / 规则 / 成本" },
];

const roiLedger: RoiEntry[] = [
  { label: "本机处理成本", spent: 3.2, unit: "k¥", percent: 28, caption: "按本月累计" },
  { label: "节省人工", spent: 18, unit: "k¥", percent: 72, caption: "按工时折算" },
  { label: "线索价值", spent: 42, unit: "k¥", percent: 86, caption: "按已识别商机" },
  { label: "风险规避", spent: 7, unit: "次", percent: 64, caption: "本月拦截" },
];

const promises = [
  {
    title: "AI 依据白盒",
    detail: "每条聚焦都能展开查看来源、规则命中与置信度。",
  },
  {
    title: "一键下一步",
    detail: "每条聚焦都能直达对应功能，不需要翻菜单。",
  },
  {
    title: "三视图切换",
    detail: "老板看经营结果，主管看团队执行，运营看今日待办。",
  },
];

const roleMeta: Record<
  Role,
  { label: string; description: string; helper: string; icon: typeof Target }
> = {
  owner: {
    label: "老板视图",
    description: "看本周 AI 运营带来的收益、ROI 与风险规避",
    helper: "按经营结果呈现：收益、风险、回报",
    icon: CircleDollarSign,
  },
  manager: {
    label: "主管视图",
    description: "看团队任务执行、复核队列与完成率",
    helper: "按团队节奏呈现：复核、派发、完成率",
    icon: ClipboardList,
  },
  operator: {
    label: "运营视图",
    description: "看今日待办、可生成选题与新进线索",
    helper: "按操作顺序呈现：待办、选题、线索",
    icon: ShieldCheck,
  },
};

const roleOrder: Role[] = ["owner", "manager", "operator"];

type KpiProps = KpiEntry;

function KpiCard({ label, value, delta, positive, caption }: KpiProps) {
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <Card>
      <VStack gap={2}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <Text color="secondary" type="supporting">
            {label}
          </Text>
          <Badge label={delta} variant={positive ? "success" : "warning"} />
        </HStack>
        <Heading level={2}>{value}</Heading>
        <HStack gap={2} vAlign="center">
          <Icon
            aria-hidden="true"
            className="h-4 w-4"
            strokeWidth={1.8}
            color={positive ? "#12a06a" : "var(--kaypal-v3-amber)"}
          />
          <Text color="secondary" type="supporting">
            {caption}
          </Text>
        </HStack>
      </VStack>
    </Card>
  );
}

function EvidencePanel({ evidence }: { evidence: FocusEvidence }) {
  return (
    <VStack gap={1}>
      <Text color="secondary" type="supporting">
        AI 依据
      </Text>
      <HStack gap={2} wrap="wrap">
        <Badge label={`置信度 ${evidence.confidence}%`} variant="info" />
        <Badge
          label={`${evidence.ruleHits.length} 条规则命中`}
          variant="neutral"
        />
        <Badge label={evidence.generatedAt} variant="neutral" />
      </HStack>
      <VStack gap={1}>
        <Text color="secondary" type="supporting">
          来源
        </Text>
        <HStack gap={1} wrap="wrap">
          {evidence.sources.map((source) => (
            <Badge key={source} label={source} variant="neutral" />
          ))}
        </HStack>
      </VStack>
      <VStack gap={1}>
        <Text color="secondary" type="supporting">
          规则命中
        </Text>
        <VStack gap={1}>
          {evidence.ruleHits.map((rule) => (
            <HStack gap={1} key={rule} vAlign="center">
              <Eye aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
              <Text type="label">{rule}</Text>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </VStack>
  );
}

type FocusProps = { item: FocusEntry };

function FocusCard({ item }: FocusProps) {
  const [open, setOpen] = useState(false);
  const badgeLabel: Record<FocusEntry["tone"], string> = {
    success: "建议立即看",
    error: "需复核",
    warning: "待分配",
    info: "可交付",
  };
  return (
    <Card padding={4}>
      <VStack gap={2}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <Text color="secondary" type="supporting">
            {item.eyebrow}
          </Text>
          <Badge label={badgeLabel[item.tone]} variant={item.tone} />
        </HStack>
        <Heading level={3}>{item.title}</Heading>
        <Text color="secondary" type="supporting">
          {item.summary}
        </Text>
        <HStack gap={2} wrap="wrap">
          <a
            className="text-13 font-semibold text-[color:var(--astryx-color-text-accent,#1677c2)]"
            href={item.actionHref}
          >
            {item.actionLabel} →
          </a>
          <button
            className="ml-auto rounded-[6px] border border-divider px-2 py-1 text-12 font-medium text-default-700 hover:bg-default-100"
            onClick={() => setOpen((prev) => !prev)}
            type="button"
          >
            {open ? "收起 AI 依据" : "展开 AI 依据"}
          </button>
        </HStack>
        {open ? <EvidencePanel evidence={item.evidence} /> : null}
      </VStack>
    </Card>
  );
}

function WorkflowRail() {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <TrendingUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
          <Heading level={3}>增长工作流</Heading>
        </HStack>
        <HStack gap={2} wrap="wrap">
          {workflowSteps.map((step) => (
            <Card key={step.step} padding={3}>
              <VStack gap={1}>
                <Text type="label">{step.step}</Text>
                <Text color="secondary" type="supporting">
                  {step.detail}
                </Text>
              </VStack>
            </Card>
          ))}
        </HStack>
      </VStack>
    </Card>
  );
}

function RoiLedgerCard() {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <HStack gap={2} vAlign="center">
            <CircleDollarSign aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            <Heading level={3}>本月效能账单</Heading>
          </HStack>
          <Badge label="管理者可读" variant="success" />
        </HStack>
        <VStack gap={3}>
          {roiLedger.map((row) => (
            <VStack key={row.label} gap={1}>
              <HStack gap={2} hAlign="between" vAlign="center">
                <Text type="label">{row.label}</Text>
                <Text type="label">
                  {row.spent}
                  {row.unit}
                </Text>
              </HStack>
              <ProgressBar
                aria-label={row.label}
                isLabelHidden
                label={row.label}
                max={100}
                value={row.percent}
              />
              <Text color="secondary" type="supporting">
                {row.caption}
              </Text>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}

function PromisesCard() {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Sparkles aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
          <Heading level={3}>我们承诺</Heading>
        </HStack>
        <VStack gap={2}>
          {promises.map((promise) => (
            <VStack key={promise.title} gap={1}>
              <Text type="label">{promise.title}</Text>
              <Text color="secondary" type="supporting">
                {promise.detail}
              </Text>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}

function RoleSwitcher({
  value,
  onChange,
}: {
  value: Role;
  onChange: (next: Role) => void;
}) {
  return (
    <SegmentedControl
      label="按角色切换首页视图"
      onChange={(next) => {
        if (roleOrder.includes(next as Role)) {
          onChange(next as Role);
        }
      }}
      value={value}
    >
      {roleOrder.map((role) => (
        <SegmentedControlItem
          key={role}
          label={roleMeta[role].label}
          value={role}
        />
      ))}
    </SegmentedControl>
  );
}

export function IntelligenceCommercialShell() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role>("owner");

  const commandItems = useMemo(() => {
    const items = intelligenceNavItems.map((entry) => {
      const fallback = intelligencePages.overview;
      const page =
        intelligencePages[entry.key as keyof typeof intelligencePages] ?? fallback;
      return {
        id: entry.href,
        label: page?.title ?? entry.label,
        auxiliaryData: { group: entry.href === "/intelligence" ? "商业增长" : "快速跳转" },
      };
    });
    return items;
  }, []);

  const searchSource = useMemo<SearchSource>(
    () => ({
      bootstrap: () => commandItems,
      search: (query) => {
        const q = query.trim().toLowerCase();
        if (!q) return commandItems;
        return commandItems.filter((item) => item.label.toLowerCase().includes(q));
      },
    }),
    [commandItems],
  );

  const handleSelect = useCallback(
    (item: { id: string }) => {
      setPaletteOpen(false);
      router.push(item.id);
    },
    [router],
  );

  useHotkeys([
    {
      keys: "mod+k",
      onPress: () => setPaletteOpen((prev) => !prev),
      allowInInputs: true,
    },
    {
      keys: "slash",
      onPress: () => setPaletteOpen((prev) => !prev),
    },
  ]);

  const kpis = kpisByRole[currentRole];
  const focusItems = focusByRole[currentRole];
  const meta = roleMeta[currentRole];

  /* 移动端原生视图（mx-* 明德 VP 风格）——情报总控台移动紧凑版 */
  if (isMobile) {
    const toneBadge = (tone: FocusEntry["tone"]) =>
      tone === "success" ? "mx-badge-green"
        : tone === "error" ? "mx-badge-red"
          : tone === "warning" ? "mx-badge-gold"
            : "mx-badge-blue";
    const toneLabel = (tone: FocusEntry["tone"]) =>
      tone === "success" ? "机会" : tone === "error" ? "风险" : tone === "warning" ? "关注" : "情报";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">数据情报总控台</div>
            <div className="mx-page-sub">今天 AI 帮你赚了什么、挡了什么、下一步该做什么</div>
          </div>

          {/* 角色切换 */}
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            {roleOrder.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setCurrentRole(role)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600, background: currentRole === role ? "var(--kaypal-v3-amber)" : "rgba(120,148,179,.12)", color: currentRole === role ? "#fff" : "var(--mx-ink)", border: currentRole === role ? "1px solid #d98a2d" : "1px solid rgba(142,165,190,.3)" }}
              >
                {roleMeta[role].label}
              </button>
            ))}
          </div>

          {/* KPI */}
          <div className="mx-stat-grid" style={{ marginTop: 12 }}>
            {kpis.slice(0, 2).map((kpi) => (
              <div key={kpi.label} className="mx-card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--mx-muted)" }}>{kpi.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 19, fontWeight: 800, color: "var(--mx-ink)" }}>{kpi.value}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: kpi.positive ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-danger)" }}>{kpi.delta}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mx-stat-grid" style={{ marginTop: 8 }}>
            {kpis.slice(2).map((kpi) => (
              <div key={kpi.label} className="mx-card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--mx-muted)" }}>{kpi.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 19, fontWeight: 800, color: "var(--mx-ink)" }}>{kpi.value}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: kpi.positive ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-danger)" }}>{kpi.delta}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 今日聚焦 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>今日聚焦</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {focusItems.map((item) => (
              <div key={item.id} className="mx-card" style={{ padding: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span className={`mx-badge ${toneBadge(item.tone)}`} style={{ fontSize: 10, flexShrink: 0 }}>
                    {toneLabel(item.tone)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mx-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </span>
                </div>
                <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 6, lineHeight: 1.55 }}>{item.summary}</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 9 }}>
                  <span style={{ fontSize: 10.5, color: "var(--mx-muted)" }}>置信度 {item.evidence.confidence}% · {item.evidence.generatedAt}</span>
                  <button type="button" className="mx-btn-gold" style={{ padding: "6px 14px", fontSize: 11.5 }} onClick={() => router.push(item.actionHref)}>
                    {item.actionLabel}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 快捷导航 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>情报功能</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {intelligenceNavItems.filter((entry) => entry.href !== "/intelligence").map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="mx-card"
                style={{ padding: 12, fontSize: 12.5, fontWeight: 600, color: "var(--mx-ink)", textAlign: "left" }}
                onClick={() => router.push(entry.href)}
              >
                {entry.label} ›
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Layout
      height="fill"
    >
      <LayoutContent padding={6}>
        <VStack gap={6}>
          <CommandPalette
              isOpen={paletteOpen}
              label="跳转到 intelligence 功能"
              onOpenChange={setPaletteOpen}
              searchSource={searchSource}
              onValueChange={(item) => {
                if (item) handleSelect(item as unknown as { id: string });
              }}
            />
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <Target aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                <Text color="secondary" type="supporting">
                  AI 运营增长 · 商业价值总控台
                </Text>
              </HStack>
              <Heading level={1}>把今天的增长结果摆在最前面</Heading>
              <Text color="secondary">
                首屏不讲有多少功能，先讲今天 AI 帮你赚了什么、挡了什么、下一步该做什么。所有功能保留入口，按洞察 / 执行 / 管控 / 资产重组。
              </Text>
              <HStack
                gap={3}
                hAlign="between"
                vAlign="center"
                wrap="wrap"
              >
                <HStack gap={2} vAlign="center">
                  <meta.icon
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                    color="#1677c2"
                  />
                  <Text type="label">{meta.description}</Text>
                </HStack>
                <RoleSwitcher onChange={setCurrentRole} value={currentRole} />
              </HStack>
              <Text color="secondary" type="supporting">
                {meta.helper}
              </Text>
            </VStack>

            <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
              {kpis.map((kpi) => (
                <KpiCard key={kpi.label} {...kpi} />
              ))}
            </Grid>

            <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
              {focusItems.map((item) => (
                <FocusCard item={item} key={item.id} />
              ))}
            </Grid>

            <WorkflowRail />

            <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
              <RoiLedgerCard />
              <PromisesCard />
            </Grid>
          </VStack>
        </LayoutContent>
    </Layout>
  );
}

export default IntelligenceCommercialShell;