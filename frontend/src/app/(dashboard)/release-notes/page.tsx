"use client";

import { Card, CardBody, Chip } from "@heroui/react";
import { BadgeCheck, CheckCircle2, RefreshCw, ShieldCheck } from "@/components/iconpark";
import type { ReactNode } from "react";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const currentVersion = "1.1.116";

const highlights = [
  {
    title: "私信回复更精准，不再回错人",
    text: "同一条私信不会被重复回复，不同人发来同样的话也不会回错对象；只有能精确定位到具体消息时才自动回复，定位不到就交给人工审核，绝不乱发。",
    icon: <BadgeCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "账号数据自愈更安全",
    text: "账号数据异常自动修复时，会先完整备份、失败能回滚，不再可能出现「已写入的数据丢失」的情况。",
    icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "历史线索不再「看不见」",
    text: "历史线索会正确归属到对应组织；归属有歧义的线索会进入专门的管理入口，由管理员手动指定，不再悄悄消失。",
    icon: <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "页面数据加载失败时，会看到明确的失败原因和「重新加载」按钮，而不是空白或旧数据。",
  "获客任务失败时，失败原因以人话展示（如验证码待处理、平台页面变更），并给出下一步指引。",
  "从旧版本自动更新后，应用会等待本地服务就绪，再进入登录和工作台。",
  "首次使用微信联系人/数据功能时，会自动下载所需本地组件（校验通过后生效）。",
];

const improvements = [
  "报错透明度：16 个页面加载失败上屏 + 重试（首页/获客/CRM/微信任务/引擎健康/素材/发布等）。",
  "获客失败人话标签覆盖 4 个展示位；获客中心 15 秒轮询新失败弹提醒（仅限停留页面时）。",
  "获客任务执行记录行展示后端原始失败信息，不再只显示状态。",
  "反爬拦截时截图 + 视觉模型自动恢复候选（验证码页也能读出部分线索）。",
];

const fixedIssues = [
  "修复旧数据库升级后「AI 模型同步」失败：platform_id 空值启动时自动回填/清理孤儿行，用户无需任何操作。",
  "修复抖音滑块验证被误报为「平台变更」：真实验证页文案已纳入识别，提示改为可行动指引（手动过验证 + 拉大执行间隔）。",
  "修复移动端误留 AI 助手悬浮按钮：AI 对话保留在智能体页与命令面板搜索入口。",
  "修复悬浮球遗留配置：1.1.105 之前版本的存量悬浮球设置在升级后启动自动清理。",
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
          <h2 className="text-base font-bold leading-6 text-foreground">
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
          className="flex gap-3 text-14 leading-6 text-default-700"
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
          style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.6, color: "var(--kaypal-v3-ink)" }}
        >
          <CheckCircle2
            width={14}
            height={14}
            style={{ color: "var(--kaypal-v3-success)", flexShrink: 0, marginTop: 2 }}
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
      <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--kaypal-v3-ink)", marginBottom: 10 }}>{title}</p>
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
              <span style={{ fontSize: 20, fontWeight: 800, color: "var(--kaypal-v3-ink)" }}>v{currentVersion}</span>
              <span style={{ fontSize: 11, color: "var(--kaypal-v3-muted)" }}>更新说明</span>
            </div>
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginTop: 6, lineHeight: 1.6 }}>
              这次更新重点解决 Windows 安装后本地服务无法启动的问题，并加强账号凭据保护和安装包发布前自测。
            </p>
          </div>

          {/* 三个亮点 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>本次亮点</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {highlights.map((item) => (
              <div key={item.title} className="mx-card" style={{ padding: 13, display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "var(--kaypal-v3-amber)", flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)" }}>{item.title}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4, lineHeight: 1.55 }}>{item.text}</span>
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
            <h1 className="kx-greet leading-9 text-foreground">
              v{currentVersion} 更新说明
            </h1>
            <p className="mt-2 max-w-3xl text-14 leading-6 text-default-600">
              这次更新重点解决 Windows 安装后本地服务无法启动的问题，并加强账号凭据保护和安装包发布前自测。
            </p>
          </div>
          <div className="rounded-[8px] border border-divider bg-background px-4 py-3 text-right">
            <div className="text-11 font-semibold leading-4 text-default-500">
              版本
            </div>
            <div className="text-2xl font-bold leading-8 text-foreground">
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
            <h2 className="text-14 font-bold leading-6 text-foreground">
              {item.title}
            </h2>
            <p className="mt-2 text-13 leading-6 text-default-600">
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
