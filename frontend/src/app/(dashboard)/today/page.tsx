"use client";

import { BrandLogo } from "@/components/brand-logo";

import React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  PlusSquare,
  Search,
  Settings,
} from "lucide-react";
import { ShellIcon } from "@/components/shell/icons";
import { Ticker, type TickerItem } from "@/components/shell/tickers";
import { useShellUser } from "@/components/shell/app-shell";
import { Avatar } from "@/components/avatar";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { autoUploadApi, type AutoUploadPublishTask } from "@/lib/api/auto-upload";
import { api } from "@/lib/api/client";
import { dashboardApi } from "@/lib/api/dashboard";
import { statsApi, type StatsSnapshot } from "@/lib/api/stats";
import { redfoxApi, type RadarResult } from "@/lib/api/redfox";
import { useIsMobile } from "@/lib/hooks/use-media-query";

interface HotTopic {
  title: string;
  platform: string;
  heat?: string;
  url?: string;
}

const TAG_TINTS = ["kx-t-rose", "kx-t-amber", "kx-t-blue", "kx-t-cyan"];

/** 统一任务中心：模块 → 中文标签 */
const TASK_MODULE_LABEL: Record<string, string> = {
  "auto-upload": "发布",
  interaction: "互动",
  "local-engine": "执行",
  "video-workshop": "视频",
};

/** 统一任务中心：模块 → 详情页路径（报告 8.4：进行中任务可点击详情） */
const TASK_MODULE_HREF: Record<string, string> = {
  "auto-upload": "/distribution/tasks",
  interaction: "/engagement/records",
  "local-engine": "/tasks",
  "video-workshop": "/video-workshop",
};

/** 统一任务中心：状态 → { 文案, tint }（归一化后的 7 态） */
const TASK_STATUS_META: Record<
  string,
  { label: string; tint: string }
> = {
  queued: { label: "排队中", tint: "kx-t-slate" },
  running: { label: "执行中", tint: "kx-t-blue" },
  waiting: { label: "待确认", tint: "kx-t-amber" },
  failed: { label: "失败", tint: "kx-t-rose" },
  completed: { label: "完成", tint: "kx-t-green" },
  cancelled: { label: "已取消", tint: "kx-t-slate" },
  stale: { label: "卡住", tint: "kx-t-amber" },
};

interface UnifiedTaskItem {
  module: string;
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

function isToday(value: unknown): boolean {
  if (value == null) return false;
  let ms: number;
  if (typeof value === "number") {
    ms = value > 1e12 ? value : value * 1000;
  } else {
    const parsed = Date.parse(String(value));
    if (Number.isNaN(parsed)) return false;
    ms = parsed;
  }
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function TodayPage() {
  const router = useRouter();
  const user = useShellUser();
  const [loading, setLoading] = React.useState(true);
  const [waitingCount, setWaitingCount] = React.useState(0);
  const [failedPublish, setFailedPublish] = React.useState<AutoUploadPublishTask[]>([]);
  const [leadCount, setLeadCount] = React.useState(0);
  const [highIntent, setHighIntent] = React.useState(0);
  const [publishedToday, setPublishedToday] = React.useState(0);
  const [materialCount, setMaterialCount] = React.useState(0);
  const [doneItems, setDoneItems] = React.useState<string[]>([]);
  const [newsItems, setNewsItems] = React.useState<TickerItem[]>([]);
  const [hotTopics, setHotTopics] = React.useState<HotTopic[]>([]);
  const [taskItems, setTaskItems] = React.useState<UnifiedTaskItem[]>([]);
  const [weeklyReport, setWeeklyReport] = React.useState<{
    contentCount: number | null;
    publishCount: number | null;
    interactionCount: number | null;
    leadCount: number | null;
    qualifiedLeadCount: number | null;
    convertedCount: number | null;
    wonCount: number | null;
  } | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const [tasks, pubTasks, stats, intel, unified] = await Promise.all([
        localEngineApi.tasks(50).catch(() => [] as InteractionTask[]),
        autoUploadApi.tasks(50).catch(() => [] as AutoUploadPublishTask[]),
        statsApi.snapshot("today").catch(() => null),
        api
          .get<{ items?: HotTopic[] }>("/redfox/hot-topics")
          .catch(() => null),
        dashboardApi.taskCenter(20).catch(() => null),
      ]);
      if (!active) return;

      const taskList = Array.isArray(tasks) ? tasks : [];
      const pubList = Array.isArray(pubTasks) ? pubTasks : [];

      // 统一统计快照（方案 4.3）：计数统一走后端 StatsSnapshot，前端不再拼数
      const statsData = stats as StatsSnapshot | null;
      // stats 加载失败返回 null，展示层显示 N/A（方案 10.2/12.2：服务失败 ≠ 0）
      const metricValue = (key: string): number | null => {
        const found = statsData?.metrics?.find((m) => m.key === key);
        return typeof found?.value === "number" ? found.value : null;
      };

      setWeeklyReport({
        contentCount: metricValue("weekly.content"),
        publishCount: metricValue("weekly.publish"),
        interactionCount: metricValue("weekly.interaction"),
        leadCount: metricValue("weekly.leads"),
        qualifiedLeadCount: metricValue("weekly.qualified"),
        convertedCount: metricValue("weekly.converted"),
        wonCount: metricValue("weekly.won"),
      });

      setWaitingCount(metricValue("today.waiting") ?? 0);
      setLeadCount(metricValue("today.leads") ?? 0);
      setHighIntent(metricValue("today.high_intent") ?? 0);
      setMaterialCount(metricValue("today.materials") ?? 0);

      const unifiedData = unified as {
        items?: UnifiedTaskItem[];
      } | null;
      setTaskItems(
        Array.isArray(unifiedData?.items) ? unifiedData.items.slice(0, 8) : [],
      );

      const failed = pubList.filter((t) => t.status === "failed");
      setFailedPublish(failed);

      // 报告 8.4：发布数按完成/发布时间（updated_at）统计，不用 created_at
      setPublishedToday(
        pubList.filter(
          (t) => t.status === "completed" && isToday(t.updated_at),
        ).length,
      );

      const done: string[] = [];
      pubList
        .filter((t) => t.status === "completed" && isToday(t.updated_at))
        .slice(0, 2)
        .forEach((t) => done.push(`发布「${t.title || `任务 #${t.id}`}」`));
      taskList
        .filter((t) => t.status === "completed")
        .slice(0, 2)
        .forEach((t) =>
          done.push(
            `已回复 ${t.targetName || "客户"}（${t.typeLabel || t.type || "互动"}）`,
          ),
        );
      setDoneItems(done.slice(0, 3));

      // 真实全网热点（RedFox 热榜技能，30 分钟缓存），不再是内部收件箱内容
      const hotData = intel as { items?: HotTopic[] } | null;
      const hotItems = Array.isArray(hotData?.items) ? hotData.items : [];
      setNewsItems(
        hotItems.slice(0, 10).map((item, i) => ({
          id: `hot-${i}`,
          tag: {
            text: item.platform || "全网",
            tint: TAG_TINTS[i % TAG_TINTS.length],
          },
          text: item.title,
          src: item.heat ? `热度 ${item.heat}` : "实时热榜",
        })),
      );
      // 原始热榜（手机版「今日选题」卡用）
      setHotTopics(hotItems.slice(0, 5));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const now = new Date();
  const h = now.getHours();
  const greet =
    h < 6 ? "凌晨好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  const week = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
  const name = user?.displayName || "朋友";

  /* 移动端（<768px）：明德 VP 风格移动视图 */
  const isMobile = useIsMobile();

  const todos: Array<{
    key: string;
    tint: string;
    icon: React.ComponentProps<typeof ShellIcon>["name"];
    title: string;
    desc: string;
    btn: string;
    primary?: boolean;
    href: string;
  }> = [];
  if (waitingCount > 0) {
    todos.push({
      key: "confirm",
      tint: "kx-t-amber",
      icon: "message",
      title: `${waitingCount} 条回复等你确认`,
      desc: "AI 已写好回复，你放行才会发出去",
      btn: "去确认",
      primary: true,
      href: "/tasks/confirmations",
    });
  }
  if (failedPublish.length > 0) {
    todos.push({
      key: "failed",
      tint: "kx-t-rose",
      icon: "alert",
      title: `${failedPublish.length} 个发布任务失败了`,
      desc: `「${failedPublish[0].title || `任务 #${failedPublish[0].id}`}」${failedPublish.length > 1 ? " 等" : ""}发布失败`,
      btn: "去处理",
      href: "/distribution/tasks",
    });
  }
  if (leadCount > 0) {
    todos.push({
      key: "leads",
      tint: "kx-t-blue",
      icon: "users",
      title: `${leadCount} 条新的客户线索`,
      desc: `获客任务抓到的${highIntent > 0 ? `，${highIntent} 条高意向` : ""}`,
      btn: "去看看",
      href: "/growth/leads",
    });
  }

  if (isMobile) {
    return (
      <MobileTodayView
        router={router}
        greet={greet}
        name={name}
        dateStr={dateStr}
        todos={todos}
        loading={loading}
        leadCount={leadCount}
        publishedToday={publishedToday}
        materialCount={materialCount}
        waitingCount={waitingCount}
        doneItems={doneItems}
        failedCount={failedPublish.length}
        hotTopics={hotTopics}
      />
    );
  }

  return (
    <div className="kx-view">
      <h1 className="kx-greet">
        {greet}，{name}
      </h1>
      <p className="kx-greet-sub">
        {dateStr}
        {todos.length > 0 ? ` · 有 ${todos.length} 件事等你处理` : " · 今天都安排妥了"}
      </p>

      {/* 行业新闻滚动条（监控体系的真实产出） */}
      {newsItems.length > 0 ? (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Ticker
              label="行业动态"
              icon="rss"
              items={newsItems}
              speed={60}
              labelColor="var(--kx-cb-fg)"
            />
          </div>
          <button
            type="button"
            className="kx-btn kx-btn-ghost"
            onClick={() => router.push("/intelligence/monitors")}
            style={{
              flexShrink: 0,
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
            aria-label="设置监控行业"
          >
            <Settings size={13} aria-hidden="true" />
            设置行业
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="kx-todo-card" style={{ justifyContent: "center" }}>
          <span className="kx-typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : todos.length === 0 ? (
        <>
          <div className="kx-empty-hero">
            <div className="kx-empty-ico kx-t-green">
              <ShellIcon name="checkCircle" size={30} />
            </div>
            <div className="kx-empty-title">全部搞定了</div>
            <div className="kx-empty-desc">
              现在没有等你处理的事。喝杯茶，或者主动出击：
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => router.push("/content")}
              >
                去创作内容
              </button>
              <button
                type="button"
                className="kx-btn kx-btn-ghost"
                onClick={() => router.push("/growth/leads")}
              >
                查看线索池
              </button>
              <button
                type="button"
                className="kx-btn kx-btn-ghost"
                onClick={() => router.push("/effects")}
              >
                看复盘
              </button>
            </div>
          </div>
        </>
      ) : (
        todos.map((todo) => (
          <div className="kx-todo-card" key={todo.key}>
            <div className={`kx-todo-ico ${todo.tint}`}>
              <ShellIcon name={todo.icon} size={22} />
            </div>
            <div className="kx-todo-body">
              <div className="kx-todo-title">{todo.title}</div>
              <div className="kx-todo-desc">{todo.desc}</div>
            </div>
            <button
              className={todo.primary ? "kx-btn kx-btn-primary" : "kx-btn kx-btn-ghost"}
              onClick={() => router.push(todo.href)}
            >
              {todo.btn}
            </button>
          </div>
        ))
      )}

      <div className="kx-actions">
        <button className="kx-action-card" onClick={() => router.push("/customer")}>
          <div className="kx-action-ico kx-t-slate">
            <ShellIcon name="briefcase" size={22} />
          </div>
          <div className="kx-action-title">找客户</div>
          <div className="kx-action-desc">告诉系统你的客户是谁，它自动帮你找</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/content")}>
          <div className="kx-action-ico kx-t-blue">
            <ShellIcon name="fileText" size={22} />
          </div>
          <div className="kx-action-title">做内容</div>
          <div className="kx-action-desc">AI 帮你写图文、做小红书和公众号</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/distribution")}>
          <div className="kx-action-ico kx-t-green">
            <ShellIcon name="megaphone" size={22} />
          </div>
          <div className="kx-action-title">发出去</div>
          <div className="kx-action-desc">一键发到抖音、小红书、视频号</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/materials")}>
          <div className="kx-action-ico kx-t-slate">
            <ShellIcon name="download" size={22} />
          </div>
          <div className="kx-action-title">上传素材</div>
          <div className="kx-action-desc">去水印、生图、视频素材入库</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/viral-analysis")}>
          <div className="kx-action-ico kx-t-amber">
            <ShellIcon name="trending" size={22} />
          </div>
          <div className="kx-action-title">爆款拆解</div>
          <div className="kx-action-desc">链接丢进来，AI 拆套路</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/savings")}>
          <div className="kx-action-ico kx-t-green">
            <ShellIcon name="wallet" size={22} />
          </div>
          <div className="kx-action-title">省钱返利</div>
          <div className="kx-action-desc">返利/美团/特惠，顺手省钱</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/intelligence")}>
          <div className="kx-action-ico kx-t-cyan">
            <ShellIcon name="target" size={22} />
          </div>
          <div className="kx-action-title">情报中心</div>
          <div className="kx-action-desc">行业情报、监控、报告入口</div>
        </button>
      </div>

      <div className="kx-section-title">
        <ShellIcon name="chart" />
        今天的进展
      </div>
      <div className="kx-progress-row">
        <div className="kx-stat-card">
          <div className="kx-stat-num kx-stat-accent">{leadCount}</div>
          <div className="kx-stat-lbl">新线索</div>
        </div>
        <div className="kx-stat-card">
          <div className="kx-stat-num kx-stat-accent">{publishedToday}</div>
          <div className="kx-stat-lbl">内容已发布</div>
        </div>
        <div className="kx-stat-card">
          <div className="kx-stat-num kx-stat-ok">{materialCount}</div>
          <div className="kx-stat-lbl">素材已采集</div>
        </div>
        <div className="kx-stat-card">
          <div className="kx-stat-num kx-stat-amber">{waitingCount}</div>
          <div className="kx-stat-lbl">待确认</div>
        </div>
      </div>

      {weeklyReport ? (
        <>
          <div className="kx-section-title">
            <ShellIcon name="chart" />
            本周复盘（近 7 天）
          </div>
          <div className="kx-progress-row">
            <div className="kx-stat-card">
              <div className="kx-stat-num">{weeklyReport.contentCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">本周内容</div>
            </div>
            <div className="kx-stat-card">
              <div className="kx-stat-num kx-stat-accent">{weeklyReport.publishCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">本周发布</div>
            </div>
            <div className="kx-stat-card">
              <div className="kx-stat-num">{weeklyReport.interactionCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">本周互动</div>
            </div>
            <div className="kx-stat-card">
              <div className="kx-stat-num kx-stat-accent">{weeklyReport.leadCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">本周线索</div>
            </div>
          </div>
          <div className="kx-progress-row" style={{ marginTop: 10 }}>
            <div className="kx-stat-card">
              <div className="kx-stat-num kx-stat-amber">{weeklyReport.qualifiedLeadCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">合格线索</div>
            </div>
            <div className="kx-stat-card">
              <div className="kx-stat-num kx-stat-ok">{weeklyReport.convertedCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">线索成交</div>
            </div>
            <div className="kx-stat-card">
              <div className="kx-stat-num kx-stat-ok">{weeklyReport.wonCount ?? "N/A"}</div>
              <div className="kx-stat-lbl">商机赢单</div>
            </div>
          </div>
        </>
      ) : null}

      {taskItems.length > 0 ? (
        <>
          <div className="kx-section-title">
            <ShellIcon name="layers" />
            进行中的任务
          </div>
          <div>
            {taskItems.map((t) => {
              const meta = TASK_STATUS_META[t.status] ?? {
                label: t.status,
                tint: "kx-t-slate",
              };
              return (
                <button
                  className="kx-done-item"
                  key={`${t.module}-${t.id}`}
                  type="button"
                  style={{
                    color: "var(--kx-muted)",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    router.push(TASK_MODULE_HREF[t.module] ?? "/tasks")
                  }
                >
                  <span className={`kx-tag ${meta.tint}`}>
                    {TASK_MODULE_LABEL[t.module] ?? t.module}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      // 长标题（含错误详情）自动换行完整显示，不截断省略；
                      // 短标题保持单行省略
                      ...((t.title?.length ?? 0) > 40
                        ? { whiteSpace: "normal", lineHeight: 1.5, overflow: "visible", wordBreak: "break-all" }
                        : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
                      color: "var(--kx-ink)",
                    }}
                    title={t.title}
                  >
                    {t.title}
                  </span>
                  <span style={{ flexShrink: 0 }}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {doneItems.length > 0 ? (
        <>
          <div className="kx-section-title">
            <ShellIcon name="checkCircle" />
            今天已完成
          </div>
          <div>
            {doneItems.map((item, i) => (
              <div className="kx-done-item" key={i}>
                <span className="kx-done-check">
                  <ShellIcon name="check" size={15} strokeWidth={2} />
                </span>
                {item}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

interface MobileTodayViewProps {
  router: ReturnType<typeof useRouter>;
  greet: string;
  name: string;
  dateStr: string;
  todos: Array<{
    key: string;
    tint: string;
    icon: React.ComponentProps<typeof ShellIcon>["name"];
    title: string;
    desc: string;
    btn: string;
    primary?: boolean;
    href: string;
  }>;
  loading: boolean;
  leadCount: number;
  publishedToday: number;
  materialCount: number;
  waitingCount: number;
  doneItems: string[];
  failedCount: number;
  hotTopics: HotTopic[];
}

function MobileTodayView({
  router,
  greet,
  name,
  dateStr,
  todos,
  loading,
  leadCount,
  publishedToday,
  materialCount,
  waitingCount,
  doneItems,
  failedCount,
  hotTopics,
}: MobileTodayViewProps) {
  const pendingCount = todos.length;
  const quickActions: Array<{
    label: string;
    sub: string;
    icon: React.ComponentProps<typeof ShellIcon>["name"];
    tint: string;
    href: string;
  }> = [
    { label: "写内容", sub: "AI 生成", icon: "pen", tint: "#20497f", href: "/content" },
    { label: "上传素材", sub: "相册/相机", icon: "download", tint: "#bc7120", href: "/materials" },
    { label: "客户", sub: "跟进管理", icon: "users", tint: "#37705d", href: "/customer" },
    { label: "准备发布", sub: "多平台", icon: "send", tint: "#76517e", href: "/distribution" },
    { label: "品牌知识库", sub: "AI 写对品牌", icon: "fileText", tint: "#a16207", href: "/knowledge" },
    { label: "回复建议", sub: "评论 AI 帮回", icon: "messageSq", tint: "#37705d", href: "/reply" },
    { label: "爆款拆解", sub: "爆款 AI 拆套路", icon: "trending", tint: "#d97706", href: "/viral-analysis" },
    { label: "省钱返利", sub: "返利/美团/特惠", icon: "wallet", tint: "#2e7d32", href: "/savings" },
  ];

  // 竞品雷达（RedFox 抖音账号搜索，30 分钟缓存）
  const [radar, setRadar] = React.useState<RadarResult | null>(null);
  const [radarLoading, setRadarLoading] = React.useState(false);
  const [radarKeyword, setRadarKeyword] = React.useState("AI 编程");

  const loadRadar = React.useCallback(async (keyword: string) => {
    setRadarLoading(true);
    try {
      const result = await redfoxApi.radar({ keyword, limit: 4 });
      setRadar(result);
    } catch {
      setRadar(null);
    } finally {
      setRadarLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadRadar(radarKeyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉一次
  }, []);

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">{greet}，{name}</h1>
            <p className="mx-page-sub">{dateStr}{pendingCount > 0 ? ` · ${pendingCount} 件事等你处理` : " · 今天都安排妥了"}</p>
          </div>
          <button
            type="button"
            className="mx-control"
            aria-label="通知"
            style={{ position: "relative", width: 42, height: 42, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mx-ic-tint)", flexShrink: 0 }}
            onClick={() =>
              router.push(todos.length > 0 ? todos[0].href : "/message")
            }
          >
            <ShellIcon name="bell" size={18} />
            {pendingCount > 0 ? (
              <span className="mx-mini-badge" style={{ top: 6, right: 7, minWidth: 16, height: 16, fontSize: 9 }}>{pendingCount > 99 ? "99+" : pendingCount}</span>
            ) : null}
          </button>
        </div>
      </header>

      {/* 待办 hero */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-hero" style={{ padding: 20 }}>
          <div className="mx-hero-ring" style={{ width: 130, height: 130, top: -34, right: -26 }} />
          <div className="mx-hero-ring" style={{ width: 82, height: 82, top: 14, right: 22, borderColor: "rgba(240,179,90,.15)" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <span className="mx-badge mx-badge-white" style={{ marginBottom: 10 }}>
              <Clock width={12} height={12} />
              今日待办
            </span>
            {loading ? (
              <div style={{ marginTop: 4 }}>
                <div className="mx-skeleton" style={{ width: "70%", height: 22 }} />
                <div className="mx-skeleton" style={{ width: "46%", height: 22, marginTop: 8 }} />
              </div>
            ) : pendingCount > 0 ? (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                {pendingCount} 项待处理<br />
                <span style={{ color: "#f4bb67" }}>{todos[0]?.title.split(" ")[0] || "等待处理"}</span>
              </h2>
            ) : (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                今天都安排妥了<br />
                <span style={{ color: "#f4bb67" }}>喝杯茶，或主动出击</span>
              </h2>
            )}
            <p className="mx-page-sub" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "rgba(219,234,254,.78)" }}>
              {failedCount > 0 ? `${failedCount} 个发布任务失败 · ` : ""}{waitingCount > 0 ? `${waitingCount} 条回复待确认` : "暂无异常"}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {todos.length > 0 ? (
                <button type="button" className="mx-btn-gold" onClick={() => router.push(todos[0].href)}>
                  {todos[0].btn}
                  <ArrowRight width={13} height={13} />
                </button>
              ) : null}
              <button
                type="button"
                className="mx-btn-gold"
                style={{ background: "rgba(255,255,255,.08)", color: "#dbe7f5", border: "1px solid rgba(255,255,255,.2)", boxShadow: "none", backgroundImage: "none" }}
                onClick={() => router.push("/content")}
              >
                开始创作
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 今日选题（RedFox 全网热榜，点击直达创作） */}
      {hotTopics.length > 0 && (
        <section className="mx-px mx-mt-lg">
          <div className="mx-section-head">
            <div>
              <div className="mx-section-title">
                <span className="mx-sec-icon">
                  <Flame width={15} height={15} />
                </span>
                今日选题
              </div>
              <p className="mx-section-eyebrow">全网热榜 · 30 分钟更新</p>
            </div>
            <span className="mx-section-action" onClick={() => router.push("/topics")}>
              查看全部 →
            </span>
          </div>
          <div className="mx-hero" style={{ padding: 16 }}>
            <div className="mx-hero-ring" style={{ width: 100, height: 100, top: -26, right: -20 }} />
            <div style={{ position: "relative", zIndex: 2 }}>
              {hotTopics.slice(0, 3).map((topic, i) => (
                <div
                  key={`topic-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 0",
                    borderBottom: i < 2 ? "1px solid rgba(255,255,255,.1)" : "none",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    router.push(`/content?topic=${encodeURIComponent(topic.title)}`)
                  }
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 7,
                      background: "rgba(255,255,255,.14)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#f6c478",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {topic.title}
                    </p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,.55)", marginTop: 2 }}>
                      {topic.platform} · 热度 {topic.heat}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mx-btn-gold"
                    style={{ padding: "6px 11px", fontSize: 11, flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/content?topic=${encodeURIComponent(topic.title)}`);
                    }}
                  >
                    用这个
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 快捷动作 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><PlusSquare /></span>
              快捷动作
            </div>
            <p className="mx-section-eyebrow">高频操作，一步直达</p>
          </div>
        </div>
        <div className="mx-svc-grid">
          {quickActions.map((action) => (
            <button key={action.label} type="button" className="mx-svc-item mx-control" onClick={() => router.push(action.href)}>
              <span className="mx-svc-ic" style={{ background: "rgba(233,240,250,.75)", color: action.tint }}>
                <ShellIcon name={action.icon} size={19} />
              </span>
              <span className="mx-svc-name">{action.label}</span>
              <span className="mx-svc-sub">{action.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 今日进展 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><BarChart3 /></span>
              今日进展
            </div>
            <p className="mx-section-eyebrow">实时统计</p>
          </div>
        </div>
        <div className="mx-stat-grid">
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{leadCount}</div><div className="mx-stat-label">新线索</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text">{publishedToday}</div><div className="mx-stat-label">已发布</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{materialCount}</div><div className="mx-stat-label">素材</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{waitingCount}</div><div className="mx-stat-label">待确认</div></div>
        </div>
      </section>

      {/* 最近完成 */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><CheckCircle2 /></span>
              最近完成
            </div>
            <p className="mx-section-eyebrow">今天已完成的事</p>
          </div>
        </div>
        <div className="mx-card mx-list-card">
          {doneItems.length === 0 ? (
            <div className="mx-empty"><p>今天还没有完成事项</p></div>
          ) : (
            doneItems.map((item, i) => (
              <div className="mx-row" key={i}>
                <span className="mx-row-ic" style={{ background: "rgba(16,185,129,.1)", color: "#059669" }}>
                  <CheckCircle2 />
                </span>
                <div className="mx-row-main"><div className="mx-row-title">{item}</div><div className="mx-row-desc">已完成</div></div>
                <div className="mx-row-right"><span className="mx-badge mx-badge-green">完成</span></div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 数据复盘（今日小结：发布成功率 + 待确认 + 完成事项） */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><Clock /></span>
              数据复盘
            </div>
            <p className="mx-section-eyebrow">今日小结与建议</p>
          </div>
        </div>
        <div className="mx-card" style={{ padding: 14 }}>
          <div className="mx-stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text">{publishedToday}</div><div className="mx-stat-label">已发布</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num">{failedCount}</div><div className="mx-stat-label">失败</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num">{waitingCount}</div><div className="mx-stat-label">待确认</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num">{doneItems.length}</div><div className="mx-stat-label">已完成</div></div>
          </div>
          {publishedToday + failedCount > 0 && (
            <p className="mx-section-eyebrow" style={{ marginTop: 8 }}>
              发布成功率 {Math.round((publishedToday / (publishedToday + failedCount)) * 100)}% ·{" "}
              {waitingCount > 0 ? `还有 ${waitingCount} 条回复/任务待你确认` : "今日无待确认事项"}
            </p>
          )}
        </div>
      </section>

      {/* 竞品雷达（RedFox 抖音账号搜索，按关键词扫描） */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><Search /></span>
              竞品雷达
            </div>
            <p className="mx-section-eyebrow">抖音 · 30 分钟更新 · 全网热榜数据</p>
          </div>
        </div>
        <div className="mx-card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={radarKeyword}
              onChange={(e) => setRadarKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadRadar(radarKeyword);
              }}
              placeholder="输入行业关键词，如：美业 / 餐饮 / AI"
              className="mx-control"
              style={{ flex: 1, padding: "9px 12px", fontSize: 13 }}
            />
            <button
              type="button"
              className="mx-btn-gold"
              disabled={radarLoading}
              onClick={() => void loadRadar(radarKeyword)}
              style={{ fontSize: 13, padding: "9px 16px", whiteSpace: "nowrap" }}
            >
              {radarLoading ? "扫描中…" : "扫描"}
            </button>
          </div>
          {radarLoading ? (
            <div className="mx-empty"><p>正在扫描竞品账号…</p></div>
          ) : radar && radar.items.length > 0 ? (
            radar.items.map((account) => (
              <div className="mx-row" key={account.accountId}>
                <span
                  className="mx-row-ic"
                  style={{
                    background: "rgba(99,102,241,.12)",
                    color: "#6366f1",
                    overflow: "hidden",
                    borderRadius: 12,
                  }}
                >
                  <Avatar
                    src={account.avatarUrl}
                    name="竞"
                    size={36}
                    alt={account.name || "竞品账号"}
                    radius={12}
                    color="#6366f1"
                  />
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">{account.name}</div>
                  <div className="mx-row-desc">
                    {(account.followers / 10000).toFixed(1)}万粉 · {account.works} 作品
                    {account.works30d > 0 ? ` · 近30天 ${account.works30d} 条` : ""}
                  </div>
                </div>
                <div className="mx-row-right">
                  <span
                    className={`mx-badge ${
                      account.works30d >= 20 ? "mx-badge-green" : "mx-badge-blue"
                    }`}
                  >
                    {account.works30d >= 20 ? "活跃" : "平稳"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="mx-empty"><p>暂无竞品数据，换关键词试试</p></div>
          )}
        </div>
      </section>
    </div>
  );
}
