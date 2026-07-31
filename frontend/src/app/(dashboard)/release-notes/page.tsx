"use client";

import { Card, CardBody, Chip } from "@heroui/react";
import {
  BadgeCheck,
  CheckCircle2,
  LayoutGrid,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";

const currentVersion = "1.1.56";

const highlights = [
  {
    title: "原有功能和导航完整保留",
    text: "本次只优化操作过程和结果反馈，没有删除、合并或隐藏 3010 已有的菜单、模块、字段与业务入口。",
    icon: <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "微信操作边界更清楚",
    text: "自动操作、确认后执行和只读分析会常驻显示。群发、加好友和朋友圈等任务只有收到逐对象结果后才计为完成。",
    icon: <MessageCircle className="h-5 w-5" strokeWidth={1.8} />,
  },
  {
    title: "增长结果更可信",
    text: "五种曝光明确区分预览与真实执行，并展示真实触达数量、部分成功、失败、未执行及对应原因。",
    icon: <Target className="h-5 w-5" strokeWidth={1.8} />,
  },
];

const userScenarios = [
  "在微信任务中选择自动发送、确认后发送或只看不发，并持续看到当前执行边界。",
  "在增长获客中先创建预览；只有能力检查通过时，页面才会开放真实外部动作。",
  "朋友圈计划链接缺少编号、无权限或不存在时，可以直接返回列表、新建计划或重新加载。",
  "AI 生成朋友圈新文案后，可以先对比预览，再决定采用或保留当前文案。",
  "客户档案链接失效或没有权限时，会显示原因和可用的返回入口。",
];

const improvements = [
  "JIUZHANG AI 桌面授权完成后会先创建并选中当前工作区，再进入业务页面；增长、CRM、应用安装和平台账号使用同一租户上下文。",
  "增长账号健康会读取当前工作区在发布中心的全部账号，不再被旧占位记录遮挡。",
  "视频号无法提取二维码时会保留受控浏览器会话，引导完成网页登录并在登录成功后自动完成绑定。",
  "BaiLongma 本地语音服务随桌面端真实启动，只有 3721 在线且账号授权验证通过时才显示可用。",
  "Agent 工作台在未配置可用模型时禁用运行并提供配置入口，正常的空产物不会再显示成服务错误。",
  "新建客服机器人先保存在本地草稿，取消不会写入机器人列表，只有明确保存才创建记录。",
  "Windows 真机测试候选连接当前已在线的 JIUZHANG AI 账号服务，授权码申请和确认页可以正常打开。",
  "现有导航结构与功能入口保持不变，原有能力不会因为交互对齐而减少。",
  "短视频评论获客支持创建或保存后立即执行，原有每天定时启动能力继续保留。",
  "浅色模式统一侧栏、顶部栏和导航层级配色，深色模式保持原有视觉与操作状态。",
  "新增小红书运营助理和公众号运营助理，生成内容包、执行过程与结果可以持续复核。",
  "公众号运营助理支持官方草稿写入与标题回读、正式发布前独立一次性确认和发布状态回查。",
  "平台授权不再向前端返回 Access Token，编辑时留空可保留原令牌；自定义发布地址只允许 HTTPS 白名单域名。",
  "内容库 HTML 编辑与预览加入 no-referrer 和 iframe 脚本隔离，阻止预览内容主动执行脚本。",
  "同步平台授权、公众号助理、小红书助理、内容库和 API 客户端的最新前端修正，真机安装包不再沿用 1.1.51 的旧构建。",
  "Windows 安装包不再在解压前启动阻断式 PowerShell 预检；必需运行时改由构建前和打包后守卫验证。",
  "微信任务常驻展示当前操作方式，并说明发送前检查和完成判定标准。",
  "只读分析不会发送消息、添加好友或发布朋友圈；确认模式不会跳过人工确认。",
  "增长曝光在能力未知、缺少配置或检查失败时只允许预览，不会误触发外部动作。",
  "曝光记录补充执行边界、真实触达数量和结果说明，部分成功不再显示成全部成功。",
  "朋友圈 AI 重写改为先预览、再采用，避免覆盖用户已经编辑的内容。",
  "异常页面提供明确原因和恢复操作，减少空白页与无法继续的情况。",
  "情报搜索只展示本次真实返回的数据；报告和任务运行链接会恢复到指定记录。",
  "设置页和客户详情页把当前页签写入链接，刷新、分享和前进后退都能恢复位置。",
  "客户档案、跟进草稿、欢迎消息和系统设置在离开前提示未保存修改。",
];

const fixedIssues = [
  "修复旧登录接口缺少请求体或字段时返回 500；现在统一返回可识别的 400 参数错误。",
  "修复桌面授权后的首屏租户空窗，以及增长、CRM、应用安装和发布账号可能选择不同工作区的问题。",
  "修复增长页面持续 403，以及发布中心已有账号但增长模块仍显示 0 个账号的问题。",
  "修复视频号登录页已打开但未提取二维码时被误判为绑定失败的问题。",
  "修复语音资源已打包但 3721 服务从未启动，以及账号授权令牌被误显示为语音已就绪的问题。",
  "修复客服机器人向导取消后仍创建重复机器人记录的问题。",
  "修复 Agent 缺少模型时仍发送运行请求，并把正常空产物级联成 500 的问题。",
  "修复安装包写入尚未上线的账号域名，导致登录授权码无法获取的问题。",
  "修复 Windows PowerShell 解析安装脚本失败，导致 Windows 10/11 在文件解压前被错误拦截的问题。",
  "修复短视频评论获客只有计划启动时间、缺少明确立即执行入口的问题。",
  "修复浅色模式仍使用近黑侧栏变量、与白色顶部栏视觉割裂的问题。",
  "修复朋友圈计划缺少编号时仍发起空请求的问题。",
  "修复朋友圈 AI 新文案可能直接覆盖当前编辑内容的问题。",
  "修复客户档案缺少编号、无权限或不存在时缺少清晰反馈的问题。",
  "修复增长任务部分成功、失败或未执行时结果反馈不准确的问题。",
  "统一部分页面的用户文案，减少内部技术词和容易误解的状态说明。",
  "修复增长预检确认与真实执行分成两个入口、容易绕过检查的问题。",
  "修复任务已完成但缺少必需结果证据时仍显示为完整成功的问题。",
];

const notes = [
  "v1.1.56 是真机测试候选包；正式发布前仍需上线生产账号域名、修复官网证书并完成 Windows 代码签名。",
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
