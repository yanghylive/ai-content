"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/agent-cockpit-canvas/utils";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const USER_MESSAGE_EVENT = "kaypal-cockpit:user-message";
export type KaypalSuggestion = { title: string; message: string };
export type KaypalChatRuntimeProps = {
  className?: string;
  labels: { initial: string };
  suggestions: KaypalSuggestion[];
  Input: React.ComponentType<{
    inProgress?: boolean;
    onSend: (message: string) => void | Promise<void>;
    onStop?: () => void;
    hideStopButton?: boolean;
  }>;
  AssistantMessage: React.ComponentType<{
    message?: { content?: string; generativeUI?: () => React.ReactNode };
    isGenerating?: boolean;
    isLoading?: boolean;
  }>;
  UserMessage: React.ComponentType<{ message?: { content?: unknown } }>;
  RenderSuggestionsList: React.ComponentType<{
    suggestions: KaypalSuggestion[];
    onSuggestionClick: (message: string) => void;
    isLoading?: boolean;
  }>;
};
export function KaypalChatRuntime({
  className,
  labels,
  suggestions,
  Input,
  AssistantMessage,
  UserMessage,
  RenderSuggestionsList,
}: KaypalChatRuntimeProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "assistant-initial", role: "assistant", content: labels.initial },
  ]);

  const hasOnlyInitialMessage = useMemo(
    () => messages.length === 1 && messages[0]?.id === "assistant-initial",
    [messages],
  );

  const sendMessage = (content: string) => {
    const cleanContent = content.trim();
    if (!cleanContent) return;

    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: cleanContent,
      },
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content:
          "已收到。我会先把它整理成右侧当前任务草稿；涉及浏览器、发送、发布、删除或改文件的动作，只能先展示预览和确认卡，不会直接执行。",
      },
    ]);
    window.dispatchEvent(
      new CustomEvent(USER_MESSAGE_EVENT, {
        detail: { content: cleanContent },
      }),
    );
  };
  return (
    <div className={cn("flex flex-col bg-card", className)}>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {messages.map((message) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage key={message.id} message={message} />
          ),
        )}
        {hasOnlyInitialMessage && (
          <div className="mt-3">
            <RenderSuggestionsList
              suggestions={suggestions}
              onSuggestionClick={sendMessage}
              isLoading={false}
            />
          </div>
        )}
      </div>
      <Input inProgress={false} onSend={sendMessage} />
    </div>
  );
}
