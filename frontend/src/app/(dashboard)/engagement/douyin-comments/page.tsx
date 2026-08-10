"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { ChannelConsole } from "../_components/channel-console";

export default function DouyinCommentsPage() {
  return (
    <DesktopOnlyGate
      title="抖音评论控制台需在电脑端使用"
      desc="评论读取、AI 回复生成与批量确认需要配合电脑端抖音网页版登录态，手机端暂不支持。你可以在手机上查看评论洞察与数据。"
      backHref="/engagement/comment-insights"
    >
      <ChannelConsole
        config={{
          title: "抖音评论",
          subtitle: "读取真实评论，AI 写好回复，你确认后发出去",
          taskTypeLabel: "抖音评论回复",
          taskType: "douyin-comment-reply",
          businessRoute: "comments",
          accountType: 3,
          platformName: "抖音",
          entryType: "douyin:comment",
          cdpPlatform: "douyin",
          startButtonLabel: "开始处理评论",
          emptyHint: "暂无评论任务",
        }}
      />
    </DesktopOnlyGate>
  );
}
