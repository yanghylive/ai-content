"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Image as ImageIcon,
  RefreshCcw,
  Video,
  Wand2,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  videoFaceSwapApi,
  type VideoFaceSwapJobSummary,
} from "@/lib/api/video-face-swap";
import { toPublicError } from "@/lib/public-error";

const MODE_LABELS: Record<string, string> = {
  face_swap: "换脸",
  deep_swap: "深度换脸",
  lip_sync: "对口型",
  face_enhance: "人脸增强",
  frame_enhance: "画质增强",
  background_remove: "去背景",
  frame_colorize: "上色",
  expression_restore: "表情修复",
  face_edit: "人脸编辑",
  age_modify: "年龄变化",
};

export function FaceSwapWorks() {
  const router = useRouter();
  const [jobs, setJobs] = useState<VideoFaceSwapJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await videoFaceSwapApi.jobs(50);
      setJobs(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载作品失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/content/face-swap")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">我的作品</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              你生成的换脸作品，可以下载或预览
            </p>
          </div>
          <V2PrimaryButton icon={Wand2} onClick={() => router.push("/face-swap/create")}>
            再做一个
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : jobs.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={ImageIcon}
            title="还没有作品"
            description="做一张换脸，作品会出现在这里"
            action={
              <V2PrimaryButton icon={Wand2} onClick={() => router.push("/face-swap/create")}>
                去做第一张
              </V2PrimaryButton>
            }
          />
        </V2Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <div key={job.id} className="kaypal-v3-panel overflow-hidden">
              {/* 预览 */}
              <div className="relative aspect-video bg-[var(--kaypal-v3-paper-soft)]">
                {job.outputPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={videoFaceSwapApi.previewUrl(job.outputPath)}
                    alt={job.outputName || "作品"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Video className="h-10 w-10 text-[var(--kaypal-v3-muted)]" />
                  </div>
                )}
                <div className="absolute left-2 top-2">
                  <V2StatusChip tone="accent">
                    {MODE_LABELS[job.mode] || job.mode}
                  </V2StatusChip>
                </div>
              </div>

              {/* 信息 */}
              <div className="p-4">
                <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                  {job.outputName || "未命名作品"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                  {job.createdAt
                    ? new Date(job.createdAt).toLocaleString("zh-CN")
                    : ""}
                </p>
                {job.message && (
                  <p className="mt-1 line-clamp-1 text-xs text-[var(--kaypal-v3-muted)]">
                    {job.message}
                  </p>
                )}
                <div className="mt-3 flex justify-end">
                  <V2GhostButton
                    icon={Download}
                    onClick={() =>
                      window.open(videoFaceSwapApi.previewUrl(job.outputPath), "_blank")
                    }
                  >
                    下载/预览
                  </V2GhostButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/content/face-swap")}>
          返回
        </V2GhostButton>
        <V2GhostButton icon={RefreshCcw} onClick={() => void fetchJobs()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}
