"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ShellIcon, type ShellIconName } from "./icons";

type PaletteCommand = {
  cat: string;
  name: string;
  icon: ShellIconName;
  tint: string;
  href: string;
  kw: string;
};

const COMMANDS: PaletteCommand[] = [
  { cat: "今日增长", name: "今日增长 · 首页", icon: "home", tint: "kx-t-violet", href: "/today", kw: "today home 首页 待办 增长 增长首页" },
  { cat: "今日增长", name: "AI 助手 · 对话", icon: "messageSq", tint: "kx-t-slate", href: "/agent", kw: "agent ai 助手 对话 聊天" },
  { cat: "获客中心", name: "获客中心", icon: "target", tint: "kx-t-violet", href: "/growth", kw: "growth 获客 中心 增长总览 工作台" },
  { cat: "获客中心", name: "找客户（新建获客）", icon: "briefcase", tint: "kx-t-slate", href: "/auto-acquisition/create", kw: "leads 获客 找客户 自动获客 新建" },
  { cat: "获客中心", name: "线索池", icon: "users", tint: "kx-t-slate", href: "/growth/leads", kw: "线索 意向 待处理" },
  { cat: "获客中心", name: "获客任务", icon: "cpu", tint: "kx-t-slate", href: "/growth/acquisition", kw: "自动获客 任务 执行" },
  { cat: "获客中心", name: "获客策略", icon: "trending", tint: "kx-t-amber", href: "/growth/strategies", kw: "策略 打法 模板" },
  { cat: "获客中心", name: "评论获客", icon: "megaphone", tint: "kx-t-rose", href: "/engagement/comment-acquisition", kw: "获客 潜客 评论 回复 ai" },
  { cat: "获客中心", name: "情报表", icon: "target", tint: "kx-t-cyan", href: "/intelligence", kw: "情报 中心 市场机会 intelligence" },
  { cat: "获客中心", name: "行业情报", icon: "target", tint: "kx-t-amber", href: "/intelligence/industries", kw: "行业 情报 趋势" },
  { cat: "获客中心", name: "趋势雷达", icon: "trending", tint: "kx-t-amber", href: "/intelligence/trends", kw: "趋势 雷达 热点" },
  { cat: "获客中心", name: "自动监控", icon: "bell", tint: "kx-t-slate", href: "/intelligence/monitors", kw: "监控 自动 预警" },
  { cat: "获客中心", name: "报告中心", icon: "chart", tint: "kx-t-cyan", href: "/intelligence/reports", kw: "报告 情报 分析 复盘" },
  { cat: "获客中心", name: "增长工作流", icon: "cpu", tint: "kx-t-violet", href: "/growth/workflows", kw: "增长 工作流 自动获客 编排" },
  { cat: "获客中心", name: "账号健康", icon: "bulb", tint: "kx-t-amber", href: "/growth/account-health", kw: "账号 健康 状态 异常 封号" },
  { cat: "客户管理", name: "客户管理 CRM", icon: "briefcase", tint: "kx-t-blue", href: "/crm", kw: "crm 客户 档案 商机" },
  { cat: "客户管理", name: "企业微信 CRM", icon: "briefcase", tint: "kx-t-green", href: "/wecom-crm", kw: "企微 crm 企业微信" },
  { cat: "客户管理", name: "BOSS 招聘", icon: "briefcase", tint: "kx-t-blue", href: "/boss-recruit", kw: "boss 招聘 线索 岗位" },
  { cat: "内容运营", name: "做内容（AI 生成）", icon: "fileText", tint: "kx-t-blue", href: "/content/articles", kw: "写作 ai 生成 图文" },
  { cat: "内容运营", name: "小红书笔记", icon: "fileText", tint: "kx-t-rose", href: "/content/xiaohongshu", kw: "小红书 笔记 草稿" },
  { cat: "内容运营", name: "素材库", icon: "database", tint: "kx-t-slate", href: "/materials", kw: "素材 采集" },
  { cat: "内容运营", name: "视频去水印", icon: "download", tint: "kx-t-blue", href: "/materials?open=download", kw: "去水印 下载 无水印 抖音 快手 小红书" },
  { cat: "内容运营", name: "AI 生图", icon: "sparkles", tint: "kx-t-violet", href: "/content/ai-image-gen", kw: "生图 图片 绘图 image 文生图" },
  { cat: "内容运营", name: "全网采集", icon: "database", tint: "kx-t-blue", href: "/content/collection-center", kw: "采集 全网 搜作品 账号 素材" },
  { cat: "内容运营", name: "爆款拆解", icon: "trending", tint: "kx-t-amber", href: "/viral-analysis", kw: "爆款 拆解 仿写 对标 viral" },
  { cat: "内容运营", name: "知识库", icon: "database", tint: "kx-t-amber", href: "/knowledge-base", kw: "知识库 品牌 素材" },
  { cat: "内容运营", name: "样式库", icon: "layers", tint: "kx-t-slate", href: "/styles", kw: "样式 风格 模板 高级 风格库" },
  { cat: "内容运营", name: "发布", icon: "megaphone", tint: "kx-t-green", href: "/distribution/publish-video", kw: "publish 发布 抖音 小红书" },
  { cat: "互动中心", name: "AI 客服", icon: "messageSq", tint: "kx-t-slate", href: "/engagement", kw: "客服 回复 确认" },
  { cat: "互动中心", name: "待我确认", icon: "checkCircle", tint: "kx-t-amber", href: "/tasks/confirmations", kw: "确认 放行 审批" },
  { cat: "互动中心", name: "抖音评论", icon: "message", tint: "kx-t-slate", href: "/engagement/douyin-comments", kw: "抖音 评论" },
  { cat: "互动中心", name: "视频号评论", icon: "message", tint: "kx-t-cyan", href: "/engagement/wechat-channel-comments", kw: "视频号 评论" },
  { cat: "互动中心", name: "微信（会话/群发）", icon: "messageSq", tint: "kx-t-green", href: "/engagement/wechat", kw: "wechat 微信 群发 朋友圈" },
  { cat: "互动中心", name: "互动记录", icon: "history", tint: "kx-t-slate", href: "/engagement/records", kw: "记录 历史" },
  { cat: "互动中心", name: "会话记录", icon: "history", tint: "kx-t-blue", href: "/tasks/runs", kw: "会话 记录 run" },
  { cat: "执行中心", name: "执行中心 · 任务", icon: "cpu", tint: "kx-t-violet", href: "/tasks", kw: "tasks 执行 记录 任务中心" },
  { cat: "执行中心", name: "审批中心", icon: "alert", tint: "kx-t-red", href: "/approvals", kw: "审批 高风险 批量 触达 私信" },
  { cat: "执行中心", name: "结果留存", icon: "history", tint: "kx-t-slate", href: "/task-evidence", kw: "结果 留存 证据 evidence 任务" },
  { cat: "执行中心", name: "任务工作台", icon: "cpu", tint: "kx-t-blue", href: "/agent-workbench", kw: "任务 工作台 agent-workbench 失败重试" },
  { cat: "系统设置", name: "平台账号", icon: "phone", tint: "kx-t-blue", href: "/platforms", kw: "账号 登录 绑定" },
  { cat: "系统设置", name: "多账号矩阵", icon: "database", tint: "kx-t-green", href: "/accounts-matrix", kw: "多账号 矩阵 账号 分发" },
  { cat: "系统设置", name: "本地引擎", icon: "cpu", tint: "kx-t-slate", href: "/local-engine", kw: "local engine 本地 引擎 设备" },
  { cat: "系统设置", name: "商业就绪", icon: "rocket", tint: "kx-t-amber", href: "/commercial-readiness", kw: "商业 就绪 自检 上线 readiness" },
  { cat: "系统设置", name: "用量与费用", icon: "file", tint: "kx-t-amber", href: "/intelligence/costs", kw: "积分 用量 费用 账单" },
  { cat: "系统设置", name: "设置", icon: "settings", tint: "kx-t-slate", href: "/settings", kw: "settings 设置 ai 模型" },
  { cat: "系统设置", name: "省钱返利", icon: "wallet", tint: "kx-t-green", href: "/savings", kw: "省钱 返利 美团 特惠 优惠" },
];

const SCENE_NAME: Record<string, string> = {
  "/today": "今日增长",
  "/agent": "助手",
  "/growth": "获客中心",
  "/growth/leads": "线索",
  "/crm": "客户管理",
  "/content": "内容运营",
  "/message": "互动中心",
  "/tasks": "执行中心",
  "/settings": "系统设置",
  "/mine": "我的",
};

function sceneOf(href: string) {
  for (const [prefix, name] of Object.entries(SCENE_NAME)) {
    if (href === prefix) return name;
  }
  if (href.startsWith("/growth") || href.startsWith("/intelligence") || href.startsWith("/engagement/comment-acquisition") || href.startsWith("/effects")) return "获客中心";
  if (href.startsWith("/crm") || href.startsWith("/customer") || href.startsWith("/boss-recruit") || href.startsWith("/wecom-crm")) return "客户管理";
  if (href.startsWith("/content") || href.startsWith("/materials") || href.startsWith("/distribution") || href.startsWith("/viral-analysis") || href.startsWith("/redfox-skills") || href.startsWith("/topics") || href.startsWith("/schedules") || href.startsWith("/knowledge-base") || href.startsWith("/styles")) return "内容运营";
  if (href.startsWith("/engagement") || href.startsWith("/message")) return "互动中心";
  if (href.startsWith("/tasks") || href.startsWith("/approvals") || href.startsWith("/task-evidence") || href.startsWith("/agent-workbench") || href.startsWith("/rpa-workbench")) return "执行中心";
  if (href.startsWith("/settings") || href.startsWith("/platforms") || href.startsWith("/local-engine") || href.startsWith("/capabilities")) return "系统设置";
  return "我的";
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) =>
      `${c.name} ${c.kw} ${c.cat}`.toLowerCase().includes(q),
    );
  }, [query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  React.useEffect(() => setSel(0), [query]);

  const exec = React.useCallback(
    (cmd?: PaletteCommand) => {
      if (!cmd) return;
      onClose();
      router.push(cmd.href);
    },
    [onClose, router],
  );

  if (!open) return null;

  let lastCat = "";

  return (
    <div
      className="kx-palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kx-palette" role="dialog" aria-label="命令面板">
        <div className="kx-palette-input-row">
          <ShellIcon name="search" />
          <input
            ref={inputRef}
            className="kx-palette-input"
            placeholder="搜索功能，或直接说你想做什么…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                exec(filtered[sel]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
          />
          <span className="kx-kbd">esc</span>
        </div>
        <div className="kx-palette-list">
          {filtered.length === 0 ? (
            <div className="kx-palette-empty">没有找到相关功能，换个说法试试</div>
          ) : (
            filtered.map((c, i) => {
              const showCat = c.cat !== lastCat;
              lastCat = c.cat;
              return (
                <React.Fragment key={c.name}>
                  {showCat ? <div className="kx-palette-cat">{c.cat}</div> : null}
                  <div
                    className={`kx-palette-item${i === sel ? " kx-sel" : ""}`}
                    onClick={() => exec(c)}
                    onMouseMove={() => sel !== i && setSel(i)}
                  >
                    <div className={`kx-p-ico ${c.tint}`}>
                      <ShellIcon name={c.icon} size={17} />
                    </div>
                    <span className="kx-p-name">{c.name}</span>
                    <span className="kx-p-to">{sceneOf(c.href)} →</span>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>
        <div className="kx-palette-foot">
          <span>
            <span className="kx-kbd">↑↓</span> 选择
          </span>
          <span>
            <span className="kx-kbd">↵</span> 打开
          </span>
          <span>
            <span className="kx-kbd">esc</span> 关闭
          </span>
          <span style={{ marginLeft: "auto" }}>输入中文或英文都可以</span>
        </div>
      </div>
    </div>
  );
}
