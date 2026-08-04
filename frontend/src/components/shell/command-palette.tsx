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
  { cat: "场景", name: "今天 · 待办", icon: "home", tint: "kx-t-violet", href: "/today", kw: "today home 首页 待办" },
  { cat: "场景", name: "AI 助手 · 对话", icon: "messageSq", tint: "kx-t-slate", href: "/agent", kw: "agent ai 助手 对话 聊天" },
  { cat: "客户", name: "找客户（新建获客）", icon: "briefcase", tint: "kx-t-slate", href: "/growth-v2/acquisition", kw: "leads 获客 找客户" },
  { cat: "客户", name: "线索池", icon: "users", tint: "kx-t-slate", href: "/growth-v2/leads", kw: "线索 意向" },
  { cat: "客户", name: "客户管理 CRM", icon: "briefcase", tint: "kx-t-blue", href: "/crm", kw: "crm 客户 档案" },
  { cat: "客户", name: "获客任务", icon: "cpu", tint: "kx-t-slate", href: "/growth-v2/acquisition", kw: "自动获客 任务" },
  { cat: "客户", name: "获客策略", icon: "trending", tint: "kx-t-amber", href: "/growth-v2/strategies", kw: "策略 打法" },
  { cat: "内容", name: "做内容（AI 生成）", icon: "fileText", tint: "kx-t-blue", href: "/content/articles", kw: "写作 ai 生成 图文" },
  { cat: "内容", name: "素材库", icon: "database", tint: "kx-t-slate", href: "/materials", kw: "素材 采集" },
  { cat: "内容", name: "发布", icon: "megaphone", tint: "kx-t-green", href: "/distribution-v2/publish-video", kw: "publish 发布 抖音 小红书" },
  { cat: "消息", name: "AI 客服", icon: "messageSq", tint: "kx-t-slate", href: "/engagement", kw: "客服 回复 确认" },
  { cat: "消息", name: "待我确认", icon: "checkCircle", tint: "kx-t-amber", href: "/tasks/confirmations", kw: "确认 放行 审批" },
  { cat: "消息", name: "抖音评论", icon: "message", tint: "kx-t-slate", href: "/engagement/douyin-comments", kw: "抖音 评论" },
  { cat: "消息", name: "视频号评论", icon: "message", tint: "kx-t-cyan", href: "/engagement/wechat-channel-comments", kw: "视频号 评论" },
  { cat: "消息", name: "微信（会话/群发）", icon: "messageSq", tint: "kx-t-green", href: "/engagement/wechat", kw: "wechat 微信 群发 朋友圈" },
  { cat: "消息", name: "互动记录", icon: "history", tint: "kx-t-slate", href: "/engagement/records", kw: "记录 历史" },
  { cat: "系统", name: "语音控制台", icon: "mic", tint: "kx-t-violet", href: "/admin/voice-agent", kw: "语音 白龙马 bailongma voice 命令" },
  { cat: "系统", name: "平台账号", icon: "phone", tint: "kx-t-blue", href: "/platforms", kw: "账号 登录 绑定" },
  { cat: "系统", name: "用量与费用", icon: "file", tint: "kx-t-amber", href: "/intelligence/costs", kw: "积分 用量 费用 账单" },
  { cat: "系统", name: "设置", icon: "settings", tint: "kx-t-slate", href: "/settings", kw: "settings 设置 ai 模型" },
];

const SCENE_NAME: Record<string, string> = {
  "/today": "今天",
  "/agent": "助手",
  "/customer": "客户",
  "/content": "内容",
  "/message": "消息",
  "/mine": "我的",
};

function sceneOf(href: string) {
  for (const [prefix, name] of Object.entries(SCENE_NAME)) {
    if (href === prefix) return name;
  }
  if (href.startsWith("/growth") || href.startsWith("/crm")) return "客户";
  if (href.startsWith("/content") || href.startsWith("/materials") || href.startsWith("/distribution")) return "内容";
  if (href.startsWith("/engagement") || href.startsWith("/tasks")) return "消息";
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
