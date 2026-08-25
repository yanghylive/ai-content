"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";

interface VideoGenTask {
  taskId: string;
  status: "pending" | "processing" | "done" | "failed";
  videoUrl?: string;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

/** 历史任务条目（localStorage 持久化：刷新/重开不丢） */
interface VideoGenHistoryEntry extends VideoGenTask {
  prompt: string;
  createdAt: number;
}

const HISTORY_KEY = "seedance_video_history_v1";
const HISTORY_MAX = 20;

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
  const [history, setHistory] = useState<VideoGenHistoryEntry[]>([]);
  /** 待确认的提示词（先确认再提交，F6 素材提示词确认入库） */
  const [confirmPrompt, setConfirmPrompt] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as VideoGenHistoryEntry[]);
    } catch {
      /* localStorage 不可用则忽略 */
    }
  }, []);

  const saveHistory = useCallback((next: VideoGenHistoryEntry[]) => {
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, HISTORY_MAX)));
    } catch {
      /* 超限/不可用忽略 */
    }
  }, []);

  const upsertHistory = useCallback(
    (entry: VideoGenHistoryEntry) => {
      const rest = history.filter((h) => h.taskId !== entry.taskId);
      saveHistory([entry, ...rest]);
    },
    [history, saveHistory],
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const submit = async () => {
    if (!prompt.trim()) {
      setError("先描述你要生成的画面，比如：一只橘猫在阳光下打哈欠");
      return;
    }
    setSubmitting(true);
    setError(null);
    setTask(null);
    setConfirmPrompt(null);
    try {
      const data = await api.post<{ taskId: string }>("/redfox/video/gen", {
        prompt: prompt.trim(),
        ratio,
      });
      const entry: VideoGenHistoryEntry = {
        taskId: data.taskId,
        status: "pending",
        prompt: prompt.trim(),
        createdAt: Date.now(),
      };
      upsertHistory(entry);
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
      // 同步历史状态（含已提交但页面刷新丢失轮询的任务）
      setHistory((prev) =>
        prev.map((h) => (h.taskId === taskId ? { ...h, ...data } : h)),
      );
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

  const resumePoll = (entry: VideoGenHistoryEntry) => {
    if (entry.status === "done" || entry.status === "failed") {
      setTask(entry);
      return;
    }
    setError(null);
    setTask({ taskId: entry.taskId, status: entry.status });
    setPolling(true);
    void poll(entry.taskId);
  };

  const statusLabel = (s: VideoGenTask["status"]) =>
    s === "done" ? "✅ 成片" : s === "failed" ? "❌ 失败" : "⏳ 生成中";

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">Seedance 快速生成</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">文字/图片 → AI 视频（约 1-3 分钟）</p>
        </div>
      </div>

      <section className="mx-px" style={{ marginTop: 14 }}>
        <div
          className="kx-card"
          style={{
            borderRadius: 20,
            padding: 16,
            background: "rgba(255,255,255,.72)",
            border: "1px solid rgba(148,163,184,.18)",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "var(--kaypal-v3-ink)" }}>
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
              color: "var(--kaypal-v3-ink)",
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
                  color: ratio === r.value ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-soft-ink)",
                  fontSize: 13,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", margin: "12px 0 0" }}>
            Seedance 2.0 模型 · 单次约 150 积分 · 生成约 1-3 分钟
          </p>
          {error && (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", margin: "10px 0 0" }}>{error}</p>
          )}

          {confirmPrompt === null ? (
            <button
              type="button"
              className="mx-btn-gold"
              disabled={submitting}
              onClick={() => {
                if (!prompt.trim()) {
                  setError("先描述你要生成的画面，比如：一只橘猫在阳光下打哈欠");
                  return;
                }
                setError(null);
                setConfirmPrompt(prompt.trim());
              }}
              style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "12px", opacity: submitting ? 0.6 : 1 }}
            >
              下一步：确认提示词
            </button>
          ) : (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "rgba(16,185,129,.06)",
                border: "1px solid rgba(16,185,129,.25)",
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8", color: "var(--kaypal-v3-success)" }}>
                📝 确认提示词（生成后自动存入素材库）
              </p>
              <p style={{ fontSize: 13, color: "var(--kaypal-v3-ink)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {confirmPrompt}
              </p>
              <p style={{ fontSize: 12, color: "#6b7a93", margin: "10px 0 0" }}>
                画幅：{RATIOS.find((r) => r.value === ratio)?.label} · 预计消耗 150 积分
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setConfirmPrompt(null)}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,.35)",
                    background: "#fff",
                    fontSize: 13,
                    color: "#6b7a93",
                  }}
                >
                  返回修改
                </button>
                <button
                  type="button"
                  className="mx-btn-gold"
                  disabled={submitting}
                  onClick={() => void submit()}
                  style={{ flex: 1, padding: "10px", fontSize: 13, opacity: submitting ? 0.6 : 1 }}
                >
                  {submitting ? "提交中…" : "确认生成"}
                </button>
              </div>
            </div>
          )}
        </div>

        {task && (
          <div
            className="kx-card"
            style={{
              borderRadius: 20,
              padding: 16,
              marginTop: 12,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--kaypal-v3-ink)" }}>
              生成任务 {task.taskId.slice(-8)}
              {polling && <span style={{ fontSize: 12, color: "var(--kaypal-v3-amber)", marginLeft: 8 }}>⏳ 生成中…</span>}
            </p>
            {task.status === "done" && (
              <>
                <p style={{ fontSize: 12, color: "var(--kaypal-v3-success)", margin: "10px 0 0" }}>
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
                      color: "var(--kaypal-v3-success)",
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
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", margin: "10px 0 0" }}>
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
        {history.length > 0 && (
          <div
            className="kx-card"
            style={{
              borderRadius: 20,
              padding: 16,
              marginTop: 12,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10", color: "var(--kaypal-v3-ink)" }}>
              历史任务（{history.length}）
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((h) => (
                <button
                  key={h.taskId}
                  type="button"
                  onClick={() => resumePoll(h)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,.25)",
                    background: "#fff",
                    fontSize: 12,
                    color: "var(--kaypal-v3-soft-ink)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      marginRight: 8,
                      fontSize: 11,
                      color: h.status === "done" ? "var(--kaypal-v3-success)" : h.status === "failed" ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-amber)",
                    }}
                  >
                    {statusLabel(h.status)}
                  </span>
                  {h.prompt.length > 26 ? `${h.prompt.slice(0, 26)}…` : h.prompt}
                  <span style={{ float: "right", color: "var(--kaypal-v3-muted)" }}>
                    {new Date(h.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", margin: "10px 0 0" }}>
              点击历史任务可重新查看状态；成片均已自动存入素材库
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
