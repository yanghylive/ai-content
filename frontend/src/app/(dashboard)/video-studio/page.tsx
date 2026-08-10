"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";

interface PipelineInfo {
  value: string;
  label: string;
}

interface StageGate {
  name: string;
  passed: boolean;
  reason: string;
}

interface StageInfo {
  name: string;
  status: string;
  tool?: string;
  provider?: string;
  gates?: StageGate[];
}

interface VideoProject {
  id: string;
  title: string;
  pipeline: string;
  created_at?: string;
  progress?: string;
  stages?: StageInfo[];
  video?: { url?: string; bytes?: number } | null;
  halted?: { stage?: string } | null;
}

const STAGE_LABELS: Record<string, string> = {
  curation: "选题研究",
  script: "脚本撰写",
  storyboard: "分镜设计",
  compose: "画面合成",
  render: "渲染成片",
  hook: "黄金开头",
  outline: "大纲",
  scenes: "分场",
  cta: "结尾号召",
};

function stageStatusText(status: string): { text: string; color: string } {
  if (status === "done") return { text: "✅ 完成", color: "#10b981" };
  if (status === "running") return { text: "⏳ 进行中", color: "#f59e0b" };
  if (status === "pending") return { text: "排队中", color: "#94a3b8" };
  if (status === "skipped") return { text: "跳过", color: "#94a3b8" };
  if (status === "halted") return { text: "⛔ 中止", color: "#ef4444" };
  return { text: status, color: "#94a3b8" };
}

/**
 * 视频一键成片（studio_core 12 流水线直连）
 * 链路：选流水线 + 写选题 → POST /api/video/generate → SSE 实时进度 →
 * 成片下载 / 加入素材库
 */
export default function VideoStudioPage() {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [pipeline, setPipeline] = useState("news_brief");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<VideoProject[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshEngine = async () => {
    try {
      const data = await api.get<PipelineInfo[]>("/video/pipelines");
      setPipelines(data);
      setEngineOnline(data.length > 0);
      if (data.length > 0 && !data.some((p) => p.value === pipeline)) {
        setPipeline(data[0].value);
      }
    } catch {
      setEngineOnline(false);
    }
  };

  const refreshRecent = async () => {
    try {
      const data = await api.get<{ projects: VideoProject[]; total: number }>(
        "/video/projects?page=1&page_size=6",
      );
      setRecentProjects(data.projects);
    } catch {
      /* 列表失败静默 */
    }
  };

  useEffect(() => {
    void refreshEngine();
    void refreshRecent();
    return () => {
      if (sseRef.current) sseRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopWatching = () => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = (pid: string) => {
    stopWatching();
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.get<VideoProject>(`/video/projects/${pid}`);
        setProject(data);
        if (data.video) {
          stopWatching();
          void refreshRecent();
        }
      } catch {
        /* 轮询失败静默 */
      }
    }, 5000);
  };

  const createJob = async () => {
    if (!prompt.trim()) {
      setError("先填一个选题，比如：本周 AI 行业十大新闻");
      return;
    }
    setCreating(true);
    setError(null);
    setImported(null);
    try {
      const data = await api.post<{ project_id: string; status: string }>(
        "/video/generate",
        { pipeline, prompt: prompt.trim() },
      );
      setProjectId(data.project_id);
      const detail = await api.get<VideoProject>(
        `/video/projects/${data.project_id}`,
      );
      setProject(detail);
      // 优先 SSE 实时进度；SSE 断开时降级轮询
      try {
        const es = new EventSource(
          `/api/video/projects/${data.project_id}/events`,
        );
        sseRef.current = es;
        es.onmessage = (ev) => {
          try {
            const payload = JSON.parse(ev.data as string) as {
              projects?: VideoProject[];
            };
            const me = (payload.projects || []).find(
              (p) => p.id === data.project_id,
            );
            if (me) {
              setProject(me);
              if (me.video) {
                stopWatching();
                void refreshRecent();
              }
            }
          } catch {
            /* SSE 帧解析失败忽略 */
          }
        };
        es.onerror = () => {
          es.close();
          sseRef.current = null;
          startPolling(data.project_id);
        };
      } catch {
        startPolling(data.project_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建视频任务失败");
    } finally {
      setCreating(false);
    }
  };

  const importMaterial = async () => {
    if (!projectId) return;
    setImporting(true);
    setImported(null);
    try {
      const data = await api.post<{ filename: string; sizeBytes: number }>(
        `/video/projects/${projectId}/import-material`,
        {},
      );
      setImported(data.filename);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入素材失败");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    stopWatching();
    setProject(null);
    setProjectId(null);
    setPrompt("");
    setImported(null);
    setError(null);
    void refreshRecent();
  };

  const doneStages = (project?.stages || []).filter(
    (s) => s.status === "done",
  ).length;
  const totalStages = (project?.stages || []).length;

  return (
    <DesktopOnlyGate
      title="视频工作坊需在电脑端使用"
      desc="视频生成流水线（12 条）、实时进度与成片下载需要大屏与稳定网络，手机端暂不支持。你可以先在手机上用「素材采集」「AI 生图」「AI 配音」准备素材。"
      backHref="/content"
    >
      <div
        className="kx-mobile-ambient"
        style={{ minHeight: "100dvh", paddingBottom: 90 }}
      >
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M10 9l5 3-5 3V9z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">视频一键成片</h1>
            <p className="mx-page-sub">12 条流水线 · 选题材自动成片</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => {
              void refreshEngine();
              void refreshRecent();
            }}
          >
            刷新
          </button>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {/* Seedance 快速生成入口（A7/M6） */}
        <a
          href="/seedance-video"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 14,
            padding: "11px 14px",
            marginBottom: 12,
            background: "rgba(190,113,32,.08)",
            border: "1px solid rgba(190,113,32,.22)",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#bc7120" }}>
            ⚡ Seedance 快速生成：文字/图片 → AI 视频（约 1-3 分钟）
          </span>
          <span style={{ fontSize: 14, color: "#bc7120" }}>›</span>
        </a>
        {/* 引擎状态 */}
        <div
          style={{
            borderRadius: 18,
            padding: "12px 14px",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background:
              engineOnline === false
                ? "rgba(239,68,68,.07)"
                : "rgba(16,185,129,.08)",
            border: `1px solid ${
              engineOnline === false
                ? "rgba(239,68,68,.2)"
                : "rgba(16,185,129,.25)"
            }`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: engineOnline === false ? "#ef4444" : "#10b981",
              flexShrink: 0,
            }}
          />
          <p style={{ fontSize: 12, margin: 0, color: "#374151" }}>
            {engineOnline === false
              ? "视频引擎离线，稍后重试"
              : pipelines.length > 0
                ? `视频引擎在线 · ${pipelines.length} 条流水线可用`
                : "正在连接视频引擎…"}
          </p>
        </div>

        {/* 新建任务表单 */}
        {!project && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p
              style={{
                fontSize: 14,
                fontWeight: 700,
                margin: "0 0 10",
                color: "#1f2a44",
              }}
            >
              生成一条成片
            </p>
            <label style={{ fontSize: 12, color: "#6b7a93" }}>选择流水线</label>
            <select
              value={pipeline}
              onChange={(e) => setPipeline(e.target.value)}
              style={{
                width: "100%",
                margin: "6px 0 12px",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,.35)",
                background: "#fff",
                fontSize: 14,
                color: "#1f2a44",
              }}
            >
              {pipelines.length === 0 && (
                <option value="news_brief">新闻简报</option>
              )}
              {pipelines.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p
              style={{ fontSize: 11, color: "#94a3b8", margin: "-6px 0 12px" }}
            >
              真实流水线：AI 撰写脚本 → 分镜 → 合成画面 → 渲染成片，耗时约 5-30
              分钟
            </p>
            <label style={{ fontSize: 12, color: "#6b7a93" }}>
              选题（一句话描述你要讲什么）
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="比如：本周 AI 行业十大新闻，每条 30 秒讲解"
              rows={3}
              style={{
                width: "100%",
                margin: "6px 0 14px",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,.35)",
                background: "#fff",
                fontSize: 14,
                color: "#1f2a44",
                resize: "none",
                outline: "none",
              }}
            />
            {error && (
              <p style={{ fontSize: 12, color: "#dc2626", margin: "0 0 10" }}>
                {error}
              </p>
            )}
            <button
              type="button"
              className="mx-btn-gold"
              disabled={creating}
              onClick={() => void createJob()}
              style={{
                width: "100%",
                fontSize: 14,
                padding: "12px",
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "正在创建…" : "开始生成"}
            </button>
          </div>
        )}

        {/* 任务进度 */}
        {project && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  margin: 0,
                  color: "#1f2a44",
                }}
              >
                {project.title}
              </p>
              {totalStages > 0 && (
                <span style={{ fontSize: 12, color: "#6b7a93", flexShrink: 0 }}>
                  {doneStages}/{totalStages}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#6b7a93", margin: "4px 0 12" }}>
              {project.pipeline} · 实时进度
            </p>
            {(project.stages || []).map((s) => {
              const info = stageStatusText(s.status);
              const failedGate = (s.gates || []).find((g) => !g.passed);
              return (
                <div
                  key={s.name}
                  style={{
                    padding: "9px 4px",
                    borderBottom: "1px solid rgba(148,163,184,.12)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#374151" }}>
                      {STAGE_LABELS[s.name] || s.name}
                      {s.provider && s.provider !== "default" ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#94a3b8",
                            marginLeft: 6,
                          }}
                        >
                          · {s.provider}
                        </span>
                      ) : null}
                    </span>
                    <span style={{ fontSize: 12, color: info.color }}>
                      {info.text}
                    </span>
                  </div>
                  {failedGate && (
                    <p
                      style={{
                        fontSize: 11,
                        color: "#f59e0b",
                        margin: "4px 0 0",
                      }}
                    >
                      门控未过：{failedGate.name}{" "}
                      {failedGate.reason && `（${failedGate.reason}）`}
                    </p>
                  )}
                </div>
              );
            })}
            {project.halted && (
              <p style={{ fontSize: 12, color: "#dc2626", margin: "10px 0 0" }}>
                ⛔ 任务中止于「
                {STAGE_LABELS[project.halted.stage || ""] ||
                  project.halted.stage}
                」，可换选题重试
              </p>
            )}
            {project.video ? (
              <>
                <p
                  style={{ fontSize: 12, color: "#047857", margin: "12px 0 0" }}
                >
                  🎬 成片已生成（
                  {((project.video.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB）
                </p>
                <a
                  href={`/api/video/projects/${project.id}/compose.mp4`}
                  download
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
                  ⬇ 下载成片 MP4
                </a>
                {imported ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#047857",
                      margin: "8px 0 0",
                    }}
                  >
                    ✅ 已加入素材库（{imported}）——发布流程选素材时直接可用
                  </p>
                ) : (
                  <button
                    type="button"
                    className="mx-btn-gold"
                    disabled={importing}
                    onClick={() => void importMaterial()}
                    style={{
                      width: "100%",
                      marginTop: 10,
                      fontSize: 13,
                      padding: "10px",
                    }}
                  >
                    {importing ? "导入中…" : "加入素材库（发布可用）"}
                  </button>
                )}
              </>
            ) : (
              !project.halted && (
                <p
                  style={{ fontSize: 11, color: "#94a3b8", margin: "10px 0 0" }}
                >
                  生成中… 页面会自动刷新进度，完成后出现下载按钮
                </p>
              )
            )}
            {error && (
              <p style={{ fontSize: 12, color: "#dc2626", margin: "10px 0 0" }}>
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void reset()}
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
          </div>
        )}

        {/* 最近项目 */}
        {recentProjects.length > 0 && !project && (
          <div style={{ marginTop: 16 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1f2a44",
                margin: "0 0 8",
              }}
            >
              最近项目
            </p>
            {recentProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProjectId(p.id);
                  setProject(p);
                  setImported(null);
                  if (p.video) {
                    stopWatching();
                  } else {
                    startPolling(p.id);
                  }
                }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "10px 12px",
                  marginBottom: 8,
                  borderRadius: 14,
                  background: "rgba(255,255,255,.6)",
                  border: "1px solid rgba(148,163,184,.15)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: "#374151",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.title}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  {p.video
                    ? "🎬 已成片"
                    : p.halted
                      ? "⛔ 中止"
                      : p.progress || "进行中"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      </div>
    </DesktopOnlyGate>
  );
}
