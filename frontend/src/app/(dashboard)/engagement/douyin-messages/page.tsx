"use client";

import { ChannelConsole } from "../_components/channel-console";

export default function DouyinMessagesPage() {
  return (
    <ChannelConsole
      config={{
        title: "抖音私信",
        subtitle: "读取真实私信，AI 写好回复，你确认后发出去",
        taskTypeLabel: "抖音私信回复",
        taskType: "douyin-direct-message-reply",
        businessRoute: "messages",
        accountType: 3,
        platformName: "抖音",
        entryType: "douyin:message",
        cdpPlatform: "douyin",
        startButtonLabel: "开始回私信",
        emptyHint: "暂无私信任务",
      }}
    />
  );
}
