"use client";

import { BrandLogo } from "@/components/brand-logo";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";

interface EngineStatus {
  online: boolean;
  ok: boolean;
  url: string;
  error?: string;
  checkedAt: string;
}

interface ProjectStage {
  name: string;
  status: string;
}

interface ProjectStatus {
  id: string;
  title: string;
  pipeline: string;
  status?: string;
  stages?: ProjectStage[];
}

/** studio_core 12 条流水线（与引擎 /api/pipelines 对齐） */
const PIPELINES: Array<{ value: string; label: string }> = [
  { value: "animated_explainer", label: "动画讲解" },
  { value: "corporate", label: "企业宣传片（真实渲染）" },
  { value: "documentary", label: "纪录片" },
  { value: "interview", label: "访谈" },
  { value: "listicle", label: "盘点榜单" },
  { value: "news_brief", label: "新闻简报" },
  { value: "product_demo", label: "产品演示" },
  { value: "promo", label: "宣传片" },
  { value: "shoppable", label: "带货种草" },
];

const STAGE_LABELS: Record<string, string> = {
  curation: "选题研究",
  script: "脚本撰写",
  storyboard: "分镜设计",
  compose: "画面合成",
  render: "渲染成片",
};

function stageStatusText(status?: string): { text: string; color: string } {
  if (status === "done")
    return { text: "✅ 完成", color: "#10b981" };
  if (status === "running" || status === "pending")
    return { text: "⏳ 进行中", color: "#f59e0b" };
  if (status === "awaiting_approval")
    return { text: "⏸ 等你确认", color: "#f4bb67" };
  if (status === "failed")
    return { text: "❌ 失败", color: "#ef4444" };
  return { text: "未开始", color: "#94a3b8" };
}

/**
 * 视频引擎（studio_core）——D3 对接
 * 选择流水线 + 输入选题 → 创建任务 → 阶段进度 → 脚本确认 → 成片
 */
export default function VideoWorkshopV2Page() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [pipeline, setPipeline] = useState("news_brief");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectStatus | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<unknown[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkEngine = async () => {
    try {
      const data = await api.get<EngineStatus>("/video-workshop/engine-status");
      setStatus(data);
    } catch {
      setStatus({
        online: false,
        ok: false,
        url: "",
        error: "状态接口不可用",
        checkedAt: new Date().toISOString(),
      });
    }
  };

  useEffect(() => {
    void checkEngine();
    // 卸载时清理轮询定时器，避免组件销毁后仍持续轮询
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const startPolling = (pid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.get<ProjectStatus>(`/video-workshop/jobs/${pid}`);
        setProject(data);
        if (data.stages?.every((s) => s.status === "done")) {
          // 全部阶段完成：停止轮询并拉取成片
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          const dv = await api
            .get<unknown[]>(`/video-workshop/projects/${pid}/deliverables`)
            .catch(() => null);
          setDeliverables(dv);
        } else if (data.status === "failed" || data.status === "cancelled") {
          // 任务失败/取消：终态，停止轮询避免 8s 空转
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        /* 轮询失败静默 */
      }
    }, 8000);
  };

  const createJob = async () => {
    if (!prompt.trim()) {
      setError("先填一个选题，比如：本周 AI 行业十大新闻");
      return;
    }
    setCreating(true);
    setError(null);
    setDeliverables(null);
    try {
      const data = await api.post<{ projectId: string; status: string }>(
        "/video-workshop/jobs",
        { type: pipeline, prompt: prompt.trim() },
      );
      setProjectId(data.projectId);
      const detail = await api.get<ProjectStatus>(
        `/video-workshop/jobs/${data.projectId}`,
      );
      setProject(detail);
      startPolling(data.projectId);
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
        `/video-workshop/jobs/${projectId}/import-material`,
        {},
      );
      setImported(data.filename);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入素材失败');
    } finally {
      setImporting(false);
    }
  };

  const approve = async () => {
    if (!projectId) return;
    try {
      await api.post(`/video-workshop/jobs/${projectId}/approve`, {});
      setError(null);
      // 立即刷新一次
      const data = await api.get<ProjectStatus>(`/video-workshop/jobs/${projectId}`);
      setProject(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    }
  };

  return (
    <DesktopOnlyGate
      title="视频工作坊需在电脑端使用"
      desc="视频生成流水线（12 条）、实时进度与成片下载需要大屏与稳定网络，手机端暂不支持。你可以先在手机上用「素材采集」「AI 生图」「AI 配音」准备素材。"
      backHref="/content"
    >
      <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">视频引擎</h1>
            <p className="mx-page-sub">选流水线 · 写选题 · 自动成片</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => void checkEngine()}
          >
            刷新状态
          </button>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {/* 12 流水线直连入口 */}
        <a
          href="/video-studio"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 14,
            padding: "11px 14px",
            marginBottom: 12,
            background: "rgba(32,79,127,.08)",
            border: "1px solid rgba(32,79,127,.22)",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#20497f" }}>
            ✨ 12 条流水线全真跑（动画/访谈/带货/新闻…）→ 视频一键成片
          </span>
          <span style={{ fontSize: 14, color: "#20497f" }}>›</span>
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
              status?.online
                ? "rgba(16,185,129,.08)"
                : "rgba(239,68,68,.07)",
            border: `1px solid ${
              status?.online ? "rgba(16,185,129,.25)" : "rgba(239,68,68,.2)"
            }`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: status?.online ? "#10b981" : "#ef4444",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
            <p style={{ fontSize: 12, margin: 0, color: "#374151", fontWeight: 600 }}>
              {status?.online ? "视频引擎在线 · 9 条流水线可用" : "视频成片引擎未连接"}
            </p>
            {!status?.online && (
              <p style={{ fontSize: 11, margin: 0, color: "#6b7a93", lineHeight: 1.5 }}>
                {status?.error === "引擎响应超时"
                  ? "引擎响应超时，可能正在启动，稍后再试。"
                  : "本机未部署视频成片引擎（studio_core），一键成片暂不可用。"}
                {" "}可先用内容中心的「AI 生视频」生成短视频，或联系管理员部署引擎。
              </p>
            )}
          </div>
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
            <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "#1f2a44" }}>
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
              {PIPELINES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "-6px 0 12px" }}>
              企业宣传片为真实渲染（配音+画面+合成），约 10-30 分钟；其余流水线建议使用「视频一键成片」（12 条全真跑）
            </p>
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
              <p style={{ fontSize: 12, color: "#dc2626", margin: "0 0 10" }}>{error}</p>
            )}
            <button
              type="button"
              className="mx-btn-gold"
              disabled={creating}
              onClick={() => void createJob()}
              style={{ width: "100%", fontSize: 14, padding: "12px", opacity: creating ? .6 : 1 }}
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
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#1f2a44" }}>
              {project.title}
            </p>
            <p style={{ fontSize: 12, color: "#6b7a93", margin: "4px 0 12" }}>
              {project.pipeline} · 自动生成中，8 秒刷新
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
                  <span style={{ fontSize: 13, color: "#374151" }}>
                    {STAGE_LABELS[s.name] || s.name}
                  </span>
                  <span style={{ fontSize: 12, color: info.color }}>{info.text}</span>
                </div>
              );
            })}
            {project.stages?.some((s) => s.status === "awaiting_approval") && (
              <button
                type="button"
                className="mx-btn-gold"
                onClick={() => void approve()}
                style={{ width: "100%", marginTop: 12, fontSize: 13, padding: "10px" }}
              >
                脚本已看过，确认放行
              </button>
            )}
            {deliverables && deliverables.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: "#047857", margin: "12px 0 0" }}>
                  🎬 成片已生成（{deliverables.length} 个文件）
                </p>
                {imported ? (
                  <p style={{ fontSize: 12, color: "#047857", margin: "8px 0 0" }}>
                    ✅ 已加入素材库（{imported}）——去发布流程选素材时直接可用
                  </p>
                ) : (
                  <button
                    type="button"
                    className="mx-btn-gold"
                    disabled={importing}
                    onClick={() => void importMaterial()}
                    style={{ width: "100%", marginTop: 10, fontSize: 13, padding: "10px" }}
                  >
                    {importing ? "导入中…" : "加入素材库（发布可用）"}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setProject(null);
                setProjectId(null);
                setPrompt("");
                if (pollRef.current) clearInterval(pollRef.current);
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
    </DesktopOnlyGate>
  );
}
