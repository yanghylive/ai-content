"use client";

import { ChannelConsole } from "../_components/channel-console";

export default function DouyinCommentsPage() {
  return (
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
  );
}
