"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed">
      <div className="word-wrap-normal break-words hyphens-auto">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
