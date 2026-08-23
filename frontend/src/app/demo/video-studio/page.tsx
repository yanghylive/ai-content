"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { isDemoModeEnabled } from "@/lib/demo/isDemoModeEnabled";

interface DemoStatus {
  enabled: boolean;
  title: string;
  notice: string;
  mock: boolean;
}

interface DemoPipeline {
  value: string;
  label: string;
}

interface DemoStage {
  name: string;
  status: string;
}

interface DemoProject {
  id: string;
  title: string;
  pipeline: string;
  stages: DemoStage[];
  video: { url: null; bytes: number; placeholder: boolean; message: string } | null;
  mock: boolean;
}

const BANNER_STYLE = {
  background: "var(--kaypal-v3-danger)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  textAlign: "center" as const,
  padding: "10px 12px",
};

const STAGE_LABELS: Record<string, string> = {
  curation: "选题研究",
  script: "脚本撰写",
  storyboard: "分镜设计",
  compose: "画面合成",
  render: "渲染成片",
};

function stageStatusText(status: string): { text: string; color: string } {
  if (status === "done") return { text: "✅ 完成", color: "var(--kaypal-v3-success)" };
  if (status === "running") return { text: "⏳ 进行中", color: "var(--kaypal-v3-amber)" };
  return { text: "排队中", color: "var(--kaypal-v3-muted)" };
}

/**
 * 视频一键成片（演示舱）——能力证明，非产品功能。
 * 门禁：未开启演示模式时展示 disabled 提示；全部数据为 mock（不产出真实视频）。
 */
export default function VideoStudioDemoPage() {
  const [enabled] = useState(isDemoModeEnabled);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [pipelines, setPipelines] = useState<DemoPipeline[]>([]);
  const [pipeline, setPipeline] = useState("news_brief");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<DemoProject | null>(null);

  const loadBase = async () => {
    try {
      const [st, pl] = await Promise.all([
        api.get<DemoStatus>("/demo/video-studio/status"),
        api.get<{ pipelines: DemoPipeline[] }>("/demo/video-studio/pipelines"),
      ]);
      setStatus(st);
      setPipelines(pl.pipelines || []);
    } catch {
      setError("演示舱后端不可用（需开启演示模式）");
    }
  };

  useEffect(() => {
    if (enabled) void loadBase();
     
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="kx-mobile-ambient" style={{ minHeight: "100dvh" }}>
        <div style={BANNER_STYLE}>⚠ 演示模式未开启</div>
        <p style={{ padding: 20, fontSize: 13, color: "#6b7a93" }}>
          该页面为演示舱功能，需在构建期设置 NEXT_PUBLIC_ENABLE_DEMO=true 且后端开启
          ENABLE_DEMO 才能访问。生产环境不会渲染此页面。
        </p>
      </div>
    );
  }

  const createJob = async () => {
    if (!prompt.trim()) {
      setError("先填一个选题，比如：本周 AI 行业十大新闻");
      return;
    }
    setCreating(true);
    setError(null);
    setProject(null);
    try {
      const data = await api.post<{ project_id: string; status: string }>(
        "/demo/video-studio/generate",
        { pipeline, prompt: prompt.trim() },
      );
      const detail = await api.get<DemoProject>(
        `/demo/video-studio/projects/${data.project_id}`,
      );
      setProject(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建演示项目失败");
    } finally {
      setCreating(false);
    }
  };

  const refreshProject = async () => {
    if (!project) return;
    try {
      const detail = await api.get<DemoProject>(
        `/demo/video-studio/projects/${project.id}`,
      );
      setProject(detail);
      if (!detail.video) {
        setTimeout(() => void refreshProject(), 1500);
      }
    } catch {
      /* 轮询失败静默 */
    }
  };

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <div style={BANNER_STYLE}>⚠ 演示模式 · 不合规功能 · 禁止生产使用</div>

      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M10 9l5 3-5 3V9z" /></svg>
              JIUZHANG AI · 演示舱
            </div>
            <h1 className="mx-page-title">{status?.title || "视频一键成片"}</h1>
            <p className="mx-page-sub">12 流水线编排演示（mock，不产真实视频）</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => void loadBase()}
          >
            刷新
          </button>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {status?.notice && (
          <p style={{ fontSize: 11, color: "var(--kaypal-v3-danger)", margin: "0 0 12", lineHeight: 1.6 }}>
            {status.notice}
          </p>
        )}

        {!project && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
              演示：生成一条成片（模拟）
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
              {(pipelines.length > 0 ? pipelines : []).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 12, color: "#6b7a93" }}>选题（一句话描述你要讲什么）</label>
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
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", margin: "0 0 10" }}>{error}</p>
            )}
            <button
              type="button"
              className="mx-btn-gold"
              disabled={creating}
              onClick={() => void createJob()}
              style={{ width: "100%", fontSize: 14, padding: "12px", opacity: creating ? 0.6 : 1 }}
            >
              {creating ? "正在创建…" : "开始演示"}
            </button>
          </div>
        )}

        {project && (
          <div
            style={{
              borderRadius: 20,
              padding: 16,
              background: "rgba(255,255,255,.72)",
              border: "1px solid rgba(148,163,184,.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#1f2a44" }}>
                {project.title}
              </p>
              {project.video ? (
                <span style={{ fontSize: 12, color: "var(--kaypal-v3-danger)" }}>演示完成</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void refreshProject()}
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,.35)",
                    background: "transparent",
                    color: "#6b7a93",
                  }}
                >
                  推进演示
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#6b7a93", margin: "4px 0 12" }}>
              {project.pipeline} · 演示进度（mock）
            </p>
            {(project.stages || []).map((s) => {
              const info = stageStatusText(s.status);
              return (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 4px",
                    borderBottom: "1px solid rgba(148,163,184,.12)",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)" }}>
                    {STAGE_LABELS[s.name] || s.name}
                  </span>
                  <span style={{ fontSize: 12, color: info.color }}>{info.text}</span>
                </div>
              );
            })}
            {project.video && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(220,38,38,.06)",
                  border: "1px solid rgba(220,38,38,.2)",
                }}
              >
                <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", margin: 0 }}>
                  🎬 {project.video.message}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setProject(null);
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
          </div>
        )}
      </section>
    </div>
  );
}
