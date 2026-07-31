"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  Blocks,
  CheckCircle2,
  Database,
  Flame,
  Gauge,
  Globe2,
  Inbox,
  Loader2,
  MessageSquareText,
  Plug,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { intelligenceApi } from "@/lib/api/intelligence";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceText } from "./display-text";
import { toPublicError } from "@/lib/public-error";

type ScenarioKey =
  | "all"
  | "general"
  | "trends"
  | "search"
  | "viral"
  | "accounts"
  | "comments"
  | "growth"
  | "compliance"
  | "industries";

type PlatformKey =
  "all" | "xiaohongshu" | "douyin" | "bilibili" | "wechat" | "unknown";

type QueueState = "running" | "done" | "failed" | "queued";

type ScenarioOption = {
  key: ScenarioKey;
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  monitorType: string;
  schedule: string;
};

type QueueItem = {
  id: string;
  skillName: string;
  label: string;
  state: QueueState;
  detail: string;
  href: string;
};

const scenarioOptions: ScenarioOption[] = [
  {
    key: "all",
    label: "全部",
    detail: "全目录",
    href: "/intelligence/skills",
    icon: Blocks,
    monitorType: "keyword",
    schedule: "0 */8 * * *",
  },
  {
    key: "trends",
    label: "热点雷达",
    detail: "热榜、热搜、趋势",
    href: "/intelligence/trends",
    icon: Flame,
    monitorType: "hot",
    schedule: "0 */2 * * *",
  },
  {
    key: "search",
    label: "一键找线索",
    detail: "作品、关键词、用户",
    href: "/intelligence/search",
    icon: Search,
    monitorType: "keyword",
    schedule: "0 */6 * * *",
  },
  {
    key: "viral",
    label: "爆款拆解",
    detail: "低粉爆款、结构参考",
    href: "/intelligence/viral",
    icon: Gauge,
    monitorType: "viral",
    schedule: "0 9 * * *",
  },
  {
    key: "accounts",
    label: "对标账号",
    detail: "账号观察、栏目拆解",
    href: "/intelligence/accounts",
    icon: UsersRound,
    monitorType: "account",
    schedule: "0 */12 * * *",
  },
  {
    key: "comments",
    label: "线索洞察",
    detail: "评论、痛点、异议",
    href: "/intelligence/leads",
    icon: MessageSquareText,
    monitorType: "comment",
    schedule: "0 */6 * * *",
  },
  {
    key: "growth",
    label: "增长获客",
    detail: "策略、线索、账号",
    href: "/growth",
    icon: Sparkles,
    monitorType: "growth",
    schedule: "0 10 * * *",
  },
  {
    key: "compliance",
    label: "风险审核",
    detail: "敏感、版权、夸大",
    href: "/intelligence/risks",
    icon: ShieldAlert,
    monitorType: "risk",
    schedule: "0 9 * * *",
  },
  {
    key: "industries",
    label: "行业源",
    detail: "行业动态、长期源",
    href: "/intelligence/industries",
    icon: Globe2,
    monitorType: "industry",
    schedule: "0 */8 * * *",
  },
  {
    key: "general",
    label: "通用",
    detail: "待归类功能",
    href: "/intelligence/inbox",
    icon: Inbox,
    monitorType: "keyword",
    schedule: "0 */8 * * *",
  },
];

const platformOptions: Array<{ key: PlatformKey; label: string }> = [
  { key: "all", label: "全部平台" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "douyin", label: "抖音" },
  { key: "bilibili", label: "B站" },
  { key: "wechat", label: "微信/公众号" },
  { key: "unknown", label: "未分类" },
];

function scenarioLabel(value?: string | null) {
  return (
    scenarioOptions.find((item) => item.key === value)?.label ||
    value ||
    "未绑定"
  );
}

function scenarioOption(value?: string | null) {
  return (
    scenarioOptions.find((item) => item.key === value) ||
    scenarioOptions.find((item) => item.key === "general")!
  );
}

function platformLabel(value?: string | null) {
  const labels: Record<string, string> = {
    xiaohongshu: "小红书",
    douyin: "抖音",
    bilibili: "B站",
    wechat: "微信/公众号",
    unknown: "未分类",
  };
  return labels[value || ""] || value || "未分类";
}

function inferScenarioOption(
  skill: Pick<RedfoxSkill, "name" | "code" | "summary" | "tags">,
) {
  const text = [skill.name, skill.code, skill.summary, skill.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  if (/热榜|热搜|hot|trend|trending|rank/.test(text)) {
    return scenarioOptions.find((item) => item.key === "trends")!;
  }
  if (/搜索|search|keyword|关键词|作品|笔记/.test(text)) {
    return scenarioOptions.find((item) => item.key === "search")!;
  }
  if (/爆款|viral|低粉|结构|拆解/.test(text)) {
    return scenarioOptions.find((item) => item.key === "viral")!;
  }
  if (/账号|account|user|达人|博主|profile/.test(text)) {
    return scenarioOptions.find((item) => item.key === "accounts")!;
  }
  if (/评论|comment|留言|异议|痛点/.test(text)) {
    return scenarioOptions.find((item) => item.key === "comments")!;
  }
  if (/获客|线索|growth|lead|私域/.test(text)) {
    return scenarioOptions.find((item) => item.key === "growth")!;
  }
  if (/风险|合规|版权|sensitive|risk|compliance/.test(text)) {
    return scenarioOptions.find((item) => item.key === "compliance")!;
  }
  if (/行业|资讯|source|news|公众号|信息源/.test(text)) {
    return scenarioOptions.find((item) => item.key === "industries")!;
  }
  return scenarioOptions.find((item) => item.key === "general")!;
}

function skillScenario(skill: RedfoxSkill) {
  if (
    skill.scenario &&
    scenarioOptions.some((item) => item.key === skill.scenario)
  ) {
    return scenarioOption(skill.scenario);
  }
  return inferScenarioOption(skill);
}

function platformMatches(skill: RedfoxSkill, platform: PlatformKey) {
  if (platform === "all") return true;
  return (skill.platform || "unknown") === platform;
}

function skillQuality(skill: RedfoxSkill) {
  let score = 42;
  if (skill.enabled) score += 18;
  if (skill.summary) score += 10;
  if (skill.tags.length) score += Math.min(18, skill.tags.length * 3);
  if (skill.platform && skill.platform !== "unknown") score += 8;
  if (skill.status === "available") score += 8;
  return Math.min(96, score);
}

function monitorKeyword(skill: RedfoxSkill) {
  return skill.tags[0] || skill.name.slice(0, 24) || skill.code;
}

function abilityName(skill: Pick<RedfoxSkill, "name" | "code">) {
  return publicIntelligenceText(skill.name || skill.code, "系统功能");
}

function abilitySummary(skill: Pick<RedfoxSkill, "summary">) {
  return publicIntelligenceText(skill.summary, "系统已准备好该功能");
}

function statusTone(skill: RedfoxSkill) {
  if (skill.enabled) {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (skill.status === "disabled") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-muted)]";
}

function queueTone(state: QueueState) {
  if (state === "failed") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (state === "running") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
}

export function RedfoxSkillsClient() {
  const [items, setItems] = useState<RedfoxSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [scenario, setScenario] = useState<ScenarioKey>("all");
  const [platform, setPlatform] = useState<PlatformKey>("all");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [runningAction, setRunningAction] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await redfoxApi.listSkills({
        keyword: submittedQuery.trim() || undefined,
        page: 1,
        limit: 100,
      });
      setItems(result.items);
      setTotal(result.total);
      setSelectedId((current) => current || result.items[0]?.id || "");
      if (result.total === 0) {
        setMessage("暂无可用功能，请先刷新功能模板。");
      }
    } catch (error) {
      setItems([]);
      setTotal(0);
      setMessage(toPublicError(error, "功能列表暂时无法读取，请重新加载。"));
    } finally {
      setLoading(false);
    }
  }, [submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    return items.filter((skill) => {
      if (enabledOnly && !skill.enabled) return false;
      if (!platformMatches(skill, platform)) return false;
      if (scenario !== "all" && skillScenario(skill).key !== scenario) {
        return false;
      }
      return true;
    });
  }, [enabledOnly, items, platform, scenario]);

  const selected =
    filteredItems.find((skill) => skill.id === selectedId) ||
    filteredItems[0] ||
    null;
  const selectedScenario = selected
    ? skillScenario(selected)
    : scenarioOptions[0];

  const scenarioRows = useMemo(() => {
    return scenarioOptions.map((option) => {
      const scoped =
        option.key === "all"
          ? items
          : items.filter((skill) => skillScenario(skill).key === option.key);
      return {
        ...option,
        total: scoped.length,
        enabled: scoped.filter((skill) => skill.enabled).length,
      };
    });
  }, [items]);

  const metrics = useMemo(
    () => [
      {
        label: "目录总数",
        value: String(total),
        detail: "系统可用功能",
        icon: Database,
      },
      {
        label: "已启用",
        value: String(items.filter((item) => item.enabled).length),
        detail: "可绑定监控和任务",
        icon: CheckCircle2,
      },
      {
        label: "场景覆盖",
        value: String(
          new Set(items.map((item) => skillScenario(item).key)).size || 0,
        ),
        detail: "已映射业务入口",
        icon: Blocks,
      },
      {
        label: "平台覆盖",
        value: String(new Set(items.map((item) => item.platform)).size || 0),
        detail: "可查内容范围",
        icon: Globe2,
      },
    ],
    [items, total],
  );

  function search() {
    setSubmittedQuery(query.trim());
  }

  async function sync() {
    setLoading(true);
    setMessage("");
    try {
      const result = await redfoxApi.syncSkills({ page: 1, pageSize: 100 });
      setMessage(
        `功能模板刷新完成：接收 ${result.received}，新增 ${result.created}，更新 ${result.updated}。`,
      );
      await load();
    } catch (error) {
      setMessage(toPublicError(error, "功能模板暂时无法同步，请重试。"));
    } finally {
      setLoading(false);
    }
  }

  async function updateSkill(
    skill: RedfoxSkill,
    input: { enabled?: boolean; scenario?: ScenarioKey },
  ) {
    setLoading(true);
    setMessage("");
    try {
      const nextScenario =
        input.scenario ||
        (skill.scenario as ScenarioKey | null) ||
        skillScenario(skill).key;
      const updated = await redfoxApi.updateSkill(skill.id, {
        enabled: input.enabled ?? skill.enabled,
        scenario: nextScenario === "all" ? "general" : nextScenario,
      });
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedId(updated.id);
      setMessage(
        `${abilityName(updated)} 已更新为 ${scenarioLabel(updated.scenario)}。`,
      );
    } catch (error) {
      setMessage(toPublicError(error, "功能设置未更新，请重试。"));
    } finally {
      setLoading(false);
    }
  }

  function updateQueue(id: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function createMonitor(skill: RedfoxSkill) {
    const option = skillScenario(skill);
    const queueId = `${skill.id}:monitor`;
    setRunningAction(queueId);
    setQueue((current) =>
      [
        {
          id: queueId,
          skillName: abilityName(skill),
          label: "创建监控",
          state: "running" as const,
          detail: "正在绑定到自动监控",
          href: "/intelligence/monitors",
        },
        ...current.filter((item) => item.id !== queueId),
      ].slice(0, 8),
    );

    try {
      if (!skill.enabled) {
        const updated = await redfoxApi.updateSkill(skill.id, {
          enabled: true,
          scenario: option.key === "all" ? "general" : option.key,
        });
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }

      await intelligenceApi.createMonitor({
        type: option.monitorType,
        schedule: option.schedule,
        platform: skill.platform || undefined,
        keyword: monitorKeyword(skill),
        industry:
          option.key === "industries" ? monitorKeyword(skill) : undefined,
        skillInstallId: skill.id,
        status: "active",
        costLimitPoints: 300,
        config: {
          source: "redfox-skills-workbench",
          skillCode: skill.code,
          skillName: skill.name,
          scenario: option.key,
          guardrails: ["只读优先", "高风险先审核", "真实采集成功后扣积分"],
        },
      });
      updateQueue(queueId, {
        state: "done",
        detail: "已创建监控，后续结果会进入情报对象池。",
      });
      setMessage(`${abilityName(skill)} 已绑定监控。`);
    } catch (error) {
      updateQueue(queueId, {
        state: "failed",
        detail: toPublicError(error, "监控任务未创建，请重试。"),
      });
    } finally {
      setRunningAction("");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Plug
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">功能模板</p>
                <h1 className="mt-1 text-[24px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">
                  选择系统可以帮你做哪些事
                </h1>
                <p className="mt-1 max-w-4xl text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  按业务场景开启：找热点、找线索、看账号、做拆解、看风险。普通用户不用理解底层来源。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={["h-4 w-4", loading ? "animate-spin" : ""].join(
                    " ",
                  )}
                  strokeWidth={1.8}
                />
                刷新
              </button>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-[13px] font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => void sync()}
                type="button"
              >
                <Database
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                刷新功能模板
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
              <input
                className="h-10 w-full rounded-[8px] pl-9 pr-3 text-[13px]"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") search();
                }}
                placeholder="搜索功能、平台、场景或标签"
                value={query}
              />
            </div>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-[13px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
              onClick={search}
              type="button"
            >
              <Search
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={1.8}
              />
              搜索
            </button>
          </div>

        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <div className="kaypal-v3-panel min-h-[92px] p-3" key={label}>
            <div className="flex items-center justify-between gap-3">
              <p className="kaypal-v3-label">{label}</p>
              <Icon
                aria-hidden="true"
                className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
            </div>
            <p className="mt-1 text-[20px] font-bold leading-7 text-[var(--kaypal-v3-ink)]">
              {value}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">
              {detail}
            </p>
          </div>
        ))}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(360px,0.95fr)_minmax(0,1.05fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">业务场景</p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--kaypal-v3-ink)]">
              功能映射
            </h2>
          </div>
          <div className="grid gap-2 p-3">
            {scenarioRows.map(
              ({ key, label, detail, icon: Icon, total: count, enabled }) => {
                const active = scenario === key;
                return (
                  <button
                    aria-pressed={active}
                    className={[
                      "rounded-[8px] border p-3 text-left transition",
                      active
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                    ].join(" ")}
                    key={key}
                    onClick={() => setScenario(key)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                        <Icon
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                        {label}
                      </span>
                      <span className="text-[12px] font-bold text-[var(--kaypal-v3-accent-ink)]">
                        {count}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">
                      {detail} · 启用 {enabled}
                    </p>
                  </button>
                );
              },
            )}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="kaypal-v3-label">功能列表</p>
                <h2 className="mt-1 text-[16px] font-bold text-[var(--kaypal-v3-ink)]">
                  可用功能
                </h2>
              </div>
              <button
                aria-pressed={enabledOnly}
                className={[
                  "inline-flex h-8 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold transition",
                  enabledOnly
                    ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                    : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)]",
                ].join(" ")}
                onClick={() => setEnabledOnly((value) => !value)}
                type="button"
              >
                <CheckCircle2
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
                已启用
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {platformOptions.map((item) => {
                const active = platform === item.key;
                return (
                  <button
                    aria-pressed={active}
                    className={[
                      "h-8 rounded-[8px] border px-3 text-[12px] font-semibold transition",
                      active
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                    ].join(" ")}
                    key={item.key}
                    onClick={() => setPlatform(item.key)}
                    type="button"
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center p-4 text-[13px] font-semibold text-[var(--kaypal-v3-muted)]">
                <Loader2
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 animate-spin"
                  strokeWidth={1.8}
                />
                正在读取功能
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4">
                <FunctionalEmptyState
                  actions={[
                    { label: "刷新功能", onPress: sync },
                    { href: "/intelligence/search", label: "一键找线索" },
                  ]}
                  description="当前筛选下没有可用功能。可以刷新功能模板，或切换场景、平台后继续配置。"
                  examples={["刷新功能", "切换场景", "切换平台", "绑定监控"]}
                  icon={Blocks}
                  surface="plain"
                  title="当前筛选下没有功能"
                />
              </div>
            ) : (
              filteredItems.map((skill) => {
                const active = selected?.id === skill.id;
                const option = skillScenario(skill);
                return (
                  <button
                    aria-pressed={active}
                    className={[
                      "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                      active
                        ? "bg-[var(--kaypal-v3-accent-soft)]"
                        : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                    ].join(" ")}
                    key={skill.id}
                    onClick={() => setSelectedId(skill.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold",
                              statusTone(skill),
                            ].join(" ")}
                          >
                            {skill.enabled ? "已启用" : "未启用"}
                          </span>
                          <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--kaypal-v3-muted)]">
                            {platformLabel(skill.platform)}
                          </span>
                          <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-[11px] font-semibold text-[var(--kaypal-v3-soft-ink)]">
                            {option.label}
                          </span>
                        </div>
                        <h3 className="mt-2 text-[14px] font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                          {abilityName(skill)}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                          {abilitySummary(skill)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[13px] font-bold text-[var(--kaypal-v3-accent-ink)]">
                        {skillQuality(skill)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">编排详情</p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--kaypal-v3-ink)]">
              {selected ? abilityName(selected) : "等待选择功能"}
            </h2>
          </div>
          {selected ? (
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["平台", platformLabel(selected.platform)],
                  ["场景", selectedScenario.label],
                  ["质量", String(skillQuality(selected))],
                ].map(([label, value]) => (
                  <div
                    className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                    key={label}
                  >
                    <p className="kaypal-v3-label">{label}</p>
                    <p className="mt-1 text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                <p className="kaypal-v3-label">业务去向</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {scenarioOptions
                    .filter((item) => item.key !== "all")
                    .map((option) => {
                      const OptionIcon = option.icon;
                      const active =
                        (selected.scenario || selectedScenario.key) ===
                        option.key;
                      return (
                        <button
                          aria-pressed={active}
                          className={[
                            "rounded-[8px] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                            active
                              ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                              : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)]",
                          ].join(" ")}
                          disabled={loading}
                          key={option.key}
                          onClick={() =>
                            void updateSkill(selected, {
                              scenario: option.key,
                              enabled: true,
                            })
                          }
                          type="button"
                        >
                          <div className="flex items-center gap-2">
                            <OptionIcon
                              aria-hidden="true"
                              className="h-3.5 w-3.5 text-[var(--kaypal-v3-muted)]"
                              strokeWidth={1.8}
                            />
                            <span className="text-[12px] font-bold text-[var(--kaypal-v3-ink)]">
                              {option.label}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">
                            {option.detail}
                          </p>
                        </button>
                      );
                    })}
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                <p className="kaypal-v3-label">动作</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={loading}
                    onClick={() =>
                      void updateSkill(selected, { enabled: !selected.enabled })
                    }
                    type="button"
                  >
                    <SlidersHorizontal
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    {selected.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-[12px] font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={Boolean(runningAction)}
                    onClick={() => void createMonitor(selected)}
                    type="button"
                  >
                    {runningAction === `${selected.id}:monitor` ? (
                      <Loader2
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin"
                        strokeWidth={1.8}
                      />
                    ) : (
                      <BellRing
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                    )}
                    创建监控
                  </button>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                    href={selectedScenario.href}
                  >
                    打开入口
                    <ArrowRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                  </Link>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.78fr)]">
                <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="kaypal-v3-label">标签</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selected.tags.length
                      ? selected.tags.slice(0, 10)
                      : ["只读", "人工确认", selectedScenario.label]
                    ).map((tag) => (
                      <span
                        className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-1 text-[11px] font-semibold text-[var(--kaypal-v3-muted)]"
                        key={`${selected.id}-${tag}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {abilitySummary(selected)}
                  </p>
                </div>

                <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="kaypal-v3-label">执行任务</p>
                  <div className="mt-3 grid gap-2">
                    {queue.length ? (
                      queue.map((item) => (
                        <Link
                          className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                          href={item.href}
                          key={item.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-[var(--kaypal-v3-ink)]">
                              {item.label}
                            </span>
                            <span
                              className={[
                                "rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold",
                                queueTone(item.state),
                              ].join(" ")}
                            >
                              {item.state === "running"
                                ? "执行中"
                                : item.state === "failed"
                                  ? "失败"
                                  : "完成"}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">
                            {item.skillName} · {item.detail}
                          </p>
                        </Link>
                      ))
                    ) : (
                      <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] p-3">
                        <BellRing
                          aria-hidden="true"
                          className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                        <p className="mt-2 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                          监控绑定结果会显示在这里。
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {message ? (
                <p className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                  {message}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center p-4">
              <FunctionalEmptyState
                actions={[
                  { label: "刷新功能", onPress: sync },
                  { href: "/capabilities/models", label: "AI 能力" },
                ]}
                description="系统还没有读到可用功能。刷新功能模板后，可以按场景启用、绑定监控并进入情报流程。"
                examples={["功能模板", "启用功能", "绑定监控", "情报流程"]}
                icon={Database}
                surface="plain"
                title="当前没有可用功能"
              />
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
