"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  FileVideo,
  FolderOpen,
  Loader2,
  PackagePlus,
  Play,
  Smartphone,
  XCircle,
  type LucideIcon,
} from "@/components/iconpark";
import Link from "next/link";
import { videoWorkshopApi } from "@/lib/api/video-workshop";

type VideoTemplate = {
  key: string;
  title: string;
  note: string;
  ratio: string;
  prompt: string;
};

type WorkshopTask = {
  id: string;
  title: string;
  status: "queued" | "running" | "done" | "failed";
  progress?: string;
  createdAt: string;
};

// 真实模板预设（来自旧版 video-workshop/page.tsx）
const TEMPLATES: VideoTemplate[] = [
  {
    key: "product",
    title: "产品卖点",
    note: "竖版 · 自然清晰 · 轻快音乐 · 30 秒",
    ratio: "9:16",
    prompt: "突出产品卖点、优惠信息和真实使用场景，画面节奏明快，最后引导咨询。",
  },
  {
    key: "store",
    title: "门店探店",
    note: "竖版 · 暖调生活 · 重点标题 · 30 秒",
    ratio: "9:16",
    prompt: "按探店顺序讲清环境、爆品、价格和到店理由，镜头切换自然。",
  },
  {
    key: "case",
    title: "客户案例",
    note: "横版 · 冷调质感 · 温和音乐 · 45 秒",
    ratio: "16:9",
    prompt: "用客户案例结构呈现：原本问题、解决过程、结果变化、适合人群。",
  },
  {
    key: "knowledge",
    title: "知识口播",
    note: "方形 · 自然清晰 · 宋体字幕 · 30 秒",
    ratio: "1:1",
    prompt: "用知识分享结构输出，开头直接给观点，中间给例子，结尾给行动建议。",
  },
];

const STATUS_CONFIG: Record<
  WorkshopTask["status"],
  { label: string; icon: LucideIcon; color: string }
> = {
  queued: { label: "排队中", icon: Clock, color: "var(--kaypal-v3-muted)" },
  running: { label: "处理中", icon: Loader2, color: "var(--kaypal-v3-accent-ink)" },
  done: { label: "完成", icon: CheckCircle2, color: "var(--kaypal-v3-success)" },
  failed: { label: "失败", icon: XCircle, color: "var(--kaypal-v3-danger)" },
};

export function VideoWorkshopCenter() {
  const [tasks, setTasks] = useState<WorkshopTask[]>([]);

  // 真实任务列表（video-workshop/tasks），替代写死的示例
  useEffect(() => {
    let active = true;
    videoWorkshopApi
      .tasks(10)
      .then((list) => {
        if (!active) return;
        const statusMap: Record<string, WorkshopTask["status"]> = {
          queued: "queued",
          running: "running",
          succeeded: "done",
          failed: "failed",
          cancelled: "failed",
        };
        setTasks(
          (Array.isArray(list) ? list : []).map((t) => ({
            id: t.id,
            title:
              t.downloadInput?.outputName ||
              t.renderInput?.templateName ||
              (t.kind === "download" ? "下载任务" : "渲染任务"),
            status: statusMap[t.status] || "queued",
            progress: `${t.progress ?? 0}%${t.stage ? ` · ${t.stage}` : ""}`,
            createdAt: t.createdAt
              ? new Date(t.createdAt).toLocaleDateString("zh-CN")
              : "",
          })),
        );
      })
      .catch(() => {
        // 读取失败就显示空列表（页面其他功能不受影响）
      });
    return () => {
      active = false;
    };
  }, []);

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const advancedLinks = [
    { key: "assets", title: "素材库", icon: FolderOpen, href: "/content" },
    { key: "batch", title: "批量导入", icon: PackagePlus, href: "/video-workshop?action=batch" },
    { key: "phone", title: "手机上传", icon: Smartphone, href: "/video-workshop?action=phone" },
    { key: "download", title: "下载任务", icon: Download, href: "/video-workshop?action=download" },
    { key: "records", title: "发布记录", icon: FileVideo, href: "/distribution/tasks" },
  ];

  return (
    <div className="kx-view kaypal-v2-engine flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              视频工坊
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              选一个模板，上传素材，AI 帮你剪好视频
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-[var(--kaypal-v3-muted)]">
            <span>
              处理中 <strong className="text-[var(--kaypal-v3-accent-ink)]">{runningCount}</strong>
            </span>
            <span>
              已完成 <strong className="text-[var(--kaypal-v3-success)]">{doneCount}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* 模板选择（单一主行动） */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            🎬 选个模板开始
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            模板已预设好尺寸、时长、音乐和字幕风格，直接用
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.map((template) => (
            <div
              key={template.key}
              className="kaypal-v3-panel group flex flex-col p-5 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
            >
              {/* 预览占位 */}
              <div
                className={`mx-auto flex items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)] ${
                  template.ratio === "9:16"
                    ? "aspect-[9/16] h-36"
                    : template.ratio === "16:9"
                      ? "aspect-video w-full"
                      : "aspect-square h-32"
                }`}
              >
                <Play className="h-8 w-8 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
              </div>

              <h3 className="mt-4 text-center font-semibold text-[var(--kaypal-v3-ink)]">
                {template.title}
              </h3>
              <p className="mt-1 text-center text-xs text-[var(--kaypal-v3-muted)]">
                {template.note}
              </p>

              <Link
                href={`/video-workshop?template=${template.key}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
              >
                开始创作
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* 进行中的任务 */}
      {tasks.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              📋 我的任务
            </h2>
            <Link
              href="/video-workshop?tab=tasks"
              className="text-sm font-medium text-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              查看全部 →
            </Link>
          </div>

          <div className="space-y-3">
            {tasks.map((task) => {
              const config = STATUS_CONFIG[task.status];
              const Icon = config.icon;
              return (
                <div key={task.id} className="kaypal-v3-panel p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Icon
                        className={`h-5 w-5 ${task.status === "running" ? "animate-spin" : ""}`}
                        style={{ color: config.color }}
                      />
                      <div>
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {task.title}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                          {task.progress} · {task.createdAt}
                        </p>
                      </div>
                    </div>
                    {task.status === "done" && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
                      >
                        <Download className="h-4 w-4" />
                        下载
                      </button>
                    )}
                    {task.status === "failed" && (
                      <button
                        type="button"
                        className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                      >
                        重试
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 高级功能 */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚙️ 高级功能
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {advancedLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.key}
                href={link.href}
                className="kaypal-v3-surface group flex items-center gap-3 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
              >
                <Icon className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                  {link.title}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
