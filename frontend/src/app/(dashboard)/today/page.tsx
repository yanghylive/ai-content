"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ShellIcon } from "@/components/shell/icons";
import { Ticker, type TickerItem } from "@/components/shell/tickers";
import { useShellUser } from "@/components/shell/app-shell";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { autoUploadApi, type AutoUploadPublishTask } from "@/lib/api/auto-upload";
import { growthApi } from "@/lib/api/growth";
import { materialsApi } from "@/lib/api/materials";
import { api } from "@/lib/api/client";

type IntelItem = {
  id: string;
  title?: string;
  platform?: string;
  sourceName?: string;
  publishedAt?: string | number;
  createdAt?: string | number;
};

const PLATFORM_TAG: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信",
  shipinhao: "视频号",
  channels: "视频号",
  gongzhonghao: "公众号",
  zhihu: "知乎",
  weibo: "微博",
  toutiao: "头条",
};
interface HotTopic {
  title: string;
  platform: string;
  heat?: string;
  url?: string;
}

const TAG_TINTS = ["kx-t-rose", "kx-t-amber", "kx-t-blue", "kx-t-cyan"];

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

function relTime(value: unknown): string {
  let ms: number;
  if (typeof value === "number") ms = value > 1e12 ? value : value * 1000;
  else {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isNaN(parsed)) return "";
    ms = parsed;
  }
  const diff = Date.now() - ms;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
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

  React.useEffect(() => {
    let active = true;
    (async () => {
      const [tasks, pubTasks, overview, collect, intel] = await Promise.all([
        localEngineApi.tasks(50).catch(() => [] as InteractionTask[]),
        autoUploadApi.tasks(50).catch(() => [] as AutoUploadPublishTask[]),
        growthApi.overview().catch(() => null),
        materialsApi.collectStatus().catch(() => null),
        api
          .get<{ items?: HotTopic[] }>("/redfox/hot-topics")
          .catch(() => null),
      ]);
      if (!active) return;

      const taskList = Array.isArray(tasks) ? tasks : [];
      const pubList = Array.isArray(pubTasks) ? pubTasks : [];

      setWaitingCount(
        taskList.filter((t) => t.status === "waiting_for_send_confirmation")
          .length,
      );
      const failed = pubList.filter((t) => t.status === "failed");
      setFailedPublish(failed);

      const ov = overview as {
        todayLeadCount?: number;
        highIntentLeadCount?: number;
      } | null;
      setLeadCount(ov?.todayLeadCount ?? 0);
      setHighIntent(ov?.highIntentLeadCount ?? 0);

      setPublishedToday(
        pubList.filter(
          (t) => t.status === "completed" && isToday(t.created_at),
        ).length,
      );

      const counts = (collect as { counts?: Record<string, number> } | null)
        ?.counts;
      setMaterialCount(counts?.total ?? counts?.new ?? 0);

      const done: string[] = [];
      pubList
        .filter((t) => t.status === "completed" && isToday(t.created_at))
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
      href: "/distribution-v2/tasks",
    });
  }
  if (leadCount > 0) {
    todos.push({
      key: "leads",
      tint: "kx-t-blue",
      icon: "target",
      title: `${leadCount} 条新的客户线索`,
      desc: `获客任务抓到的${highIntent > 0 ? `，${highIntent} 条高意向` : ""}`,
      btn: "去看看",
      href: "/growth-v2/leads",
    });
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
        <Ticker
          label="行业动态"
          icon="rss"
          items={newsItems}
          speed={60}
          labelColor="var(--kx-cb-fg)"
          style={{ marginTop: 16 }}
        />
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
          <div className="kx-action-ico kx-t-rose">
            <ShellIcon name="target" size={22} />
          </div>
          <div className="kx-action-title">找客户</div>
          <div className="kx-action-desc">告诉系统你的客户是谁，它自动帮你找</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/content")}>
          <div className="kx-action-ico kx-t-blue">
            <ShellIcon name="pen" size={22} />
          </div>
          <div className="kx-action-title">做内容</div>
          <div className="kx-action-desc">AI 帮你写图文、剪视频、做小红书</div>
        </button>
        <button className="kx-action-card" onClick={() => router.push("/content")}>
          <div className="kx-action-ico kx-t-violet">
            <ShellIcon name="rocket" size={22} />
          </div>
          <div className="kx-action-title">发出去</div>
          <div className="kx-action-desc">一键发到抖音、小红书、视频号</div>
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
