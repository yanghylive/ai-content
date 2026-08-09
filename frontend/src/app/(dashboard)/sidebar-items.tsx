import {
  SidebarItemType,
  type SidebarItem,
} from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";
import {
  BellRing,
  Bot,
  Box,
  Blocks,
  Bug,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  Database,
  FileText,
  Flame,
  Globe2,
  Home,
  Inbox,
  Library,
  Lightbulb,
  MessageCircle,
  MessagesSquare,
  Send,
  Camera,
  BriefcaseBusiness,
  Newspaper,
  PackageOpen,
  PenLine,
  Plug,
  Radar,
  Radio,
  Route,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Target,
  UsersRound,
  Video,
  WandSparkles,
  BarChart3,
  Wallet,
} from "lucide-react";

const baseSectionItems: SidebarItem[] = [
  {
    key: "today",
    href: "/",
    title: "今日工作台",
    icon: Home,
    items: [
      {
        key: "/solutions",
        href: "/solutions",
        icon: Blocks,
        title: "开始任务",
      },
    ],
  },
  {
    key: "tasks",
    href: "/tasks",
    title: "任务中心",
    icon: Bot,
    items: [
      {
        key: "/tasks",
        href: "/tasks",
        icon: Bot,
        title: "任务总览",
      },
      {
        key: "/tasks/confirmations",
        href: "/tasks/confirmations",
        icon: ClipboardList,
        title: "待我确认",
      },
      {
        key: "/tasks/runs",
        href: "/tasks/runs",
        icon: Route,
        title: "正在运行",
      },
      {
        key: "/tasks/records",
        href: "/tasks/records",
        icon: FileText,
        title: "任务历史",
      },
      {
        key: "/tasks/evidence",
        href: "/tasks/evidence",
        icon: ShieldCheck,
        title: "结果留存",
      },
      {
        key: "/tasks/schedules",
        href: "/tasks/schedules",
        icon: BellRing,
        title: "计划任务",
      },
    ],
  },
  {
    key: "intelligence",
    href: "/intelligence",
    title: "AI 运营增长",
    icon: Radar,
    items: [
      {
        key: "/intelligence",
        href: "/intelligence",
        icon: Radar,
        title: "商业价值总控台",
      },
      {
        key: "intelligence-insight",
        icon: Search,
        title: "洞察",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/intelligence/search",
            href: "/intelligence/search",
            icon: Search,
            title: "AI 情报搜索",
          },
          {
            key: "/intelligence/trends",
            href: "/intelligence/trends",
            icon: Flame,
            title: "机会趋势雷达",
          },
          {
            key: "/intelligence/industries",
            href: "/intelligence/industries",
            icon: Globe2,
            title: "行业增长驾驶舱",
          },
          {
            key: "/intelligence/viral",
            href: "/intelligence/viral",
            icon: Sparkles,
            title: "爆款拆解实验室",
          },
        ],
      },
      {
        key: "intelligence-execute",
        icon: Target,
        title: "执行",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/intelligence/inbox",
            href: "/intelligence/inbox",
            icon: Inbox,
            title: "智能收件箱",
          },
          {
            key: "/intelligence/collaboration",
            href: "/intelligence/collaboration",
            icon: ClipboardList,
            title: "协作复核室",
          },
          {
            key: "/intelligence/leads",
            href: "/intelligence/leads",
            icon: Target,
            title: "高优商机池",
          },
          {
            key: "/intelligence/reports",
            href: "/intelligence/reports",
            icon: FileText,
            title: "经营报告中心",
          },
        ],
      },
      {
        key: "intelligence-governance",
        icon: ShieldCheck,
        title: "管控",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/intelligence/monitors",
            href: "/intelligence/monitors",
            icon: BellRing,
            title: "自动监控中心",
          },
          {
            key: "/intelligence/risks",
            href: "/intelligence/risks",
            icon: ShieldCheck,
            title: "风险审核中心",
          },
          {
            key: "/intelligence/rules",
            href: "/intelligence/rules",
            icon: SlidersHorizontal,
            title: "规则种子库",
          },
        ],
      },
      {
        key: "intelligence-assets",
        icon: Database,
        title: "资产",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/intelligence/accounts",
            href: "/intelligence/accounts",
            icon: UsersRound,
            title: "对标资产库",
          },
          {
            key: "/intelligence/skills",
            href: "/intelligence/skills",
            icon: Sparkles,
            title: "AI 能力目录",
          },
          {
            key: "/intelligence/redfox",
            href: "/intelligence/redfox",
            icon: Database,
            title: "数据连接健康",
          },
          {
            key: "/intelligence/costs",
            href: "/intelligence/costs",
            icon: CircleDollarSign,
            title: "ROI 成本账单",
          },
        ],
      },
    ],
  },
  {
    key: "content-ops",
    href: "/content/articles",
    title: "内容运营",
    icon: PenLine,
    items: [
      {
        key: "/content/workspace",
        href: "/content/workspace",
        icon: Blocks,
        title: "内容工作室",
      },
      {
        key: "/content/topics",
        href: "/content/topics",
        icon: Lightbulb,
        title: "选题库",
      },
      {
        key: "/content/strategies",
        href: "/content/strategies",
        icon: Target,
        title: "内容策略",
      },
      {
        key: "/content/articles",
        href: "/content/articles",
        icon: FileText,
        title: "内容生成",
      },
      {
        key: "/content/xiaohongshu",
        href: "/content/xiaohongshu",
        icon: MessageCircle,
        title: "小红书笔记",
      },
      {
        key: "/content/xiaohongshu-assistant",
        href: "/content/xiaohongshu-assistant",
        icon: WandSparkles,
        title: "小红书运营助理",
      },
      {
        key: "/content/wechat-official-assistant",
        href: "/content/wechat-official-assistant",
        icon: Newspaper,
        title: "公众号运营助理",
      },
      {
        key: "/content/optimization",
        href: "/content/optimization",
        icon: Sparkles,
        title: "内容改写",
      },
    ],
  },
  {
    key: "brand-assets",
    href: "/content",
    title: "素材与品牌",
    icon: PackageOpen,
    items: [
      {
        key: "/content",
        href: "/content",
        icon: Box,
        title: "素材库",
      },
      {
        key: "/content/templates",
        href: "/content/templates",
        icon: Blocks,
        title: "模板库",
      },
      {
        key: "/content/styles",
        href: "/content/styles",
        icon: PenLine,
        title: "品牌风格",
      },
      {
        key: "/content/knowledge",
        href: "/content/knowledge",
        icon: Library,
        title: "知识库",
      },
    ],
  },
  {
    key: "distribution",
    href: "/distribution",
    title: "发布中心",
    icon: Store,
    items: [
      {
        key: "/distribution",
        href: "/distribution",
        icon: Store,
        title: "发布记录",
      },
      {
        key: "/distribution?tab=article",
        href: "/distribution-v2/publish-article",
        icon: PenLine,
        title: "图文发布",
      },
      {
        key: "/distribution?tab=video",
        href: "/distribution-v2/publish-video",
        icon: Video,
        title: "视频发布",
      },
      {
        key: "/distribution?tab=materials",
        href: "/materials",
        icon: Box,
        title: "发布素材",
      },
      {
        key: "/effects",
        href: "/effects",
        icon: BarChart3,
        title: "效果报告",
      },
      {
        key: "/savings",
        href: "/savings",
        icon: Wallet,
        title: "省钱返利",
      },
      {
        key: "/admin/savings",
        href: "/admin/savings",
        icon: ShieldCheck,
        title: "返利管理",
      },
      {
        key: "/distribution?tab=accounts",
        href: "/platforms",
        icon: UsersRound,
        title: "平台账号",
      },
      {
        key: "/distribution?tab=compliance",
        href: "/compliance-check-v2",
        icon: ShieldCheck,
        title: "发布前检查",
      },
      {
        key: "/distribution?tab=tasks",
        href: "/distribution-v2/tasks",
        icon: Route,
        title: "发布任务",
      },
      {
        key: "/distribution?tab=logs",
        href: "/local-engine-v2/logs",
        icon: Bug,
        title: "发布结果",
      },
    ],
  },
  {
    key: "growth",
    href: "/growth",
    title: "增长获客",
    icon: Target,
    items: [
      {
        key: "/growth",
        href: "/growth",
        icon: ChartNoAxesCombined,
        title: "增长控制台",
      },
      {
        key: "/growth?view=strategies",
        href: "/growth-v2/strategies",
        icon: ClipboardList,
        title: "获客策略",
      },
      {
        key: "/growth?view=leads",
        href: "/growth-v2/leads",
        icon: UsersRound,
        title: "线索池",
      },
      {
        key: "/growth?view=acquisition",
        href: "/growth-v2/acquisition",
        icon: Target,
        title: "获客任务",
      },
      {
        key: "/apps/auto-acquisition",
        href: "/apps/auto-acquisition",
        icon: MessageCircle,
        title: "短视频评论获客",
      },
      {
        key: "/growth?view=workflows",
        href: "/growth-v2/workflows",
        icon: Route,
        title: "增长工作流",
      },
      {
        key: "/growth?view=account-health",
        href: "/growth-v2/account-health",
        icon: ShieldCheck,
        title: "账号健康",
      },
      {
        key: "/growth?view=reports",
        href: "/growth-v2/reports",
        icon: ChartNoAxesCombined,
        title: "增长复盘",
      },
    ],
  },
  {
    key: "engagement",
    href: "/engagement",
    title: "客户互动",
    icon: MessagesSquare,
    items: [
      {
        key: "/engagement",
        href: "/engagement",
        icon: Inbox,
        title: "统一收件箱",
      },
      {
        key: "engagement-channels",
        icon: MessageCircle,
        title: "平台互动",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/engagement/douyin-messages",
            href: "/engagement/douyin-messages",
            icon: MessagesSquare,
            title: "抖音私信",
          },
          {
            key: "/engagement/douyin-comments",
            href: "/engagement/douyin-comments",
            icon: MessageCircle,
            title: "抖音评论",
          },
          {
            key: "/engagement/channel-messages",
            href: "/engagement/channel-messages",
            icon: MessagesSquare,
            title: "视频号私信",
          },
          {
            key: "/engagement/wechat-channel-comments",
            href: "/engagement/wechat-channel-comments",
            icon: MessageCircle,
            title: "视频号评论",
          },
          {
            key: "/engagement/wechat",
            href: "/engagement/wechat",
            icon: MessageCircle,
            title: "微信会话",
          },
        ],
      },
      {
        key: "engagement-rules",
        icon: SlidersHorizontal,
        title: "客户与规则",
        type: SidebarItemType.Nest,
        items: [
          {
            key: "/engagement/customers",
            href: "/engagement/customers",
            icon: UsersRound,
            title: "客户档案",
          },
          {
            key: "/engagement/comment-insights",
            href: "/engagement/comment-insights",
            icon: MessageCircle,
            title: "评论线索",
          },
          {
            key: "/engagement/wecom-assistant",
            href: "/engagement/wecom-assistant",
            icon: Bot,
            title: "企微助手",
          },
          {
            key: "/engagement/rules",
            href: "/engagement/rules",
            icon: SlidersHorizontal,
            title: "回复规则",
          },
          {
            key: "/engagement/records",
            href: "/engagement/records",
            icon: ClipboardList,
            title: "互动记录",
          },
        ],
      },
    ],
  },
  {
    key: "system",
    href: "/apps",
    title: "应用与系统",
    icon: Settings,
    items: [
      {
        key: "/apps",
        href: "/apps",
        icon: Store,
        title: "应用与安装",
      },
      {
        key: "/capabilities/account",
        href: "/capabilities/account",
        icon: UsersRound,
        title: "账号与设备",
      },
      {
        key: "/platforms",
        href: "/admin/connectors",
        icon: Plug,
        title: "平台授权",
      },
      {
        key: "/capabilities/models",
        href: "/capabilities/models",
        icon: Sparkles,
        title: "模型与工具",
      },
      {
        key: "/voice-agent",
        href: "/voice-agent",
        icon: Radio,
        title: "语音助手",
      },
      {
        key: "/local-engine",
        href: "/local-engine",
        icon: Bot,
        title: "设备状态",
      },
      {
        key: "/capabilities/risk",
        href: "/capabilities/risk",
        icon: ShieldCheck,
        title: "风控设置",
      },
      {
        key: "/settings",
        href: "/settings",
        icon: Settings,
        title: "系统设置",
      },
    ],
  },
];

const crmSection: SidebarItem = {
  key: "crm",
  href: "/crm",
  title: "CRM",
  icon: UsersRound,
  items: [
    {
      key: "/crm",
      href: "/crm",
      icon: UsersRound,
      title: "客户与机会",
    },
    {
      key: "/crm/import",
      href: "/crm/import",
      icon: FileText,
      title: "数据导入",
    },
    {
      key: "/crm/closer",
      href: "/crm/closer",
      icon: Bot,
      title: "成交助手",
    },
    {
      key: "/crm/connectors",
      href: "/crm/connectors",
      icon: Plug,
      title: "CRM 连接",
    },
  ],
};

const wecomSection: SidebarItem = {
  key: "wecom-crm",
  href: "/wecom-crm",
  title: "企业微信",
  icon: MessagesSquare,
  items: [
    {
      key: "/wecom-crm",
      href: "/wecom-crm",
      icon: Plug,
      title: "渠道配置",
    },
    {
      key: "/wecom-crm?tab=group",
      href: "/wecom-crm?tab=group",
      icon: Send,
      title: "客户群发",
    },
    {
      key: "/wecom-crm?tab=moments",
      href: "/wecom-crm?tab=moments",
      icon: Camera,
      title: "客户朋友圈",
    },
  ],
};

const bossSection: SidebarItem = {
  key: "boss-recruit",
  href: "/boss-recruit",
  title: "Boss 直聘",
  icon: BriefcaseBusiness,
  items: [
    {
      key: "/boss-recruit",
      href: "/boss-recruit",
      icon: BriefcaseBusiness,
      title: "招聘获客",
    },
  ],
};

export function createSectionItems(
  options: { crmInstalled?: boolean } = {},
): SidebarItem[] {
  const sections: SidebarItem[] = baseSectionItems.map((section) => ({
    ...section,
    items: section.items ? [...section.items] : undefined,
  }));

  if (options.crmInstalled) {
    const adminIndex = sections.findIndex((section) => section.key === "admin");
    const insertIndex = adminIndex >= 0 ? adminIndex : sections.length;
    sections.splice(insertIndex, 0, crmSection);
  }

  // 企业微信客户运营（商用能力）无条件展示，插在 admin 之前
  if (!sections.some((section) => section.key === "wecom-crm")) {
    const adminIndex = sections.findIndex((section) => section.key === "admin");
    const insertIndex = adminIndex >= 0 ? adminIndex : sections.length;
    sections.splice(insertIndex, 0, wecomSection);
  }

  // Boss 直聘获客，插在 admin 之前（企业微信区块之后）
  if (!sections.some((section) => section.key === "boss-recruit")) {
    const adminIndex = sections.findIndex((section) => section.key === "admin");
    const insertIndex = adminIndex >= 0 ? adminIndex : sections.length;
    sections.splice(insertIndex, 0, bossSection);
  }

  return sections;
}

export const sectionItems: SidebarItem[] = createSectionItems();
