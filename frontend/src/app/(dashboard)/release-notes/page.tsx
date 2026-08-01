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

const currentVersion = "1.1.57";

const highlights = [
  {
    title: "全新 Astryx 设计系统界面",
    text: "全站页面改版为统一的新一代设计系统，原有导航结构与功能入口完整保留，操作更顺手、反馈更清晰。",
    icon: <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "登录更稳",
    text: "授权会话过期可以一键重新授权，桌面会话自动检测，授权完成后稳定进入系统。",
    icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "布局更顺",
    text: "页脚在内容不足一屏时自动停留在屏幕最底部；助手对话页满宽满高，视野不再被压缩。",
    icon: <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "在全站新版界面中使用原有全部功能，导航与入口位置保持熟悉。",
  "授权登录过期后在登录页直接重新授权，无需重装或清理数据。",
  "在助手页与白龙马对话，界面满宽满高，长对话不再挤压。",
  "在获客与客户互动中使用真实执行能力，执行前仍可先预览确认。",
];

const improvements = [
  "全站界面升级至 Astryx 设计系统，视觉与交互体系统一。",
  "品牌展示层全站统一为 JIUZHANG AI。",
  "版本更新说明统一收敛到本页面，页脚只保留版本号与入口。",
  "页脚在内容不足一屏时自动停留在屏幕最底部。",
  "助手对话页（白龙马）满宽满高显示，不再出现窄卡片与下方空白。",
  "登录页补齐授权过期处理、桌面会话检测与轮询重试。",
  "获客、客户互动、CRM、增长、计费、合规、内容优化等后端能力全量上线。",
  "发布执行支持抖音、视频号、小红书、快手与 B 站真实执行。",
];

const fixedIssues = [
  "修复授权完成后无法进入系统的问题：登录状态机补齐过期与桌面会话处理。",
  "修复部分页面页脚悬空、未贴合屏幕底部的问题。",
  "修复助手对话卡片被压缩成窄条、下方留有大片空白的问题。",
  "修复开发服务器与新版构建配置冲突导致无法启动的问题。",
  "修复版本更新条目直接展示在全局页脚、与专门页面内容不一致的问题。",
];

const notes = [
  "v1.1.57 沿用 v1.1.56 的验收口径；正式发布前仍需上线生产账号域名、修复官网证书并完成 Windows 代码签名。",
  "系统情报中的 RedFox 数据能力需要租户自行配置合法 RedFox API Key；JIUZHANG AI 套餐和积分不能替代第三方凭据。",
  "预览任务和只读分析不会执行群发、加好友、朋友圈发布或其他外部动作。",
  "运营助理不会未经审批或确认自动提交；公众号真实草稿和正式发布分别需要人工确认。",
  "真实操作仍需要本机助手、账号、目标、内容与权限检查全部通过。",
  "Windows 安装包以 Win10 真机账号验收为当前放行标准；Win11 不在本轮验收范围。",
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
                候选版本
              </Chip>
              <Chip variant="flat">功能完整保留</Chip>
            </div>
            <h1 className="text-[26px] font-bold leading-9 text-foreground">
              v{currentVersion} 更新说明
            </h1>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-default-600">
              这次更新重点是让微信任务、朋友圈、增长获客和客户详情的执行边界与失败恢复更清晰，
              同时保留 3010 全部现有功能与导航。
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
