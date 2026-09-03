"use client";

import React from "react";
import { AiAssistant } from "@/components/shell/ai-assistant";

/**
 * 助手页 = 手机 App「AI 助手」同款对话（ai-gateway SSE 流式）。
 * 与手机端共用 AiAssistant 组件：同一套对话、工具调用与积分链路。
 *
 * 顶部状态条已收敛进 AiAssistant 内嵌头部（标题 + 副标题），此处不再
 * 重复渲染，避免双层头部占用高度（2026-09-03 UI 收敛）。
 */
export default function AgentPage() {
  return (
    <div
      className="kx-chat-view"
      style={{
        maxWidth: "none",
        padding: "14px 24px 20px",
        flex: "1 0 auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "auto",
      }}
    >
      {/* 主体：手机 App「AI 助手」同款对话（ai-gateway，内嵌模式） */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--kx-card)",
          border: "1px solid var(--kx-border)",
          borderRadius: "var(--kx-radius)",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(42, 36, 56, 0.05), 0 3px 14px rgba(90, 70, 160, 0.08)",
        }}
      >
        <AiAssistant embedded />
      </div>
    </div>
  );
}
