"use client";
import { Markdown } from "@/components/agent-cockpit-canvas/chat/layout/markdown";
import { Cursor } from "@/components/agent-cockpit-canvas/chat/layout/cursor";

export type AssistantBubbleProps = {
  message?: {
    content?: string;
    generativeUI?: () => React.ReactNode;
  };
  isGenerating?: boolean;
  isLoading?: boolean;
};

export function AssistantBubble({
  message,
  isGenerating,
  isLoading,
}: AssistantBubbleProps) {
  const content = message?.content ?? "";

  if (!message) return null;
  if (!content && !isLoading && !isGenerating && !message.generativeUI) {
    return null;
  }

  if (isLoading && !message.generativeUI) return <Cursor className="mt-3" />;

  return (
    <div className="py-2">
      <div className="text-foreground rounded-lg p-3">
        <Markdown content={content} />
      </div>

      {message.generativeUI?.()}
    </div>
  );
}
