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

const currentVersion = "1.1.60";

const highlights = [
  {
    title: "Windows 可以正常启动",
    text: "修复安全密钥缺失导致的 3011 本地服务反复退出，登录授权和工作台可在后端就绪后正常打开。",
    icon: <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "账号凭据受系统保护",
    text: "首次运行会生成本机专属凭据密钥，由 Windows 系统安全能力保护，后续自动更新继续复用。",
    icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "更新包发布前会实测",
    text: "Windows 安装包生成后会真实启动包内后端并检查登录接口，未就绪的安装包不会进入更新源。",
    icon: <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "安装或从旧版本自动更新后，应用会等待 3011 本地服务就绪，再进入登录和工作台。",
  "本机账号凭据密钥会跨版本保留，无需因为普通版本更新而重新生成。",
  "处理发布任务前，先看到需要确认的目标账号和内容，再决定是否真实发送。",
  "从今日、内容、客户、消息进入常用能力，看到的是统一、克制的商业化图标。",
  "暂未开放的视频工坊和换脸入口不再显示，避免误点到不可交付功能。",
];

const improvements = [
  "首次运行自动生成 32 字节随机账号凭据密钥，通过 Electron safeStorage 和 Windows DPAPI 加密保存。",
  "凭据密钥保存在稳定的桌面应用数据目录，1.1.59 升级到 1.1.60 后继续复用。",
  "Windows 构建新增包内 Node、NestJS、Prisma、SQLite 和登录状态接口的完整启动自测。",
  "后端 NCC 动态 JavaScript 分块全部纳入安装包，避免部分功能运行时找不到分块。",
  "本地后端异常退出时记录退出代码和关键错误，启动失败提示可以直接显示诊断原因。",
  "Windows 桌面端启动本地后端时保留 SystemRoot、APPDATA、LOCALAPPDATA、USERPROFILE、TEMP/TMP 等系统关键环境变量。",
  "3011 本地服务异常时会在提示中显示日志目录，方便现场快速定位。",
  "清空本机历史平台账号、账号健康、发布记录、真实执行会话和待确认历史。",
  "隐藏视频工坊与换脸入口，隐藏能力不纳入当前前端测试范围。",
  "功能卡片、导航、命令面板等入口图标统一调整为更稳重的线性图标。",
  "全局小状态点统一使用系统主紫色，视觉识别更一致。",
  "版本号、页脚、登录页和更新说明统一更新到 v1.1.60。",
  "Windows 自动更新配置继续使用 OSS generic feed，便于后续应用内检查更新。",
];

const fixedIssues = [
  "修复 Windows 真机因缺少 KAYPAL_CREDENTIAL_MASTER_KEY 导致后端反复退出的问题。",
  "修复 Windows 真机安装后出现“本地服务启动超时 / 3011 后端服务还没有就绪”的问题。",
  "修复本地服务未 ready 时登录页只能显示“登录授权未能启动”的定位不足问题。",
  "修复历史账号留存导致平台账号页显示旧账号、旧异常状态的问题。",
  "修复待确认历史堆积导致今日页和消息页出现旧任务数量的问题。",
  "修复隐藏能力仍从前端入口暴露的问题：视频工坊、换脸不再出现在主要入口。",
  "修复部分图标风格偏幼、与 Kaypal 官网视觉不一致的问题。",
  "修复版本展示分散造成登录页、页脚和更新说明不一致的问题。",
];

const notes = [
  "v1.1.60 是根据 Windows 真机日志修复的启动版本；真实发布和真实互动仍需要用户在现场完成账号登录与人工确认。",
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
              这次更新重点解决 Windows 安装后本地服务无法启动的问题，并加强账号凭据保护和安装包发布前自测。
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
