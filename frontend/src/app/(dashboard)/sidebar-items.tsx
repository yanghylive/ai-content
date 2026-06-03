import { type SidebarItem } from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";

export const sectionItems: SidebarItem[] = [
    {
        key: "workspace",
        title: "工作台",
        items: [
            {
                key: "/",
                href: "/",
                icon: "solar:home-2-linear",
                title: "总览",
            },
            {
                key: "/confirmations",
                href: "/confirmations",
                icon: "solar:check-square-linear",
                title: "待我确认",
            },
            {
                key: "/agent-console",
                href: "/agent-console",
                icon: "solar:magic-stick-3-linear",
                title: "智能任务",
            },
            {
                key: "/execution-records",
                href: "/execution-records",
                icon: "solar:clipboard-list-linear",
                title: "任务记录",
            },
            {
                key: "/artifacts",
                href: "/artifacts",
                icon: "solar:gallery-check-linear",
                title: "操作证据",
            },
        ],
    },
    {
        key: "content-production",
        title: "内容生产",
        items: [
            {
                key: "/materials",
                href: "/materials",
                icon: "solar:box-minimalistic-linear",
                title: "内容素材",
            },
            {
                key: "/topics",
                href: "/topics",
                icon: "solar:lightbulb-minimalistic-linear",
                title: "选题库",
            },
            {
                key: "/articles",
                href: "/articles",
                icon: "solar:document-text-linear",
                title: "文章库",
            },
            {
                key: "/xiaohongshu",
                href: "/xiaohongshu",
                icon: "solar:chat-round-dots-linear",
                title: "小红书笔记",
            },
            {
                key: "/video-workshop",
                href: "/video-workshop",
                icon: "solar:video-frame-linear",
                title: "视频工坊",
            },
            {
                key: "/strategies",
                href: "/strategies",
                icon: "solar:target-linear",
                title: "内容规则",
            },
        ],
    },
    {
        key: "publishing",
        title: "发布中心",
        items: [
            {
                key: "/distribution?tab=article",
                href: "/distribution?tab=article",
                icon: "solar:pen-new-square-linear",
                title: "图文发布",
            },
            {
                key: "/distribution?tab=video",
                href: "/distribution?tab=video",
                icon: "solar:videocamera-record-linear",
                title: "视频发布",
            },
            {
                key: "/distribution?tab=materials",
                href: "/distribution?tab=materials",
                icon: "solar:gallery-wide-linear",
                title: "发布素材",
            },
            {
                key: "/distribution?tab=accounts",
                href: "/distribution?tab=accounts",
                icon: "solar:users-group-rounded-linear",
                title: "平台账号",
            },
            {
                key: "/schedules",
                href: "/schedules",
                icon: "solar:calendar-mark-linear",
                title: "计划任务",
            },
        ],
    },
    {
        key: "customer-interaction",
        title: "客户互动",
        items: [
            {
                key: "/workbench",
                href: "/workbench",
                icon: "solar:chat-round-call-linear",
                title: "互动总览",
            },
            {
                key: "/workbench/douyin-comments",
                href: "/workbench/douyin-comments",
                icon: "solar:chat-round-dots-linear",
                title: "抖音评论",
            },
            {
                key: "/workbench/douyin-messages",
                href: "/workbench/douyin-messages",
                icon: "solar:inbox-line-linear",
                title: "抖音私信",
            },
            {
                key: "/workbench/channel-comments",
                href: "/workbench/channel-comments",
                icon: "solar:chat-round-dots-linear",
                title: "视频号评论",
            },
            {
                key: "/workbench/channel-messages",
                href: "/workbench/channel-messages",
                icon: "solar:inbox-line-linear",
                title: "视频号私信",
            },
            {
                key: "/interaction/rules",
                href: "/interaction/rules",
                icon: "solar:settings-linear",
                title: "回复规则",
            },
            {
                key: "/interaction/records",
                href: "/interaction/records",
                icon: "solar:clipboard-text-linear",
                title: "回复记录",
            },
        ],
    },
    {
        key: "system",
        title: "系统设置",
        items: [
            {
                key: "/local-engine",
                href: "/local-engine",
                icon: "solar:monitor-smartphone-linear",
                title: "运行检查",
            },
            {
                key: "/capabilities/account",
                href: "/capabilities/account",
                icon: "solar:card-recive-linear",
                title: "账号与设备",
            },
            {
                key: "/platforms",
                href: "/platforms",
                icon: "solar:users-group-two-rounded-outline",
                title: "平台账号",
            },
            {
                key: "/settings",
                href: "/settings",
                icon: "solar:settings-outline",
                title: "系统配置",
            },
            {
                key: "/capabilities/risk",
                href: "/capabilities/risk",
                icon: "solar:shield-check-linear",
                title: "权限与安全",
            },
            {
                key: "/distribution?tab=logs",
                href: "/distribution?tab=logs",
                icon: "solar:bug-linear",
                title: "诊断日志",
            },
        ],
    },
];
