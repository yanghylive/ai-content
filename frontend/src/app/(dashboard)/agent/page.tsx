"use client";

import React from "react";
import { ShellIcon } from "@/components/shell/icons";
import { AiAssistant } from "@/components/shell/ai-assistant";

/**
 * 助手页 = 手机 App「AI 助手」同款对话（ai-gateway SSE 流式）。
 * 与手机端共用 AiAssistant 组件：同一套对话、工具调用与积分链路。
 */
export default function AgentPage() {
  return (
    <div className="kx-chat-view" style={{ maxWidth: "none", padding: "14px 24px 20px", flex: "1 0 auto", display: "flex", flexDirection: "column", minHeight: 0, height: "auto" }}>
      {/* 顶部状态条：AI 助手（手机同款） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderBottom: "1px solid var(--kx-border)",
          background: "var(--kx-card)",
        }}
      >
        <div
          className="kx-msg-ava"
          style={{
            width: 28,
            height: 28,
            background: "var(--kx-accent-soft)",
            color: "var(--kx-accent-ink)",
          }}
        >
          <ShellIcon name="mic" />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>AI 助手</span>
        <span style={{ fontSize: 11.5, color: "var(--kx-muted)" }}>
          与手机 App 同一套 AI 对话
        </span>
        <div style={{ flex: 1 }} />
      </div>

      {/* 主体：手机 App「AI 助手」同款对话（ai-gateway，内嵌模式） */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          marginTop: 14,
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
