"use client";

/**
 * AI 图生视频（Wan2.1 / video-generation，P1 前端接入 2026-08-10）
 * 上传图片 + 提示词 → 创建任务 → 轮询 → 播放成片。
 * 与素材库 Seedance 生视频为不同引擎（Wan 图生视频，竖屏优先）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Textarea, addToast } from "@heroui/react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { videoGenApi, type VideoGenTask } from "@/lib/api/video-generation";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "生成中",
  ready: "已完成",
  failed: "失败",
};

export default function VideoGenPage() {
  const isMobile = useIsMobile();
  const [image, setImage] = useState<string>(""); // dataURL
  const [imageName, setImageName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5");
  const [task, setTask] = useState<VideoGenTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollStale, setPollStale] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toast = useCallback((title: string, color: "success" | "danger" = "success") => addToast({ title, color }), []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollTask = useCallback(async (id: string) => {
    try {
      const t = await videoGenApi.task(id);
      setTask(t);
      setPollStale(false);
      setConsecutivePollFailures(0);
      if (t.status === "ready" || t.status === "failed") {
        stopPoll();
        if (t.status === "ready") toast("🎬 视频已生成");
        else toast("生成失败：" + (t.error || "未知原因"), "danger");
      }
    } catch {
      setPollStale(true);
    }
  }, [stopPoll, toast]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const handlePickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件", "danger");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result || ""));
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!image || !prompt.trim()) {
      toast("请上传图片并填写提示词", "danger");
      return;
    }
    setError("");
    setBusy(true);
    setPollStale(false);
    try {
      const r = await videoGenApi.create({
        imageData: image,
        prompt: prompt.trim(),
        duration: Number(duration) || 5,
        aspect: "9:16",
      });
      const taskId = r.taskId || r.task?.id;
      if (!taskId) {
        setError("任务创建失败（无任务 ID）");
        return;
      }
      setTask({ id: taskId, status: "pending", progress: 0, videoUrl: null });
      pollRef.current = setInterval(() => void pollTask(taskId), 3000);
      void pollTask(taskId);
      toast("✅ 任务已提交，生成中…");
    } catch (e) {
      setError(toPublicError(e, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 520 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        参考图片 *
        <input
          type="file"
          accept="image/*"
          onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
          style={{ fontSize: 12 }}
        />
        {imageName ? <span style={{ fontSize: 11.5, opacity: 0.7 }}>已选：{imageName}</span> : null}
      </label>
      {image ? (
        // 参考图为本地 dataURL，不适合 next/image 优化
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="参考图" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 12, border: "1px solid rgba(142,165,190,.25)" }} />
      ) : null}
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        提示词 *
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="如：清晨阳光下的咖啡馆，镜头缓慢推进，温暖氛围" rows={3} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        时长（秒）
        <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min={3} max={10} />
      </label>
      <Button color="primary" isLoading={busy} onPress={handleCreate} style={{ alignSelf: "flex-start" }}>
        生成视频
      </Button>
      {error ? <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>⚠️ {error}</p> : null}
    </div>
  );

  const taskView = task ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>🎬 生成任务</div>
      <div style={{ fontSize: 12.5, opacity: 0.8 }}>
        状态：{STATUS_LABEL[task.status] || task.status}
        {task.status === "running" && task.progress ? `（${task.progress}%）` : ""} 
        {pollStale && (task.status === "pending" || task.status === "running") ? "  ⚠️ 连接中断，正在重连…" : ""}
      </div>
      {task.status === "ready" && task.videoUrl ? (
        <video controls src={task.videoUrl} style={{ width: "100%", borderRadius: 12, maxHeight: 420 }} />
      ) : null}
      {task.status === "failed" ? <div style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{task.error || "生成失败"}</div> : null}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <V2BackButton />
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">AI 图生视频</h1>
              <p className="mx-page-sub">上传图片 + 提示词，生成短视频</p>
            </div>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 16 }}>{form}</div>
          {taskView ? <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>{taskView}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
      <header>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>AI 图生视频</h2>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>Wan2.1 引擎：图片 + 提示词 → 短视频（竖屏 9:16）</p>
      </header>
      {form}
      {taskView}
    </div>
  );
}
