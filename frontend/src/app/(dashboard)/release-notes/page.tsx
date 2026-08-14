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
import { useIsMobile } from "@/lib/hooks/use-media-query";

const currentVersion = "1.1.84";

const highlights = [
  {
    title: "登录页微信登录修复",
    text: "微信登录入口改为跳转方式（桌面端跳微信扫码、登录后自动回来），去掉扫码后无反应的二维码展示。",
    icon: <RefreshCw className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "旧入口路由归一",
    text: "旧任务控制台/文章库/客户详情/企微助手等旧入口统一重定向到规范路由，减少重复入口的维护成本。",
    icon: <BadgeCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "安装或从旧版本自动更新后，应用会等待本地服务就绪，再进入登录和工作台。",
  "本机账号凭据会跨版本保留，无需因为普通版本更新而重新生成。",
  "首次使用微信联系人/数据功能时，会自动下载所需本地组件（校验通过后生效）。",
  "从今日、内容、客户、消息进入常用能力，看到的是统一、克制的商业化图标。",
  "没有任务在跑时，浏览器窗口不会再自己弹出打扰工作。",
];

const improvements = [
  "登录页「微信扫码」改为「微信登录」跳转入口，登录体验更可靠。",
  "旧任务控制台/文章库/客户详情/企微助手等旧入口重定向到规范路由。",
  "趋势雷达、报告生成等情报文案去掉第三方品牌露出。",
  "版本号、更新说明统一更新到 v1.1.84。",
];

const fixedIssues = [
  "修复登录页微信扫码后桌面端无反应（二维码回调地址不可达，改为跳转登录）。",
  "修复语音识别/合成接口 /api 前缀重复导致请求失败。",
  "修复企微 CRM 页面切换配置不刷新数据（effect 依赖缺失）。",
  "修复静态服务器遇到畸形 URL 崩溃（decodeURIComponent 未捕获异常）。",
  "比价/返利页补「返回上一级」按钮。",
];

const notes = [
  "v1.1.60 是根据 Windows 真机日志修复的启动版本；真实发布和真实互动仍需要用户在现场完成账号登录与人工确认。",
  "系统情报中的部分第三方数据能力需要你自行配置对应的数据服务凭据；JIUZHANG AI 套餐和积分不能替代第三方凭据。",
  "预览任务和只读分析不会执行群发、加好友、朋友圈发布或其他外部动作。",
  "运营助理不会未经审批或确认自动提交；公众号真实草稿和正式发布分别需要人工确认。",
  "真实操作仍需要本机助手、账号、目标、内容与权限检查全部通过。",
  "Windows 安装包需要在 Windows 构建环境上生成，确保运行组件与系统环境匹配。",
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

/* 移动端原生视图（mx-* 明德 VP 风格）——release-notes */
function MobileTextList({ items }: { items: string[] }) {
  return (
    <ul style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((item) => (
        <li
          key={item}
          style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--mx-ink)" }}
        >
          <CheckCircle2
            width={14}
            height={14}
            style={{ color: "#059669", flexShrink: 0, marginTop: 2 }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function MobileSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mx-card" style={{ padding: 14 }}>
      <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginBottom: 10 }}>{title}</p>
      <MobileTextList items={items} />
    </div>
  );
}

export default function ReleaseNotesPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">更新说明</div>
            <div className="mx-page-sub">重点解决 Windows 安装后本地服务无法启动的问题</div>
          </div>

          {/* 版本横幅 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 15 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="mx-badge mx-badge-blue" style={{ fontSize: 10.5 }}>最新版本</span>
              <span className="mx-badge mx-badge-green" style={{ fontSize: 10.5 }}>功能完整保留</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "var(--mx-ink)" }}>v{currentVersion}</span>
              <span style={{ fontSize: 11, color: "var(--mx-muted)" }}>更新说明</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--mx-muted)", marginTop: 6, lineHeight: 1.6 }}>
              这次更新重点解决 Windows 安装后本地服务无法启动的问题，并加强账号凭据保护和安装包发布前自测。
            </p>
          </div>

          {/* 三个亮点 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>本次亮点</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {highlights.map((item) => (
              <div key={item.title} className="mx-card" style={{ padding: 13, display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "#d98a2d", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{item.title}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 4, lineHeight: 1.55 }}>{item.text}</span>
                </span>
              </div>
            ))}
          </div>

          {/* 各段落 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>详细内容</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MobileSection title="用户可以怎么用" items={userScenarios} />
            <MobileSection title="体验优化" items={improvements} />
            <MobileSection title="已修复的问题" items={fixedIssues} />
            <MobileSection title="仍需注意" items={notes} />
          </div>
        </div>
      </div>
    );
  }

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
