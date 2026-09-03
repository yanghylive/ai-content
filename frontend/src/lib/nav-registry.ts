/**
 * 导航注册表（2026-08-26 导航复核修复）
 *
 * 「互动中心」渠道与「我的」页面入口的唯一数据源：
 * 桌面 ScenePage cards、移动端首屏菜单、移动端「更多」菜单均由此派生，
 * 禁止在页面里再各自维护一份 href 列表（防止桌面/移动漂移）。
 *
 * 桌面一级导航 SCENES 与移动端 MOBILE_TABS 集合本就不同，
 * 仍声明在 shell 内部，受 navigation-zero-loss 快照保护。
 */
import type { ShellIconName } from "@/components/shell/icons";

/* ──────────────── 互动中心渠道（桌面卡片 + 移动列表同源） ──────────────── */

export type InteractionChannelEntry = {
  key: string;
  /** 桌面卡片标题 / 移动端行标题 */
  title: string;
  /** 桌面卡片描述 */
  desc: string;
  /** 移动端副标题 */
  sub: string;
  href: string;
  icon: ShellIconName;
  /** 桌面色调类（kx-t-*） */
  tint: string;
  /** 移动端品牌色（css color） */
  brand: string;
};

export const INTERACTION_CHANNELS: InteractionChannelEntry[] = [
  { key: "inbox", title: "统一收件箱", desc: "评论、私信、转人工，集中查看与回复", sub: "集中查看与回复", href: "/engagement", icon: "inboxTray", tint: "kx-t-violet", brand: "var(--kaypal-v3-accent)" },
  { key: "ai-service", title: "客服机器人", desc: "配置机器人风格与回复规则", sub: "配置机器人", href: "/engagement?tab=bot", icon: "botHead", tint: "kx-t-slate", brand: "var(--kaypal-v3-accent)" },
  { key: "douyin-messages", title: "抖音私信", desc: "私信和评论，读取真实的回复给你确认", sub: "读取真实回复", href: "/engagement/douyin-messages", icon: "chat", tint: "kx-t-slate", brand: "#fe2c55" },
  { key: "channel-messages", title: "视频号私信", desc: "私信和评论", sub: "私信和评论", href: "/engagement/channel-messages", icon: "channelCircle", tint: "kx-t-cyan", brand: "#007fff" },
  { key: "wechat", title: "微信", desc: "会话、加好友", sub: "会话 · 加好友", href: "/engagement/wechat", icon: "wechatBubble", tint: "kx-t-green", brand: "#07c160" },
  { key: "wecom-assistant", title: "企微助手", desc: "企业微信客户智能回复助手", sub: "企微智能回复", href: "/engagement/wecom-assistant", icon: "wecomBubble", tint: "kx-t-green", brand: "#07c160" },
  { key: "reply", title: "AI 回复建议", desc: "AI 生成回复建议，确认后快速发出", sub: "AI 回复建议", href: "/reply", icon: "replySq", tint: "kx-t-violet", brand: "var(--kaypal-v3-accent)" },
  { key: "records", title: "互动记录", desc: "所有发出过的回复，可追溯", sub: "所有回复可追溯", href: "/engagement/records", icon: "recordList", tint: "kx-t-slate", brand: "#76517e" },
  { key: "wechat-plans", title: "群发计划", desc: "群发任务管理：暂停、继续、重试", sub: "群发任务管理", href: "/engagement/wechat/plans", icon: "groupSend", tint: "kx-t-amber", brand: "var(--kaypal-v3-amber)" },
];

/* ──────────────── 「我的」页面入口 ──────────────── */

export type MineNavEntry = {
  key: string;
  title: string;
  desc: string;
  href: string;
  icon: ShellIconName;
  /** 桌面色调类（kx-t-*）；仅桌面入口需要 */
  tint?: string;
  /** 桌面分组名；缺省表示不出现在桌面卡片 */
  group?: string;
  /** 桌面卡片排序（同组内升序） */
  desktopOrder?: number;
  /** 移动端行着色（css color） */
  mobileTint?: string;
  /** 出现在移动端首屏菜单 */
  mobileTop?: boolean;
  /** 出现在移动端「更多」菜单的分组名 */
  mobileGroup?: string;
  /** 仅管理员可见 */
  adminOnly?: boolean;
};

export const MINE_NAV_ENTRIES: MineNavEntry[] = [
  // 桌面「我的」卡片（desktopOrder 保持既有视觉顺序）
  { key: "platforms", title: "平台账号", desc: "抖音、小红书等账号的登录状态", href: "/distribution/accounts", icon: "phone", tint: "kx-t-green", group: "账号与设置", desktopOrder: 1 },
  { key: "matrix", title: "多账号矩阵", desc: "各平台账号 · 多选分发", href: "/accounts-matrix", icon: "database", tint: "kx-t-green", group: "账号与设置", desktopOrder: 2, mobileTint: "var(--kaypal-v3-success)", mobileTop: true },
  { key: "team", title: "账号与团队", desc: "个人资料、成员权限、版本更新", href: "/capabilities/account", icon: "users", tint: "kx-t-rose", group: "账号与设置", desktopOrder: 3, mobileTint: "var(--kaypal-v3-purple)", mobileTop: true },
  { key: "settings-account", title: "账号与安全", desc: "个人资料、登录密码", href: "/settings/account", icon: "user", tint: "kx-t-rose", group: "设置", desktopOrder: 2, mobileTint: "var(--kaypal-v3-purple)", mobileGroup: "更多能力" },
  { key: "settings-notifications", title: "通知设置", desc: "什么时候提醒你", href: "/settings/notifications", icon: "bell", tint: "kx-t-blue", group: "设置", desktopOrder: 3, mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "更多能力" },
  { key: "settings-appearance", title: "显示设置", desc: "文字大小（本机保存）", href: "/settings/appearance", icon: "sun", tint: "kx-t-amber", group: "设置", desktopOrder: 4, mobileTint: "var(--kaypal-v3-amber)", mobileGroup: "更多能力" },
  { key: "settings-integrations", title: "文件存储", desc: "生成的图片、视频存在哪里", href: "/settings/integrations", icon: "database", tint: "kx-t-cyan", group: "设置", desktopOrder: 5, mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "更多能力" },
  { key: "settings-desktop", title: "桌面设置", desc: "本机应用选项", href: "/settings/desktop", icon: "cpu", tint: "kx-t-slate", group: "设置", desktopOrder: 6, mobileTint: "var(--kaypal-v3-muted)", mobileGroup: "更多能力" },
  { key: "settings-data", title: "数据管理", desc: "导出和备份你的数据", href: "/settings/data", icon: "download", tint: "kx-t-cyan", group: "设置", desktopOrder: 7, mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "更多能力" },
  { key: "settings-legal", title: "合规中心", desc: "协议、隐私、AI 说明", href: "/settings/legal", icon: "fileText", tint: "kx-t-slate", group: "设置", desktopOrder: 8, mobileTint: "var(--kaypal-v3-muted)", mobileGroup: "更多能力" },
  { key: "memory", title: "记忆设置", desc: "长期记忆、画像与偏好", href: "/settings/memory", icon: "layers", tint: "kx-t-blue", group: "账号与设置", desktopOrder: 5, mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "更多能力" },
  { key: "costs", title: "数据用量", desc: "数据服务用量与调用明细", href: "/intelligence/costs", icon: "file", tint: "kx-t-cyan", group: "系统与服务", desktopOrder: 14, mobileTint: "#a9671f", mobileGroup: "系统与情报" },
  { key: "local-service", title: "电脑本机服务", desc: "电脑端引擎、微信桌面、运行检查", href: "/local-engine", icon: "cpu", tint: "kx-t-amber", group: "系统与服务", desktopOrder: 7 },
  { key: "evidence", title: "任务证据", desc: "执行证据与留痕", href: "/tasks/evidence", icon: "checkCircle", tint: "kx-t-green", group: "系统与服务", desktopOrder: 10, mobileTint: "var(--kaypal-v3-success)", mobileGroup: "更多能力" },
  { key: "engine-permissions", title: "引擎权限", desc: "本地引擎权限管理", href: "/local-engine/permissions", icon: "clipboard", tint: "kx-t-slate", group: "系统与服务", desktopOrder: 11, mobileTint: "var(--kaypal-v3-muted)", mobileGroup: "更多能力" },
  { key: "artifacts", title: "AI 工件", desc: "AI 生成的工件产物", href: "/artifacts", icon: "archive", tint: "kx-t-slate", group: "系统与服务", desktopOrder: 12, mobileTint: "var(--kaypal-v3-muted)", mobileGroup: "更多能力" },
  { key: "redfox-admin", title: "数据服务管理", desc: "数据源连接与配额配置", href: "/intelligence/redfox", icon: "settings", tint: "kx-t-slate", group: "系统与服务", desktopOrder: 13, mobileTint: "var(--kaypal-v3-muted)", mobileGroup: "更多能力", adminOnly: true },
  { key: "commercial-readiness", title: "商业就绪", desc: "上线能力自检", href: "/commercial-readiness", icon: "rocket", tint: "kx-t-amber", group: "系统与服务", desktopOrder: 16, mobileTint: "#c2410c", mobileGroup: "系统与情报" },
  { key: "case-admin", title: "案例管理", desc: "客户案例后台维护", href: "/case-admin", icon: "clipboard", tint: "kx-t-blue", group: "系统与服务", desktopOrder: 17, adminOnly: true },

  // 移动端首屏专属（顺序即展示顺序）
  { key: "customer-entry", title: "客户管理", desc: "客户列表与跟进", href: "/crm", icon: "users", mobileTint: "var(--kaypal-v3-cobalt)", mobileTop: true },
  { key: "mobile-capabilities", title: "手机端能力", desc: "手机能做什么 · 边界说明", href: "/mobile-capabilities", icon: "phone", mobileTint: "var(--kaypal-v3-cobalt)", mobileTop: true },

  // 移动端「更多」菜单专属
  { key: "wecom-crm", title: "企业微信 CRM", desc: "企微客户与跟进", href: "/wecom-crm", icon: "briefcase", mobileTint: "var(--kaypal-v3-success)", mobileGroup: "客户与增长" },
  { key: "boss-recruit-m", title: "BOSS 招聘", desc: "招聘线索与跟进", href: "/boss-recruit", icon: "target", mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "客户与增长" },
  { key: "growth-reports", title: "增长报告", desc: "获客效果汇总", href: "/growth/reports", icon: "chart", mobileTint: "#2e7d32", mobileGroup: "客户与增长" },
  { key: "growth-workflows", title: "增长工作流", desc: "自动获客流程编排", href: "/growth/workflows", icon: "cpu", mobileTint: "var(--kaypal-v3-purple)", mobileGroup: "客户与增长" },
  { key: "account-health", title: "账号健康", desc: "账号状态与健康度", href: "/growth/account-health", icon: "bulb", mobileTint: "var(--kaypal-v3-amber)", mobileGroup: "客户与增长" },
  { key: "intel-monitors", title: "情报监控", desc: "行业情报实时监控", href: "/intelligence/monitors", icon: "target", mobileTint: "var(--kaypal-v3-purple)", mobileGroup: "系统与情报" },
  { key: "commercial-readiness", title: "商业就绪", desc: "上线能力自检", href: "/commercial-readiness", icon: "rocket", mobileTint: "#c2410c", mobileGroup: "系统与情报" },
  { key: "compliance", title: "发布前检查", desc: "内容合规校验", href: "/compliance", icon: "checkCircle", mobileTint: "var(--kaypal-v3-success)", mobileGroup: "系统与情报" },
  { key: "trends-radar", title: "趋势雷达", desc: "行业趋势实时雷达", href: "/intelligence/trends", icon: "target", mobileTint: "var(--kaypal-v3-amber)", mobileGroup: "系统与情报" },
  { key: "intel-report-new", title: "情报报告", desc: "情报分析与报告", href: "/intelligence/report-new", icon: "chart", mobileTint: "var(--kaypal-v3-cobalt)", mobileGroup: "系统与情报" },
];

/** 移动端「更多」菜单分组顺序 */
export const MOBILE_MORE_GROUP_ORDER = ["客户与增长", "系统与情报", "更多能力"] as const;

/** 桌面「我的」可见条目（按 desktopOrder 稳定排序，admin 门控在此收口） */
export function visibleMineEntries(isAdmin: boolean): Array<MineNavEntry & { group: string }> {
  return MINE_NAV_ENTRIES.filter(
    (e): e is MineNavEntry & { group: string } =>
      typeof e.group === "string" && (!e.adminOnly || isAdmin),
  ).sort((a, b) => (a.desktopOrder ?? 99) - (b.desktopOrder ?? 99));
}
