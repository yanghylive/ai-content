"use client";
import { useState } from "react";
import { Textarea } from "@/components/agent-cockpit-canvas/ui/textarea";
import { Button } from "@/components/agent-cockpit-canvas/ui/button";
import { ArrowUp, Square } from "lucide-react";

export type SidebarInputProps = {
  inProgress?: boolean;
  onSend: (message: string) => void | Promise<void>;
  onStop?: () => void;
  hideStopButton?: boolean;
};

export function SidebarInput({
  inProgress,
  onSend,
  onStop,
  hideStopButton,
}: SidebarInputProps) {
  const [text, setText] = useState("");
  const canSend = !inProgress && text.trim().length > 0;

  const submit = async () => {
    if (canSend) {
      setText("");
      await onSend(text);
    }
  };
  return (
    <div className="p-3 px-4 bg-card">
      <div className="relative mx-auto max-w-none">
        <div className="rounded-[10px] border border-border/80 bg-card shadow-sm px-3 py-2 flex items-end gap-2 transition-all duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_hsl(var(--agent-cockpit-primary)_/_0.08),0_2px_8px_-2px_hsl(var(--agent-cockpit-primary)_/_0.08)]">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入问题或任务目标"
            className="min-h-20 border-0 focus-visible:ring-0 resize-none shadow-none max-h-48 pb-4 px-2 bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {inProgress && !hideStopButton ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={onStop}
              title="停止生成"
              className="text-destructive hover:text-white bg-destructive/10 hover:bg-destructive"
            >
              <Square className="size-3 animate-pulse" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="default"
              disabled={!canSend}
              onClick={submit}
              title="发送"
              className="disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-11 text-muted-foreground text-center">
          按 Enter 发送，Shift + Enter 换行
        </p>
      </div>
    </div>
  );
}
