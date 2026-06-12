import { KaypalChatRuntime } from "@/components/agent-cockpit-canvas/chat/kaypal-chat-runtime";
import { SidebarInput } from "@/components/agent-cockpit-canvas/chat/layout/input";
import { AssistantBubble } from "@/components/agent-cockpit-canvas/chat/layout/assistant-message";
import { UserBubble } from "@/components/agent-cockpit-canvas/chat/layout/user-message";
import { Suggestions } from "@/components/agent-cockpit-canvas/chat/layout/suggestion";
import { cn } from "@/lib/agent-cockpit-canvas/utils";
import { Header } from "@/components/agent-cockpit-canvas/chat/layout/header";
interface ChatProps {
  className: string;
}

export function Chat({ className }: ChatProps) {
  return (
    <div className={cn(className, "p-4 max-w-[500px]")}>
      <div className="h-full min-h-0 rounded-2xl border bg-card shadow-xl overflow-hidden flex flex-col">
        <Header />
        <KaypalChatRuntime
          className="flex-1 min-h-0"
          labels={{
            initial:
              "这里是 Kaypal Agent 操作驾驶台。\n\n当前页面采用左侧对话 + 右侧持续工作区。你可以先说目标；普通问答只在聊天里完成，需要本机动作时才会生成任务草稿、预览、确认和证据。",
          }}
          suggestions={[
            {
              title: "本机电脑任务",
              message:
                "打开浏览器，帮我准备一个受控任务草稿，用来检查未回复评论。",
            },
            {
              title: "普通聊天任务",
              message:
                "帮我写一个回复方案，不创建真实本机任务。",
            },
            {
              title: "当前证据说明",
              message:
                "说明驾驶台应该怎样汇总当前任务的证据和确认项。",
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
