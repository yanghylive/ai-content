"use client";
/* The legacy route metadata below remains as migration reference data. */
/* eslint-disable @next/next/no-img-element */

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Chip, Progress, Spinner, Textarea, cn } from "@heroui/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "@/lib/toast";
import {
  authApi,
  kaypalApi,
  type AuthUser,
  type AuthTenantMembership,
  type KaypalBillingSnapshot,
  type KaypalProfile,
  type KaypalSubscription,
} from "@/lib/api/auth";
import { ElectronUpdateBanner } from "@/components/electron-update-banner";
import { SolutionRunContextBanner } from "./components/solution-run-context-banner";
import {
  approveSolutionManualTask,
  createSolutionRun,
  dryRunSolutionTaskRedfox,
  executeSolutionTaskRedfox,
  type SolutionRunRecord,
  type SolutionRunTaskRecord,
} from "@/lib/api/solutions";
import { toPublicError } from "@/lib/public-error";

const AUTH_PENDING_KEY = "ai-content-auth-pending";
const ACTIVE_TENANT_KEY = "ai_content_tenant_id";
const DESKTOP_APP_VERSION = "1.1.90";
const RELEASE_NOTES = [
  {
    version: "v1.1.90",
    date: "2026-08-20",
    highlights: [
      "修复非 C 盘安装（Program Files 等）导致的操作失败：数据/日志迁移到用户数据目录",
      "错误自动上报：运行异常自动上传云端，无需手动收集日志",
    ],
  },
  {
    version: "v1.1.89",
    date: "2026-08-20",
    highlights: [
      "错误自动上报：运行异常自动上传云端，无需手动收集日志",
      "登录浏览器空白修复（Windows）：goto 不跳转时自动用浏览器自身 JS 导航兜底",
      "登录导航增加诊断日志，便于真机定位",
    ],
  },
  {
    version: "v1.1.88",
    date: "2026-08-20",
    highlights: [
      "登录浏览器空白修复（Windows）：goto 不跳转时自动用浏览器自身 JS 导航兜底",
      "登录导航增加诊断日志，便于真机定位",
    ],
  },
  {
    version: "v1.1.87",
    date: "2026-08-20",
    highlights: [
      "安装包稳定性修复：启动崩溃（sqlite-empty-template 缺失）+ 登录页图标丢失",
      "抖音登录浏览器空白修复：探活进程无限堆积 + CDP 端口并发竞态",
    ],
  },
  {
    version: "v1.1.86",
    date: "2026-08-20",
    highlights: [
      "AI 获客体验升级：AI 长期记忆接入，价值感知 12 项落地（简报卡/工作轨迹/自然语言评分理由/价值账单）",
      "未开放功能整页遮罩（10 页）：全貌可见 + 背景模糊 + 操作锁定",
      "抖音自动触达防风控 + 反爬拦截时视觉模型自动恢复候选",
    ],
  },
  {
    version: "v1.1.85",
    date: "2026-08-15",
    highlights: [
      "发布中心修复闭环：确认发布/重试按钮接上行为，账号失效可恢复任务",
      "移动端界面统一：手写图标收敛为统一图标库，品牌 logo 与骨架屏抽成共享组件",
    ],
  },
  {
    version: "v1.1.84",
    date: "2026-08-14",
    highlights: [
      "登录页微信登录修复：改为跳转方式，去掉扫码后无反应的二维码展示",
      "旧入口路由归一：旧任务控制台/文章库/客户详情/企微助手重定向到规范路由",
    ],
  },
  {
    version: "v1.1.83",
    date: "2026-08-14",
    highlights: [
      "统一线索对象 + 事件流：三套线索表收敛为统一 leads 表，线索全链路可追溯",
      "AI 质量观测落地：每次 AI 调用 prompt/回复快照、耗时、成败、失败原因自动落库",
      "多租户双维度 + 成员管理：actorUserId 操作者维度 + 成员邀请/移除闭环",
    ],
  },
  {
    version: "v1.1.82",
    date: "2026-08-12",
    highlights: [
      "修复素材库「始终 20 篇」、文章反抓正文恒空、抖音私信误报、微信群发入口等真机反馈的闭环断裂",
      "AI 生图（qwen-image 可选尺寸）/ 生视频（happyhorse 可选时长）切换百炼引擎，稳定出图出片",
      "视频一键成片独立为专属产品页；功能页统一补齐返回按钮、顶部图标桌面端不再撑大",
    ],
  },
  {
    version: "v1.1.81",
    date: "2026-08-12",
    highlights: [
      "修复微信联系人同步失败：微信数据组件云端化后 OCR 兜底引擎路径错位、测试下载地址残留，微信 4.x 也能正常同步",
      "客户端左下角/登录页版本号改为读取应用真实版本，不再错位显示旧版本号",
    ],
  },
  {
    version: "v1.1.80",
    date: "2026-08-12",
    highlights: [
      "增长工作流升级为行业方案库：14 大行业 × 2 场景，自带行业话术、平台与风控要点",
      "工作流执行引擎上线：真实执行获客动作、自动推进、人工确认、节点进度一目了然",
      "AI 助手成为系统全能助手：一句话开流水线、查线索、查获客任务、看热点",
      "记忆系统全面升级：多轮上下文不再失忆 + 腾讯 Agent Memory 四层长期记忆",
    ],
  },
  {
    version: "v1.1.79",
    date: "2026-08-11",
    highlights: [
      "修复抖音多账号冲突：新增账号不再跳到已登录账号，不同登录身份的浏览器档案彻底隔离",
      "平台账号头像/昵称抓取升级：真实头像与真实昵称，账号列表提供「刷新头像」一键重抓",
      "发布链路加固：批量发布单平台失败不再拖垮全部平台",
      "发布前内容体检：标题超长/话题超限/敏感词在提交前拦截提示",
      "定时发布排期器：每日多条时间随机浮动，不跨天",
    ],
  },
  {
    version: "v1.1.79",
    date: "2026-08-11",
    highlights: [
      "修复登录后 AI 对话/模型台/语音等能力异常：云端服务地址全面切换生产环境",
      "登录与云端能力链路再加固：不再依赖任何测试服务地址",
    ],
  },
  {
    version: "v1.1.77",
    date: "2026-08-11",
    highlights: [
      "修复全新安装后登录失败：新装/升级后账号密码登录与微信扫码均可正常使用",
      "云端认证链路加固：登录统一指向生产服务，不再受本地环境配置影响",
    ],
  },
  {
    version: "v1.1.76",
    date: "2026-08-11",
    highlights: [
      "微信数据能力改为按需加载：首次使用微信联系人/数据功能时自动下载本地组件（下载失败自动降级提示），安装包更精简",
      "平台兼容性优化：解决执行任务时浏览器窗口频繁弹出打断操作的问题",
      "能力边界文案更新：手机端能力说明更清晰",
    ],
  },
  {
    version: "v1.1.75",
    date: "2026-08-11",
    highlights: [
      "电脑端「助手」页改为手机 App 同款 AI 助手：同一套云端对话（热点选题/文案创作/违禁词/比价返利），语音文字都可用",
      "获客任务「立即执行」恢复真实执行：修复占位账号、能力误判模拟、确认单缺失，点执行后真实找客户发评论",
      "企微助手、评论洞察从空壳页变成真实功能：连接企微群机器人/AI 自动回复、粘贴评论一键分析痛点需求",
      "补齐 11 个功能入口（情报报告/趋势雷达/AI 客服/朋友圈计划/记忆设置等），清理 11 个旧页面",
      "修复浏览器窗口乱跳：后台轮询不再触发账号验证拉起抖音/小红书窗口",
    ],
  },
  {
    version: "v1.1.74",
    date: "2026-08-10",
    highlights: [
      "账号密码登录接入云端真实授权：登录后正确显示旗舰版与积分余额，不再回落免费版",
      "微信扫码登录回调链路优化（云端白名单已同步部署）",
      "后端自动化测试 1464 项全绿",
    ],
  },
  {
    version: "v1.1.73",
    date: "2026-08-10",
    highlights: [
      "应用图标更换为九章智能三玖回旋纹（桌面与工作台左上角；登录页保持原版）",
      "新增商品剪辑配置、BGM 曲库、视频发布计划、素材删除/重命名、合成分类",
      "新增曝光账号管理与评论扩散/文案扩展/曝光记录",
      "AI 调用自动统计 Token 用量（每日配额/明细可追溯）",
      "炼刀能力逐项补齐完成，后端自动化测试 1464 项全绿",
    ],
  },
  {
    version: "v1.1.72",
    date: "2026-08-10",
    highlights: [
      "登录与云端能力统一走生产环境（kaypal.cn），修复测试环境残留域名",
      "新增 AI 网页代操作：自然语言指令驱动真实浏览器执行（打开/点击/输入/截图/提取），逐步截图留证",
      "新增桌面悬浮球：随时唤起 AI 网页代操作，输入指令即可执行并查看证据",
      "新增 Token 用量追踪（每日配额/预检/上报）、门店 POI 管理、商品视频一键剪辑",
      "群发计划新增默认配置查询；后端全量自动化测试 1451 项全绿",
    ],
  },
  {
    version: "v1.1.60",
    date: "2026-08-04",
    highlights: [
      "修复 Windows 安装后 3011 本地服务因安全密钥缺失而无法启动的问题",
      "账号凭据密钥由系统安全存储保护，并在后续自动更新中稳定复用",
      "Windows 构建新增安装后后端启动自测，启动失败将阻止发布",
    ],
  },
  {
    version: "v1.1.59",
    date: "2026-08-04",
    highlights: [
      "修复 Windows 真机首次启动时 3011 本地服务可能超时的问题",
      "保留 Windows 系统关键环境变量，提升本地后端、Prisma 和原生依赖启动稳定性",
      "本地服务异常时展示日志目录，便于现场快速定位",
    ],
  },
  {
    version: "v1.1.58",
    date: "2026-08-04",
    highlights: [
      "平台账号历史数据已清理，重新登录后状态更干净",
      "视频工坊与换脸入口暂时隐藏，工作台只保留当前可用能力",
      "全站功能图标更新为更专业的 JIUZHANG AI 风格",
    ],
  },
  {
    version: "v1.1.57",
    date: "2026-07-31",
    highlights: [
      "全新 Astryx 设计系统界面，全站改版",
      "登录修复：授权过期可恢复，桌面会话自动检测",
      "页脚自适应屏幕底部，助手对话满宽满高",
    ],
  },
  {
    version: "v1.1.56",
    date: "2026-07-30",
    highlights: [
      "白龙马语音桥接自动续期，授权永不过期",
      "脑图节点修复：嵌套 iframe 中始终可见",
      "全站品牌升级至 JIUZHANG AI",
    ],
  },
  {
    version: "v1.1.55",
    date: "2026-07-25",
    highlights: ["运营战情室上线", "解决方案运行中心改版"],
  },
] as const;

function DashboardFooter({ appVersion }: { appVersion: string }) {
  // 优先读 electron 真实版本号（package.json），web 环境回退到写死常量
  const [version, setVersion] = useState(appVersion);
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { app?: { getVersion?: () => Promise<string> } } })
      .electronAPI;
    if (api?.app?.getVersion) {
      api.app
        .getVersion()
        .then((v) => {
          if (v) setVersion(v);
        })
        .catch(() => {});
    }
  }, []);
  const current = RELEASE_NOTES.find((r) => r.version === `v${version}`) ?? RELEASE_NOTES[0];
  return (
    <footer
      className="mt-auto flex min-w-0 flex-col gap-3 border-t border-divider px-4 py-6 text-[12px] text-default-500 sm:px-6 lg:flex-row lg:items-center lg:justify-between"
      aria-label="系统信息"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {/* 左下角品牌字标：浅色系统用黑字版，暗色系统用白字版 */}
        <img
          src="/brand/jiuzhang-wordmark-black.png"
          alt="JIUZHANG AI"
          className="h-6 w-auto shrink-0 dark:hidden"
          draggable={false}
        />
        <img
          src="/brand/jiuzhang-wordmark-white.png"
          alt="JIUZHANG AI"
          className="hidden h-6 w-auto shrink-0 dark:block"
          draggable={false}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono font-semibold text-foreground">
            {current.version}
          </span>
          <span className="text-default-400">·</span>
          <span>更新于 {current.date}</span>
          <span className="text-default-400">·</span>
          <span>检查新版本可获得最新能力</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="flat"
          color="primary"
          startContent={<RefreshCw size={14} />}
          onClick={() =>
            toast.success(`已是最新版本 ${current.version}`, {
              duration: 4000,
            })
          }
        >
          检查更新
        </Button>
        <Button
          as={Link}
          size="sm"
          variant="light"
          href="/release-notes"
          endContent={<ArrowRight size={14} />}
        >
          更新历史
        </Button>
      </div>
    </footer>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatPlanLabel(value?: string | null, fallback = "未同步") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const labels: Record<string, string> = {
    FREE: "免费版",
    PRO: "专业版",
    ADVANCED: "高级版",
    ENTERPRISE: "企业版",
  };
  return labels[normalized.toUpperCase()] || normalized;
}

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未同步";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
    value,
  );
}

function getBillingPlan(billing: KaypalBillingSnapshot | null) {
  const raw = billing?.subscription;
  const record = asRecord(raw);
  if (!record) return null;
  const data = asRecord(record.data) || record;
  const subscription = asRecord(data.subscription) || data;
  const plan = subscription.plan;
  if (typeof plan === "string") return plan;
  const planRecord = asRecord(plan);
  if (planRecord) {
    return (
      String(
        planRecord.legacyId || planRecord.code || planRecord.name || "",
      ).trim() || null
    );
  }
  const subscriptionPlan = subscription.subscriptionPlan;
  return typeof subscriptionPlan === "string" ? subscriptionPlan : null;
}

function hasUsableLocalSession(user: AuthUser | null | undefined) {
  return Boolean(user?.id && user.status === "active");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function stripQuery(value?: string) {
  return String(value || "").split("?")[0];
}

type BreadcrumbRoute = {
  sectionTitle: string;
  title: string;
  selectedKey?: string;
};

const routeAliases: Record<string, string> = {
  // 3010 P0-2：默认首页「今日增长」。根路径统一收敛到 /today，
  // 与 app-shell SCENES 的 growth-home 场景保持一致。此规则只加不删，
  // 历史 alias（/admin/*、/capabilities/*）与防重定向循环注释保持不动。
  "/": "/today",
  "/admin": "/apps",
  "/admin/account": "/capabilities/account",
  "/admin/ai-employee": "/apps/ai-employee",
  "/admin/commercial-readiness": "/commercial-readiness",
  "/admin/connectors": "/platforms",
  "/admin/executor": "/local-engine",
  "/admin/local-engine": "/local-engine",
  "/admin/memory": "/tasks/evidence",
  "/admin/models": "/capabilities/models",
  "/admin/plugins": "/capabilities/models",
  "/admin/risk": "/capabilities/risk",
  "/admin/sandbox": "/capabilities/risk",
  "/admin/savings": "/savings",
  "/admin/settings": "/settings",
  "/admin/tools": "/local-engine",
  "/admin/users": "/capabilities/account",
  "/admin/redfox": "/intelligence/redfox",
  "/admin/redfox-skills": "/intelligence/skills",
  "/capabilities/users": "/capabilities/account",
  "/capabilities/tools": "/local-engine",
  "/capabilities/plugins": "/capabilities/models",
  "/capabilities/memory": "/tasks/evidence",
  "/capabilities/executor": "/local-engine",
  "/capabilities/sandbox": "/capabilities/risk",
  // 素材库保留独立路由：移除 alias（曾并入 /content 导致 content 页入口被弹回、移动端素材库/去水印进不去）
  // "/materials": "/content",
  // 知识库保留独立路由：/knowledge-base 是真实 v2 页，alias 到 /content/knowledge
  // 会与 content/knowledge 的 redirect("/knowledge-base") 构成重定向循环（P2-10 修复）
  // "/knowledge-base": "/content/knowledge",
  // 视频工坊保留独立路由：2026-08-10 收口时已把 /video-workshop-v2 的真实实现
  // （studio_core 流水线控制台）搬回 /video-workshop 主路由，不再是占位，无需 alias 到 /content
  // "/video-workshop": "/content",
  // 2026-08-11 routeAliases 收口：纯归一旧路径（/topics、/strategies、/workbench、/interaction/* 等）
  // 已全部改为规范路径直连（/content/*、/tasks/*、/engagement/*），删除 alias 条目。
  // 保留上方 /admin/*、/capabilities/* 功能性隐藏（APK 内不渲染 admin 后台）。
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routeBreadcrumbs: Record<string, BreadcrumbRoute> = {
  "/agent-workbench": { sectionTitle: "任务中心", title: "任务历史" },
  "/apps/auto-acquisition": {
    sectionTitle: "增长获客",
    title: "自动获客应用",
    selectedKey: "/growth",
  },
  "/admin/ai-employee": {
    sectionTitle: "应用与系统",
    title: "AI 员工",
    selectedKey: "/apps",
  },
  "/admin/commercial-readiness": {
    sectionTitle: "应用与系统",
    title: "商用检查",
    selectedKey: "/capabilities/risk",
  },
  "/admin/account": {
    sectionTitle: "设置",
    title: "账号与设备",
    selectedKey: "/capabilities/account",
  },
  "/admin/tools": {
    sectionTitle: "设置",
    title: "设备状态",
    selectedKey: "/local-engine",
  },
  "/admin/plugins": {
    sectionTitle: "设置",
    title: "模型与工具",
    selectedKey: "/capabilities/models",
  },
  "/admin/memory": {
    sectionTitle: "任务中心",
    title: "结果留存",
    selectedKey: "/tasks/evidence",
  },
  "/admin/executor": {
    sectionTitle: "设置",
    title: "设备状态",
    selectedKey: "/local-engine",
  },
  "/admin/sandbox": {
    sectionTitle: "应用与系统",
    title: "安全边界",
    selectedKey: "/capabilities/risk",
  },
  "/crm": { sectionTitle: "CRM", title: "客户与机会", selectedKey: "/crm" },
  "/crm/import": {
    sectionTitle: "CRM",
    title: "数据导入",
    selectedKey: "/crm/import",
  },
  "/crm/closer": {
    sectionTitle: "CRM",
    title: "成交助手",
    selectedKey: "/crm/closer",
  },
  "/crm/connectors": {
    sectionTitle: "CRM",
    title: "CRM 连接",
    selectedKey: "/crm/connectors",
  },
  "/local-engine": {
    sectionTitle: "设置",
    title: "设备状态",
    selectedKey: "/local-engine",
  },
  "/admin/local-engine": {
    sectionTitle: "设置",
    title: "设备状态",
    selectedKey: "/local-engine",
  },
  "/intelligence/skills": {
    sectionTitle: "应用与系统",
    title: "情报功能模板",
    selectedKey: "/capabilities/models",
  },
  "/intelligence/redfox": {
    sectionTitle: "应用与系统",
    title: "数据来源",
    selectedKey: "/platforms",
  },
  "/intelligence/costs": {
    sectionTitle: "应用与系统",
    title: "用量明细",
    selectedKey: "/settings",
  },
  "/release-notes": { sectionTitle: "应用与系统", title: "版本更新" },
  "/sessions": { sectionTitle: "任务中心", title: "任务历史" },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const routeBreadcrumbPrefixes: Array<[string, BreadcrumbRoute]> = [
  ["/crm", { sectionTitle: "CRM", title: "客户与机会", selectedKey: "/crm" }],
];

type ToolEntryDefinition = {
  title: string;
  module: string;
  description: string;
  outputs: string[];
  resultHref: string;
  actionLabel?: string;
  available?: boolean;
};

type ToolResultAction = {
  label: string;
  href: string;
  detail: string;
};

const toolEntryDefinitions: Record<string, ToolEntryDefinition> = {
  "hot-topic-solution": {
    title: "热点选题",
    module: "情报中心",
    description: "看热点、找角度，把可执行选题沉淀到选题库。",
    outputs: ["热点情报", "选题库", "素材线索"],
    resultHref: "/intelligence/trends",
    actionLabel: "生成选题",
  },
  "industry-intel": {
    title: "行业情报",
    module: "情报中心",
    description: "按行业和关键词整理趋势、机会、风险和报告。",
    outputs: ["趋势情报", "行业报告", "行动建议"],
    resultHref: "/intelligence/industries",
    actionLabel: "生成情报",
  },
  "global-content-intel": {
    title: "出海趋势",
    module: "情报中心",
    description: "发现海外平台内容趋势，转成本地化选题和脚本方向。",
    outputs: ["海外趋势", "本地化选题", "参考素材"],
    resultHref: "/intelligence/trends",
    actionLabel: "发现趋势",
  },
  "competitor-account-radar": {
    title: "竞品账号",
    module: "情报中心",
    description: "分析对标账号、爆款栏目、增长异常和可复制打法。",
    outputs: ["对标账号", "竞品报告", "增长机会"],
    resultHref: "/intelligence/accounts",
    actionLabel: "分析竞品",
  },
  "low-follower-viral": {
    title: "低粉爆款",
    module: "情报中心",
    description: "发现低粉高互动内容，拆出冷启动更容易复制的模式。",
    outputs: ["爆款样本", "复刻选题", "机会判断"],
    resultHref: "/intelligence/viral",
    actionLabel: "挖掘爆款",
  },
  "viral-breakdown": {
    title: "爆款拆解",
    module: "情报中心",
    description: "拆作品结构、评论反馈和复刻建议。",
    outputs: ["结构拆解", "评论反馈", "复刻建议"],
    resultHref: "/intelligence/viral",
    actionLabel: "拆解爆款",
  },
  "brand-monitoring": {
    title: "品牌舆情",
    module: "情报中心",
    description: "监控品牌词、竞品词、负面风险和回应机会。",
    outputs: ["监控任务", "风险识别", "每日情报"],
    resultHref: "/intelligence/monitors",
    actionLabel: "开始监控",
  },
  "private-asset-extractor": {
    title: "素材提取",
    module: "素材与品牌",
    description: "从文件、链接、短视频和私域内容里提取素材与知识。",
    outputs: ["素材库", "知识库", "证据附件"],
    resultHref: "/content",
    actionLabel: "提取素材",
  },
  "creation-enhancement": {
    title: "内容生成",
    module: "内容运营",
    description: "围绕选题生成标题、正文、封面素材和发布草稿。",
    outputs: ["内容草稿", "素材建议", "发布草稿"],
    resultHref: "/content/articles",
    actionLabel: "生成内容",
  },
  "aigc-asset-factory": {
    title: "素材生成",
    module: "素材与品牌",
    description: "根据选题、产品和风格要求生成图片、封面和素材提示词。",
    outputs: ["图片素材", "素材提示词", "素材包"],
    resultHref: "/content",
    actionLabel: "生成素材",
  },
  "multi-platform-copy": {
    title: "多平台文案",
    module: "内容运营",
    description: "把一份原文改写成小红书、公众号、知乎、抖音等版本。",
    outputs: ["平台文案", "合规提示", "发布草稿"],
    resultHref: "/content/optimization",
    actionLabel: "改写文案",
    available: false,
  },
  "publish-compliance": {
    title: "发布风险检查",
    module: "发布中心",
    description: "发布前检查违禁词、风险表达和替代写法。",
    outputs: ["合规检查", "替代表达", "风险记录"],
    resultHref: "/compliance",
    actionLabel: "检查风险",
  },
  "kol-screening": {
    title: "达人筛选",
    module: "增长获客",
    description: "按投放目标、人设、内容质量和风险筛出可跟进达人。",
    outputs: ["候选达人", "匹配评分", "跟进任务"],
    resultHref: "/growth?view=acquisition",
    actionLabel: "筛选达人",
  },
  "account-diagnosis": {
    title: "账号健康",
    module: "增长获客",
    description: "诊断账号定位、内容节奏、互动质量、风险项和改进计划。",
    outputs: ["健康评分", "增长报告", "监控任务"],
    resultHref: "/growth?view=account-health",
    actionLabel: "开始诊断",
  },
  "comment-lead-solution": {
    title: "评论线索",
    module: "客户互动",
    description: "从评论里识别需求、投诉、购买意图和跟进机会。",
    outputs: ["评论洞察", "客户线索", "跟进建议"],
    resultHref: "/engagement/comment-insights",
    actionLabel: "提取线索",
  },
};

const redfoxTaskRunnableStatuses = new Set(["queued", "planned", "failed"]);
const redfoxTaskExecutableStatuses = new Set([
  "dry_run_ready",
  "approval_required",
  "failed",
]);
const manualTaskApprovableStatuses = new Set([
  "approval_required",
  "planned",
  "queued",
  "failed",
]);

type BusinessToolRunState = {
  phase: "idle" | "running" | "success" | "failed";
  message?: string;
  run?: SolutionRunRecord;
};

function businessToolPhaseMeta(phase: BusinessToolRunState["phase"]) {
  if (phase === "success") {
    return {
      label: "已生成",
      tone: "success" as const,
      description: "结果已生成，可以继续查看和保存。",
    };
  }
  if (phase === "running") {
    return {
      label: "生成中",
      tone: "primary" as const,
      description: "系统正在处理输入、生成结果并写入对应业务库。",
    };
  }
  if (phase === "failed") {
    return {
      label: "未完成",
      tone: "danger" as const,
      description: "本次生成失败，请调整目标后重新生成或查看记录。",
    };
  }
  return {
    label: "待生成",
    tone: "default" as const,
    description: "写一句目标后生成，结果会沉淀到当前业务模块。",
  };
}

function hrefWithRunId(href: string, runId?: string) {
  if (!runId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}runId=${encodeURIComponent(
    runId,
  )}&source=business-tool-entry`;
}

function businessRunTaskProgress(run?: SolutionRunRecord) {
  if (!run?.tasks.length) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const completed = run.tasks.filter((task) =>
    ["succeeded", "completed", "dry_run_ready", "approval_required"].includes(
      task.status,
    ),
  ).length;
  return {
    completed,
    total: run.tasks.length,
    percent: Math.round((completed / run.tasks.length) * 100),
  };
}

function buildToolResultActions(
  entry: ToolEntryDefinition,
  run?: SolutionRunRecord,
): ToolResultAction[] {
  return [
    {
      label: "打开结果区",
      href: hrefWithRunId(entry.resultHref, run?.id),
      detail: "查看这次生成沉淀到业务页的结果。",
    },
    {
      label: "查看生成记录",
      href: run
        ? `/tasks/runs?runId=${encodeURIComponent(run.id)}`
        : "/tasks/runs",
      detail: "看处理进度、失败原因和执行留痕。",
    },
    {
      label: "继续组合方案",
      href: "/solutions",
      detail: "需要跨情报、内容、线索、合规一起跑时再用组合方案。",
    },
  ];
}

function buildBusinessToolInput(
  toolCode: string,
  entry: ToolEntryDefinition,
  objective: string,
) {
  return {
    businessObjective: objective,
    query: objective,
    keyword: objective,
    keywords: objective
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    platform: "all",
    platforms: ["全平台"],
    deliveryTarget: entry.outputs.join("、"),
    outputTarget: entry.resultHref,
    scenario: toolCode,
    source: "business-module-tool-entry",
  };
}

function canAutoRunRedfoxTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "redfox" &&
    redfoxTaskRunnableStatuses.has(task.status)
  );
}

function canAutoExecuteRedfoxTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "redfox" &&
    redfoxTaskExecutableStatuses.has(task.status)
  );
}

function canAutoApproveManualTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "manual" &&
    manualTaskApprovableStatuses.has(task.status)
  );
}

function isBackgroundDataServiceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /redfox|api key|key|required|数据服务|授权已失效|暂未开通|暂不可用|暂时不可达/i.test(
    message,
  );
}

function publicBusinessToolErrorMessage(error: unknown) {
  if (isBackgroundDataServiceError(error)) {
    return "系统数据服务暂时不可用，已为你保留可继续处理的任务结果。";
  }
  return toPublicError(error, "业务结果未生成，请调整目标后重试。");
}

async function generateBusinessToolRun({
  toolCode,
  entry,
  objective,
}: {
  toolCode: string;
  entry: ToolEntryDefinition;
  objective: string;
}) {
  const input = buildBusinessToolInput(toolCode, entry, objective);
  let currentRun = await createSolutionRun(toolCode, {
    trigger: "manual",
    source: "business-module-tool-entry",
    input,
    dryRun: false,
  });

  for (const originalTask of currentRun.tasks) {
    const task =
      currentRun.tasks.find((item) => item.id === originalTask.id) ||
      originalTask;

    if (canAutoRunRedfoxTask(task)) {
      let updatedTask = task;
      let estimatedCostPoints = 1;
      try {
        const preview = await dryRunSolutionTaskRedfox(currentRun.id, task.id, {
          input,
          estimatedCostPoints: 1,
        });
        currentRun = preview.run;
        updatedTask =
          currentRun.tasks.find((item) => item.id === task.id) || task;
        estimatedCostPoints = preview.redfoxRun.estimatedCostPoints || 1;
      } catch (error) {
        if (!isBackgroundDataServiceError(error)) {
          throw error;
        }
      }

      if (canAutoExecuteRedfoxTask(updatedTask)) {
        try {
          const executed = await executeSolutionTaskRedfox(
            currentRun.id,
            task.id,
            {
              input,
              estimatedCostPoints,
              approvalNote: "用户在业务模块直接生成结果。",
            },
          );
          currentRun = executed.run;
        } catch (error) {
          if (!isBackgroundDataServiceError(error)) {
            throw error;
          }
        }
      }
      continue;
    }

    if (canAutoApproveManualTask(task)) {
      const approved = await approveSolutionManualTask(currentRun.id, task.id, {
        approvalNote: "用户在业务模块直接生成结果时确认检查点。",
      });
      currentRun = approved.run;
    }
  }

  return currentRun;
}

function BusinessToolEntryPanel({
  toolCode,
  entry,
}: {
  toolCode: string;
  entry: ToolEntryDefinition;
}) {
  const [objective, setObjective] = React.useState("");
  const [runState, setRunState] = React.useState<BusinessToolRunState>({
    phase: "idle",
  });
  const canGenerate = entry.available !== false;

  React.useEffect(() => {
    setObjective("");
    setRunState({ phase: "idle" });
  }, [toolCode]);

  const handleGenerate = async () => {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      toast.error("先写一句你要的结果");
      return;
    }
    if (!canGenerate) {
      toast.error("这个能力还在建设中");
      return;
    }

    setRunState({ phase: "running", message: "正在生成业务结果" });
    try {
      const run = await generateBusinessToolRun({
        toolCode,
        entry,
        objective: trimmedObjective,
      });
      setRunState({
        phase: "success",
        message: "结果已生成，正在进入对应业务库。",
        run,
      });
      toast.success("业务结果已生成");
    } catch (error) {
      const message = publicBusinessToolErrorMessage(error);
      setRunState({ phase: "failed", message });
      toast.error(message);
    }
  };

  const phaseMeta = businessToolPhaseMeta(runState.phase);
  const taskProgress = businessRunTaskProgress(runState.run);
  const resultActions = buildToolResultActions(entry, runState.run);
  const generatedResultHref = hrefWithRunId(entry.resultHref, runState.run?.id);

  return (
    <section className="mb-4 rounded-[8px] border border-primary/20 bg-primary/5 p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip color="primary" variant="flat">
              当前场景
            </Chip>
            <span className="text-xs font-semibold text-primary">
              {entry.module}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-bold text-foreground">
            {entry.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-default-600">
            {entry.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {entry.outputs.map((output) => (
              <Chip key={output} size="sm" variant="flat">
                {output}
              </Chip>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-default-200 bg-content1 p-3">
          <Textarea
            label="你要什么结果"
            minRows={2}
            value={objective}
            placeholder={`例如：帮我${entry.title}，目标是...`}
            variant="bordered"
            isDisabled={!canGenerate || runState.phase === "running"}
            onValueChange={setObjective}
            classNames={{
              inputWrapper: "rounded-[8px] bg-background",
            }}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              color="primary"
              className="rounded-[8px] font-semibold"
              isDisabled={!canGenerate}
              isLoading={runState.phase === "running"}
              onPress={handleGenerate}
            >
              {canGenerate ? entry.actionLabel || "生成结果" : "建设中"}
            </Button>
            <Button
              as="a"
              href={generatedResultHref}
              variant="flat"
              className="rounded-[8px] font-semibold"
              endContent={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
            >
              打开结果区
            </Button>
          </div>
          {runState.message ? (
            <p
              className={cn("mt-3 text-xs leading-5", {
                "text-default-500": runState.phase === "running",
                "text-[var(--kaypal-v3-success)]": runState.phase === "success",
                "text-[var(--kaypal-v3-danger)]": runState.phase === "failed",
              })}
            >
              {runState.message}
            </p>
          ) : null}
          {runState.run ? (
            <Button
              as="a"
              href={`/tasks/runs?runId=${encodeURIComponent(runState.run.id)}`}
              size="sm"
              variant="light"
              className="mt-2 h-7 rounded-[6px] px-2 text-xs font-semibold"
            >
              查看本次生成记录
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-foreground">结果区</p>
              <p className="mt-1 text-xs leading-5 text-default-500">
                {phaseMeta.description}
              </p>
            </div>
            <Chip color={phaseMeta.tone} variant="flat">
              {phaseMeta.label}
            </Chip>
          </div>
          {runState.run ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-default-500">
                <span>
                  已处理 {taskProgress.completed}/{taskProgress.total} 个步骤
                </span>
                <span>{runState.run.progress}%</span>
              </div>
              <Progress
                aria-label="生成进度"
                className="max-w-full"
                color="success"
                size="sm"
                value={runState.run.progress || taskProgress.percent}
              />
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {entry.outputs.map((output) => (
              <div
                key={output}
                className="rounded-[8px] border border-default-200 bg-default-50 p-3"
              >
                <Chip
                  size="sm"
                  color={
                    runState.phase === "success"
                      ? "success"
                      : runState.phase === "running"
                        ? "primary"
                        : runState.phase === "failed"
                          ? "danger"
                          : "default"
                  }
                  variant="flat"
                >
                  {phaseMeta.label}
                </Chip>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {output}
                </p>
                <p className="mt-1 text-xs leading-5 text-default-500">
                  {runState.phase === "success"
                    ? "可继续打开结果区查看和处理。"
                    : "生成后会沉淀到对应业务位置。"}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-default-200 bg-content1 p-4">
          <p className="text-sm font-bold text-foreground">下一步</p>
          <div className="mt-3 grid gap-2">
            {resultActions.map((action) => (
              <Button
                key={action.label}
                as="a"
                href={action.href}
                variant="flat"
                className="h-auto justify-start rounded-[8px] px-3 py-2 text-left"
                endContent={
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                }
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {action.label}
                  </span>
                  <span className="block whitespace-normal text-xs leading-5 text-default-500">
                    {action.detail}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}
function DashboardLayoutFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex items-center gap-3 rounded-[8px] border border-divider bg-content1 px-4 py-3 shadow-sm">
        <Spinner size="sm" />
        <span className="text-[14px] leading-[22px] text-default-500">
          正在验证登录状态...
        </span>
      </div>
    </div>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [authLoading, setAuthLoading] = React.useState(true);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
  const [tenantMemberships, setTenantMemberships] = React.useState<
    AuthTenantMembership[]
  >([]);
  const [activeTenantId, setActiveTenantId] = React.useState("");
  const [kaypalProfile, setKaypalProfile] =
    React.useState<KaypalProfile | null>(null);
  const [kaypalSubscription, setKaypalSubscription] =
    React.useState<KaypalSubscription | null>(null);
  const [kaypalBilling, setKaypalBilling] =
    React.useState<KaypalBillingSnapshot | null>(null);
  const [kaypalSyncRequired, setKaypalSyncRequired] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let redirectTimer: number | null = null;

    const redirectToLogin = () => {
      const search = searchParams.toString();
      const currentPath = `${pathname || "/"}${search ? `?${search}` : ""}`;
      const next = currentPath
        ? `?next=${encodeURIComponent(currentPath)}`
        : "";
      if (typeof window !== "undefined") {
        window.location.replace(`/login${next}`);
      } else {
        router.replace(`/login${next}`);
      }
    };

    if (typeof window !== "undefined") {
      redirectTimer = window.setTimeout(() => {
        if (!active) return;
        redirectToLogin();
      }, 6500);
    }

    const hasRecentAuthPending = () => {
      if (typeof window === "undefined") {
        return false;
      }

      const pendingAt = Number(
        window.sessionStorage.getItem(AUTH_PENDING_KEY) || "0",
      );
      if (!pendingAt) {
        return false;
      }

      return Date.now() - pendingAt < 10000;
    };

    const clearAuthPending = () => {
      if (typeof window === "undefined") {
        return;
      }

      window.sessionStorage.removeItem(AUTH_PENDING_KEY);
    };

    const wait = (ms: number) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const checkCurrentUser = () =>
      Promise.race<AuthUser>([
        authApi.me(),
        new Promise<AuthUser>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("auth-check-timeout")),
            3000,
          );
        }),
      ]);

    const fetchCurrentUser = async () => {
      const attempts = hasRecentAuthPending()
        ? [0, 250, 500, 1000, 1500]
        : [0, 250];

      for (const delay of attempts) {
        if (delay > 0) {
          await wait(delay);
        }

        try {
          const user = await checkCurrentUser();
          if (hasUsableLocalSession(user)) {
            clearAuthPending();
            return user;
          }
        } catch {
          // 继续重试，直到耗尽次数
        }
      }

      clearAuthPending();
      throw new Error("auth-check-failed");
    };

    const ensureAuth = async () => {
      let authenticated = false;
      try {
        const user = await fetchCurrentUser();
        if (!active) {
          return;
        }
        authenticated = true;
        setCurrentUser(user);
      } catch {
        if (!active) {
          return;
        }
        redirectToLogin();
        return;
      } finally {
        if (active && authenticated) {
          if (redirectTimer) {
            window.clearTimeout(redirectTimer);
          }
          setAuthLoading(false);
        }
      }
    };

    ensureAuth();

    return () => {
      active = false;
      if (redirectTimer) {
        window.clearTimeout(redirectTimer);
      }
    };
  }, [pathname, router, searchParams]);

  React.useEffect(() => {
    let active = true;
    if (!currentUser) {
      setKaypalProfile(null);
      setKaypalSubscription(null);
      setKaypalBilling(null);
      setKaypalSyncRequired(false);
      return () => {
        active = false;
      };
    }

    const refreshKaypalState = () => {
      Promise.all([
        kaypalApi
          .profile()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
        kaypalApi
          .subscription()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
        kaypalApi
          .billing()
          .then((value) => ({ value, error: null }))
          .catch((error) => ({ value: null, error })),
      ]).then(([profile, subscription, billing]) => {
        if (!active) return;
        setKaypalProfile(profile.value);
        setKaypalSubscription(subscription.value);
        setKaypalBilling(billing.value);
        const errors = [profile.error, subscription.error, billing.error]
          .map((error) =>
            error instanceof Error ? error.message : String(error || ""),
          )
          .join(" ");
        setKaypalSyncRequired(
          /授权|过期|失效|未登录|unauthorized|401/i.test(errors),
        );
      });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshKaypalState();
    };

    refreshKaypalState();
    const refreshTimer = window.setInterval(refreshKaypalState, 30_000);
    window.addEventListener("focus", refreshKaypalState);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshKaypalState);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [currentUser]);

  React.useEffect(() => {
    if (!currentUser) {
      setTenantMemberships([]);
      setActiveTenantId("");
      return;
    }
    let active = true;
    void authApi
      .tenants()
      .then((memberships) => {
        if (!active) return;
        setTenantMemberships(memberships);
        const stored = window.localStorage.getItem(ACTIVE_TENANT_KEY) || "";
        const selected = memberships.some((item) => item.tenantId === stored)
          ? stored
          : memberships.length === 1
            ? memberships[0].tenantId
            : "";
        setActiveTenantId(selected);
        if (selected) window.localStorage.setItem(ACTIVE_TENANT_KEY, selected);
      })
      .catch(() => {
        if (active) setTenantMemberships([]);
      });
    return () => {
      active = false;
    };
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await authApi.logout();
      toast.success("已退出登录");
    } catch {
      toast.error("退出失败，请稍后重试");
    } finally {
      setLoggingOut(false);
      router.replace("/login");
      router.refresh();
    }
  };
  const displayName =
    kaypalProfile?.displayName ||
    currentUser?.name ||
    currentUser?.username ||
    "当前用户";
  const localPlan = currentUser?.kaypalPlanExpired
    ? null
    : currentUser?.kaypalPlan;
  const planLabel = kaypalSyncRequired
    ? "需登录"
    : formatPlanLabel(
        kaypalSubscription?.plan || getBillingPlan(kaypalBilling) || localPlan,
      );
  const creditLabel = kaypalSyncRequired
    ? "需登录"
    : formatCredits(kaypalBilling?.balance?.balance);
  const activeToolCode = searchParams.get("tool") || "";
  const activeToolEntry = toolEntryDefinitions[activeToolCode] || null;
  const activeRunId = (searchParams.get("runId") || "").trim();

  // 旧路径别名重定向（admin → capabilities/apps 等迁移映射；APK 内不再渲染 admin 后台）
  React.useEffect(() => {
    if (authLoading || !pathname) return;
    const alias = routeAliases[pathname];
    if (alias && alias !== pathname) {
      router.replace(alias);
    }
  }, [pathname, authLoading, router]);

  if (authLoading) {
    return <DashboardLayoutFallback />;
  }
  return (
    <AppShell
      footer={
        <>
          <DashboardFooter appVersion={DESKTOP_APP_VERSION} />
          <ElectronUpdateBanner />
        </>
      }
      user={{
        displayName,
        planLabel,
        creditLabel,
        avatarUrl: kaypalProfile?.avatarUrl || undefined,
        onLogout: handleLogout,
        loggingOut,
      }}
      tenant={{
        memberships: tenantMemberships,
        activeTenantId,
        onChange: (tenantId) => {
          if (!tenantId) return;
          window.localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
          setActiveTenantId(tenantId);
          window.location.reload();
        },
      }}
    >
      {activeRunId ? <SolutionRunContextBanner runId={activeRunId} /> : null}
      {activeToolEntry ? (
        <BusinessToolEntryPanel
          entry={activeToolEntry}
          toolCode={activeToolCode}
        />
      ) : null}
      {children}
    </AppShell>
  );
}
