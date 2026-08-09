"use client";

import { ChannelConsole } from "../_components/channel-console";

export default function ChannelMessagesPage() {
  return (
    <ChannelConsole
      config={{
        title: "视频号私信",
        subtitle: "读取真实私信，AI 写好回复，你确认后发出去",
        taskTypeLabel: "视频号私信回复",
        taskType: "wechat-channel-direct-message-reply",
        businessRoute: "channel-messages",
        accountType: 2,
        platformName: "视频号",
        entryType: "wechat-channel:message",
        cdpPlatform: "wechat-channel",
        startButtonLabel: "开始回私信",
        emptyHint: "暂无私信任务",
      }}
    />
  );
}
