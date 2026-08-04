"use client";

import { Card, CardBody, Chip } from "@heroui/react";
import {
  BadgeCheck,
  CheckCircle2,
  LayoutGrid,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

const currentVersion = "1.1.58";

const highlights = [
  {
    title: "账号状态更干净",
    text: "已清理本机历史平台账号和旧执行痕迹，重新登录后只看到当前真实可用账号，减少旧账号、旧任务带来的误判。",
    icon: <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "真实执行更可控",
    text: "发布、互动和账号动作继续保留人工确认边界，真实发送前可确认目标、内容和账号状态。",
    icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "界面更专业",
    text: "首页、内容、客户、消息等入口图标统一调整为 JIUZHANG AI 风格，小状态点改为系统紫色，去掉低幼感。",
    icon: <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "打开平台账号页后，从干净状态重新绑定抖音、小红书、视频号等账号。",
  "处理发布任务前，先看到需要确认的目标账号和内容，再决定是否真实发送。",
  "从今日、内容、客户、消息进入常用能力，看到的是统一、克制的商业化图标。",
  "暂未开放的视频工坊和换脸入口不再显示，避免误点到不可交付功能。",
];

const improvements = [
  "清空本机历史平台账号、账号健康、发布记录、真实执行会话和待确认历史。",
  "隐藏视频工坊与换脸入口，隐藏能力不纳入当前前端测试范围。",
  "功能卡片、导航、命令面板等入口图标统一调整为更稳重的线性图标。",
  "全局小状态点统一使用系统主紫色，视觉识别更一致。",
  "版本号、页脚、登录页和更新说明统一更新到 v1.1.58。",
  "Windows 自动更新配置继续使用 OSS generic feed，便于后续应用内检查更新。",
];

const fixedIssues = [
  "修复历史账号留存导致平台账号页显示旧账号、旧异常状态的问题。",
  "修复待确认历史堆积导致今日页和消息页出现旧任务数量的问题。",
  "修复隐藏能力仍从前端入口暴露的问题：视频工坊、换脸不再出现在主要入口。",
  "修复部分图标风格偏幼、与 Kaypal 官网视觉不一致的问题。",
  "修复版本展示分散造成登录页、页脚和更新说明不一致的问题。",
];

const notes = [
  "v1.1.58 是面向当前交付的稳定候选版本；真实发布和真实互动仍需要用户在现场完成账号登录与人工确认。",
  "系统情报中的 RedFox 数据能力需要租户自行配置合法 RedFox API Key；JIUZHANG AI 套餐和积分不能替代第三方凭据。",
  "预览任务和只读分析不会执行群发、加好友、朋友圈发布或其他外部动作。",
  "运营助理不会未经审批或确认自动提交；公众号真实草稿和正式发布分别需要人工确认。",
  "真实操作仍需要本机助手、账号、目标、内容与权限检查全部通过。",
  "Windows 安装包需要在 Windows runner 或 Windows 真机上构建，确保 Playwright Chromium 与 Prisma 原生引擎匹配 win-x64。",
];

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border border-divider bg-content1 shadow-sm">
      <CardBody className="gap-4 p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-default-100 text-default-700">
            {icon}
          </span>
          <h2 className="text-[16px] font-bold leading-6 text-foreground">
            {title}
          </h2>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function TextList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li
          key={item}
          className="flex gap-3 text-[14px] leading-6 text-default-700"
        >
          <CheckCircle2
            className="mt-1 h-4 w-4 shrink-0 text-success"
            strokeWidth={1.8}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReleaseNotesPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-8">
      <section className="rounded-[8px] border border-divider bg-content1 px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip color="primary" variant="flat">
                最新版本
              </Chip>
              <Chip variant="flat">功能完整保留</Chip>
            </div>
            <h1 className="text-[26px] font-bold leading-9 text-foreground">
              v{currentVersion} 更新说明
            </h1>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-default-600">
              这次更新重点是清理历史账号数据、收拢当前可交付能力、统一商业化视觉，并为 Windows 自动更新包发布做准备。
            </p>
          </div>
          <div className="rounded-[8px] border border-divider bg-background px-4 py-3 text-right">
            <div className="text-[11px] font-semibold leading-4 text-default-500">
              版本
            </div>
            <div className="text-[22px] font-bold leading-8 text-foreground">
              v{currentVersion}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {highlights.map((item) => (
          <div
            key={item.title}
            className="rounded-[8px] border border-divider bg-content1 p-4 shadow-sm"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary-50 text-primary">
              {item.icon}
            </div>
            <h2 className="text-[15px] font-bold leading-6 text-foreground">
              {item.title}
            </h2>
            <p className="mt-2 text-[13px] leading-6 text-default-600">
              {item.text}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="用户可以怎么用"
          icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.8} />}
        >
          <TextList items={userScenarios} />
        </SectionCard>

        <SectionCard
          title="体验优化"
          icon={<RefreshCw className="h-4 w-4" strokeWidth={1.8} />}
        >
          <TextList items={improvements} />
        </SectionCard>
      </div>

      <SectionCard
        title="已修复的问题"
        icon={<BadgeCheck className="h-4 w-4" strokeWidth={1.8} />}
      >
        <TextList items={fixedIssues} />
      </SectionCard>

      <SectionCard
        title="仍需注意"
        icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.8} />}
      >
        <TextList items={notes} />
      </SectionCard>
    </div>
  );
}
