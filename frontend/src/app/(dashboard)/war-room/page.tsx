"use client";

import { CapabilityInfoPage } from "../capabilities/capability-info-page";

export default function WarRoomPage() {
  return (
    <CapabilityInfoPage
      title="运营战情室"
      description="集中查看高风险任务、跨平台状态和处理进度。"
      icon="solar:radar-2-linear"
      primaryAction={{
        label: "查看工作台总览",
        href: "/",
        icon: "solar:home-2-linear",
      }}
      secondaryActions={[
        {
          label: "任务历史",
	          href: "/tasks/records",
          icon: "solar:clipboard-list-linear",
        },
        {
          label: "结果留存",
	          href: "/tasks/evidence",
          icon: "solar:document-text-linear",
        },
        {
          label: "运行明细",
          href: "/local-engine?tab=logs",
          icon: "solar:plain-2-linear",
        },
      ]}
      items={[
        {
          title: "跨平台执行态势",
          description: "汇总发布、评论、私信和素材流程中的异常任务。",
          icon: "solar:graph-up-linear",
        },
        {
          title: "高风险操作留痕",
          description:
            "需要人工确认的桌面控制、账号登录和发布动作统一落到结果留存。",
          icon: "solar:shield-warning-linear",
        },
        {
          title: "本机助手健康",
          description:
            "浏览器控制、桌面权限、文件访问和运行明细通过本机助手页继续检查。",
          icon: "solar:server-path-linear",
        },
      ]}
    />
  );
}
