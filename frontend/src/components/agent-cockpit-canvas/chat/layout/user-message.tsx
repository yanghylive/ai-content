"use client";
import { Card, CardContent } from "@/components/agent-cockpit-canvas/ui/card";

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return content == null ? "" : String(content);
}

export function UserBubble({
  message,
}: {
  message?: { content?: unknown };
}) {
  const content = toText(message?.content);
  return (
    <div className="flex justify-end mb-4 mt-4">
      <Card className="max-w-[80%] bg-accent/10 text-card-foreground border border-accent/40 rounded-lg text-sm whitespace-pre-wrap p-0">
        <CardContent className="px-3 py-2">{content}</CardContent>
      </Card>
    </div>
  );
}
