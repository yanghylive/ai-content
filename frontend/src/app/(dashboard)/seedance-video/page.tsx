"use client";

import React, { useState } from "react";
import { api } from "@/lib/api/client";

interface VideoGenTask {
  taskId: string;
  status: "pending" | "processing" | "done" | "failed";
  videoUrl?: string;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

const RATIOS = [
  { value: "9:16", label: "9:16 竖屏（抖音/视频号）" },
  { value: "16:9", label: "16:9 横屏（B站/西瓜）" },
  { value: "1:1", label: "1:1 方形（小红书）" },
];

/**
 * Seedance 快速生成（A7/M6，主文档 P2）
 * RedFox seedance-video-gen：submit（150 积分）→ 轮询 result → 成片自动入素材库
 */
export default function SeedanceVideoPage() {
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<VideoGenTask | null>(null);
  const [polling, setPolling] = useState(false);

  const submit = async () => {
    if (!prompt.trim()) {
      setError("先描述你要生成的画面，比如：一只橘猫在阳光下打哈欠");
      return;
    }
    setSubmitting(true);
    setError(null);
    setTask(null);
    try {
      const data = await api.post<{ taskId: string }>("/redfox/video/gen", {
        prompt: prompt.trim(),
        ratio,
      });
      setTask({ taskId: data.taskId, status: "pending" });
      setPolling(true);
      void poll(data.taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const poll = async (taskId: string) => {
    try {
      const data = await api.get<VideoGenTask>(`/redfox/video/gen/${taskId}`);
      setTask(data);
      if (data.status === "done" || data.status === "failed") {
        setPolling(false);
        return;
      }
      setTimeout(() => void poll(taskId), 5000);
    } catch {
      setPolling(false);
      setError("查询任务状态失败");
    }
  };

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M10 9l5 3-5 3V9z" /></svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">Seedance 快速生成</h1>
            <p className="mx-page-sub">文字/图片 → AI 视频（约 1-3 分钟）</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        <div
          style={{
            borderRadius: 20,
            padding: 16,
            background: "rgba(255,255,255,.72)",
            border: "1px solid rgba(148,163,184,.18)",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
            描述你的视频画面
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="比如：一只橘猫在阳光下打哈欠，特写镜头，柔光"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,.35)",
              background: "#fff",
              fontSize: 14,
              color: "#1f2a44",
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <p style={{ fontSize: 12, color: "#6b7a93", margin: "12px 0 6" }}>画幅比例</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {RATIOS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRatio(r.value)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border:
                    ratio === r.value
                      ? "1px solid rgba(16,185,129,.5)"
                      : "1px solid rgba(148,163,184,.3)",
                  background: ratio === r.value ? "rgba(16,185,129,.08)" : "#fff",
                  color: ratio === r.value ? "#047857" : "#374151",
                  fontSize: 13,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#94a3b8", margin: "12px 0 0" }}>
            Seedance 2.0 模型 · 单次约 150 积分 · 生成约 1-3 分钟
          </p>
          {error && (
            <p style={{ fontSize: 12, color: "#dc2626", margin: "10px 0 0" }}>{error}</p>
          )}
          <button
            type="button"
            className="mx-btn-gold"
            disabled={submitting}
            onClick={() => void submit()}
            style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "12px", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "提交中…" : "开始生成"}
          </button>
        </div>

        {task && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              marginTop: 12,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "#1f2a44" }}>
              生成任务 {task.taskId.slice(-8)}
              {polling && <span style={{ fontSize: 12, color: "#f59e0b", marginLeft: 8 }}>⏳ 生成中…</span>}
            </p>
            {task.status === "done" && (
              <>
                <p style={{ fontSize: 12, color: "#047857", margin: "10px 0 0" }}>
                  🎬 成片已生成{task.filename ? `，已加入素材库（${task.filename}${task.sizeBytes ? `，${(task.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}）` : ""}
                </p>
                {task.videoUrl && (
                  <a
                    href={task.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "block",
                      textAlign: "center",
                      marginTop: 10,
                      padding: "10px",
                      borderRadius: 12,
                      background: "rgba(16,185,129,.1)",
                      color: "#047857",
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: "none",
                      border: "1px solid rgba(16,185,129,.25)",
                    }}
                  >
                    查看成片 ↗
                  </a>
                )}
              </>
            )}
            {task.status === "failed" && (
              <p style={{ fontSize: 12, color: "#dc2626", margin: "10px 0 0" }}>
                ❌ {task.error || "生成失败，请重试"}
              </p>
            )}
            {(task.status === "done" || task.status === "failed") && (
              <button
                type="button"
                onClick={() => {
                  setTask(null);
                  setPrompt("");
                }}
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: "10px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,.35)",
                  background: "transparent",
                  fontSize: 13,
                  color: "#6b7a93",
                }}
              >
                再来一条
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
