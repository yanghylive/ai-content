"use client";

import { KaypalChatRuntime } from "@/components/agent-cockpit-canvas/chat/kaypal-chat-runtime";
import { SidebarInput } from "@/components/agent-cockpit-canvas/chat/layout/input";
import { AssistantBubble } from "@/components/agent-cockpit-canvas/chat/layout/assistant-message";
import { UserBubble } from "@/components/agent-cockpit-canvas/chat/layout/user-message";
import { Suggestions } from "@/components/agent-cockpit-canvas/chat/layout/suggestion";
import { Header } from "@/components/agent-cockpit-canvas/chat/layout/header";
export function MobileChat() {
  return (
    <div className="h-dvh bg-background p-3">
      <div className="h-full min-h-0 rounded-[8px] border bg-card shadow-sm overflow-hidden flex flex-col">
        <Header />
        <KaypalChatRuntime
          className="flex-1 min-h-0"
          labels={{
            initial:
              "这里是 JIUZHANG AI Agent 操作驾驶台移动版。你可以先说目标；需要本机动作时，系统会先生成任务草稿和确认卡。",
          }}
          suggestions={[
            {
              title: "本机任务",
              message: "准备一个受控本机电脑任务草稿。",
            },
            {
              title: "只聊天",
              message: "只在聊天里回答，不创建任务。",
            },
          ]}
          Input={SidebarInput}
          AssistantMessage={AssistantBubble}
          UserMessage={UserBubble}
          RenderSuggestionsList={Suggestions}
        />
      </div>
    </div>
  );
}
