"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "@/components/iconpark";
import type { PublicMediaDto } from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";

/**
 * 媒体画廊（PRD §9.6）：
 *   - 图片 / 视频缩略图网格，点击放大（lightbox）；
 *   - 左右切换 + Esc 关闭 + 键盘方向键切换；
 *   - 图片加载失败显示品牌占位，不裸图报错；
 *   - 视频默认不自动播放（无声音），封面用 thumbnailUrl 或 fileUrl。
 */

/** 媒体实际展示地址：fileUrl → externalUrl → thumbnailUrl */
function mediaSource(media: PublicMediaDto): string | null {
  return media.fileUrl ?? media.externalUrl ?? media.thumbnailUrl ?? null;
}

/** 视频封面：thumbnailUrl → fileUrl → externalUrl */
function mediaPoster(media: PublicMediaDto): string | null {
  return media.thumbnailUrl ?? media.fileUrl ?? media.externalUrl ?? null;
}

/** 设备框架 → 画幅比例（lightbox 与缩略图统一） */
const DEVICE_RATIO: Record<string, string> = {
  mobile: "aspect-[9/16]",
  tablet: "aspect-[4/3]",
  desktop: "aspect-[16/9]",
};

function deviceRatio(frame: string | null): string {
  return frame && DEVICE_RATIO[frame] ? DEVICE_RATIO[frame] : "aspect-[16/10]";
}

const DEVICE_LABELS: Record<string, string> = {
  mobile: "手机",
  tablet: "平板",
  desktop: "桌面",
};

function BrandPlaceholder({
  iconClassName = "h-8 w-8",
  label,
}: {
  iconClassName?: string;
  label?: string;
}) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2"
      style={{
        background: "var(--kaypal-v3-accent-soft)",
        color: "var(--kaypal-v3-accent-ink)",
      }}
      role="img"
      aria-label={label ?? "媒体占位"}
    >
      <ImageIcon className={iconClassName} aria-hidden />
      {label && (
        <span className="text-xs font-semibold text-[var(--kaypal-v3-muted)]">
          {label}
        </span>
      )}
    </div>
  );
}

/** 单个媒体渲染（图片 / 视频 / 占位） */
function MediaView({
  media,
  className,
  iconClassName = "h-8 w-8",
  eager = false,
}: {
  media: PublicMediaDto;
  className: string;
  iconClassName?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaSource(media);
  const alt = media.altText || media.title || media.caption || "案例媒体";

  if (!src || failed) {
    return (
      <div className={`overflow-hidden ${className}`}>
        <BrandPlaceholder iconClassName={iconClassName} label={alt} />
      </div>
    );
  }

  if (media.mediaType === "video") {
    const poster = mediaPoster(media);
    return (
       
      <video
        className={className}
        src={src}
        poster={poster ?? undefined}
        controls
        preload="metadata"
        playsInline
        // 不自动播放：声音默认不开启，需用户手动点击播放
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
    />
  );
}

export function MediaGallery({
  media,
  caseId,
}: {
  media: PublicMediaDto[];
  caseId?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const close = useCallback(() => setActiveIndex(null), []);
  const prev = useCallback(
    () =>
      setActiveIndex((i) =>
        i === null ? i : (i - 1 + media.length) % media.length,
      ),
    [media.length],
  );
  const next = useCallback(
    () => setActiveIndex((i) => (i === null ? i : (i + 1) % media.length)),
    [media.length],
  );

  // 键盘：Esc 关闭、←/→ 切换
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft") prev();
      else if (event.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, close, prev, next]);

  // 打开 lightbox 时锁定背景滚动
  useEffect(() => {
    if (activeIndex === null) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [activeIndex]);

  if (media.length === 0) return null;

  const active = activeIndex === null ? null : media[activeIndex];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {media.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveIndex(index);
              trackCaseEvent("media_view", {
                case_id: caseId,
                media_id: item.id,
                media_type: item.mediaType,
              });
            }}
            className={`group relative w-full overflow-hidden rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-muted)] transition hover:border-[var(--kaypal-v3-accent)] ${deviceRatio(item.deviceFrame)}`}
            aria-label={`查看媒体：${item.altText || item.title || item.caption || `第 ${index + 1} 项`}`}
          >
            <MediaView
              media={item}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              iconClassName="h-6 w-6"
            />
            {item.mediaType === "video" && (
              <span
                className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-11 font-semibold leading-none"
                style={{
                  background: "rgba(15, 23, 42, 0.65)",
                  color: "#fff",
                }}
              >
                视频
              </span>
            )}
            {item.deviceFrame && DEVICE_LABELS[item.deviceFrame] && (
              <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-11 font-semibold leading-none bg-white/85 text-[var(--kaypal-v3-ink)]">
                {DEVICE_LABELS[item.deviceFrame]}
              </span>
            )}
          </button>
        ))}
      </div>

      {active && activeIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/85"
          role="dialog"
          aria-modal="true"
          aria-label={active.altText || active.title || "媒体预览"}
          onClick={close}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm font-semibold">
              {activeIndex + 1} / {media.length}
              {active.title ? ` · ${active.title}` : ""}
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-full p-2 transition hover:bg-white/15"
              aria-label="关闭预览"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div
            className="flex flex-1 items-center justify-center gap-2 px-2 sm:gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={prev}
              disabled={media.length <= 1}
              className="shrink-0 rounded-full p-2 text-white transition hover:bg-white/15 disabled:opacity-30"
              aria-label="上一张"
            >
              <ChevronLeft className="h-7 w-7" aria-hidden />
            </button>

            <div className={`relative max-h-full max-w-full ${deviceRatio(active.deviceFrame)} w-full sm:w-auto`}>
              {/* key 按媒体 ID 重挂载，避免上一张加载失败的状态残留到下一张 */}
              <MediaView
                key={active.id}
                media={active}
                className="h-full w-full object-contain"
                iconClassName="h-10 w-10"
                eager
              />
            </div>

            <button
              type="button"
              onClick={next}
              disabled={media.length <= 1}
              className="shrink-0 rounded-full p-2 text-white transition hover:bg-white/15 disabled:opacity-30"
              aria-label="下一张"
            >
              <ChevronRight className="h-7 w-7" aria-hidden />
            </button>
          </div>

          {active.caption && (
            <p className="px-6 py-4 text-center text-sm text-white/85">
              {active.caption}
            </p>
          )}
        </div>
      )}
    </>
  );
}
