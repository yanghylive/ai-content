"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { localEngineApi } from "@/lib/api/local-engine";

export default function MessageScene() {
  const [waitingCount, setWaitingCount] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    localEngineApi
      .tasks(50)
      .then((tasks) => {
        if (!active) return;
        setWaitingCount(
          (Array.isArray(tasks) ? tasks : []).filter(
            (t) => t.status === "waiting_for_send_confirmation",
          ).length,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScenePage
      title="消息"
      sub="所有渠道的客户消息，一个地方处理"
      hint={
        waitingCount > 0
          ? {
              icon: "message",
              text: `${waitingCount} 条回复等你确认，AI 已写好草稿`,
              actionLabel: "去确认",
              href: "/tasks/confirmations",
            }
          : undefined
      }
      cards={[
        {
          icon: "messageSq",
          tint: "kx-t-slate",
          title: "AI 客服",
          desc: "教 AI 怎么帮你回客户，草稿你确认后发出",
          href: "/engagement",
          badge: waitingCount > 0 ? `${waitingCount} 待确认` : undefined,
        },
        {
          icon: "message",
          tint: "kx-t-slate",
          title: "抖音私信",
          desc: "私信和评论，读取真实的回复给你确认",
          href: "/engagement/douyin-messages",
        },
        {
          icon: "message",
          tint: "kx-t-cyan",
          title: "视频号私信",
          desc: "私信和评论",
          href: "/engagement/channel-messages",
        },
        {
          icon: "messageSq",
          tint: "kx-t-green",
          title: "微信",
          desc: "会话、群发、朋友圈、加好友",
          href: "/engagement/wechat",
        },
        {
          icon: "history",
          tint: "kx-t-slate",
          title: "互动记录",
          desc: "所有发出过的回复，可追溯",
          href: "/engagement/records",
        },
      ]}
    />
  );
}
