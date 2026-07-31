"use client";

import { ChannelConsole } from "../_components/channel-console";

export default function WechatChannelCommentsPage() {
  return (
    <ChannelConsole
      config={{
        title: "视频号评论",
        subtitle: "读取真实评论，AI 写好回复，你确认后发出去",
        taskTypeLabel: "视频号评论回复",
        taskType: "wechat-channel-comment-reply",
        businessRoute: "channel-comments",
        accountType: 2,
        platformName: "视频号",
        entryType: "wechat-channel:comment",
        cdpPlatform: "wechat-channel",
        startButtonLabel: "开始处理评论",
        emptyHint: "暂无评论任务",
      }}
    />
  );
}
