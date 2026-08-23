"use client";

import { useEffect, useRef, useState } from "react";
import { toDataURL, toString } from "qrcode";
import { Download, ExternalLink, QrCode, ShieldAlert } from "lucide-react";
import { trackCaseEvent } from "@/lib/analytics/case-events";

/**
 * 短链二维码组件（PRD §9.8 / §9.7）。
 *
 *   - 用前端 qrcode 库把 /r/:code 短链生成二维码（展示 + PNG/SVG 下载）；
 *   - 二维码编码绝对地址（window.location.origin + /r/:code），便于跨设备扫码；
 *   - 生成失败 / 无 shortCode 时降级展示，不阻塞页面主流程。
 */

const QR_SIZE = 220;
const QR_MARGIN = 2;

/** 短链绝对地址：短链公开路径为 /r/:code（nginx/桌面壳反代到 /api/r/:code） */
function buildShortLinkUrl(shortCode: string): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.origin}/r/${encodeURIComponent(shortCode)}`;
}

export function ShortLinkQrCode({
  shortCode,
  caseId,
  endpointId,
}: {
  shortCode: string | null;
  caseId?: string;
  endpointId?: string;
}) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [svgDataUrl, setSvgDataUrl] = useState<string | null>(null);
  const [pngFailed, setPngFailed] = useState(false);
  const reportedRef = useRef(false);

  const url = shortCode ? buildShortLinkUrl(shortCode) : null;

  useEffect(() => {
    if (!url) {
      setPngDataUrl(null);
      setSvgDataUrl(null);
      setPngFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setPngDataUrl(null);
    setSvgDataUrl(null);
    setPngFailed(false);

    toDataURL(url, {
      width: QR_SIZE,
      margin: QR_MARGIN,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
        if (cancelled) return;
        setPngDataUrl(dataUrl);
        // 二维码成功生成（可视）即上报一次 qr_view，防重复上报
        if (!reportedRef.current) {
          reportedRef.current = true;
          trackCaseEvent("qr_view", {
            case_id: caseId,
            endpoint_id: endpointId,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setPngFailed(true);
      });

    toString(url, {
      type: "svg",
      width: QR_SIZE,
      margin: QR_MARGIN,
      errorCorrectionLevel: "M",
    })
      .then((svg) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        );
        setSvgDataUrl(objectUrl);
      })
      .catch(() => {
        // SVG 失败不影响 PNG 展示与下载
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, caseId, endpointId]);

  if (!shortCode) return null;

  return (
    <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-muted)] p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] bg-white p-1.5">
          {pngDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 二维码数据 URL，无需 next/image
            <img
              src={pngDataUrl}
              alt={`短链二维码 ${shortCode}`}
              width={QR_SIZE}
              height={QR_SIZE}
              className="h-full w-full"
            />
          ) : (
            <span
              className="flex h-full w-full items-center justify-center text-[var(--kaypal-v3-muted)]"
              aria-label="二维码生成中"
            >
              <QrCode className="h-8 w-8" aria-hidden />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs leading-5 text-[var(--kaypal-v3-muted)]">
            扫码可在手机端打开体验入口。
          </p>

          {pngFailed && (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--kaypal-v3-danger)]">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              二维码生成失败，可点击上方「打开体验」或复制链接分享
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {pngDataUrl && (
              <a
                href={pngDataUrl}
                download={`jiuzhang-case-${shortCode}.png`}
                className="inline-flex items-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                PNG
              </a>
            )}
            {svgDataUrl && (
              <a
                href={svgDataUrl}
                download={`jiuzhang-case-${shortCode}.svg`}
                className="inline-flex items-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                SVG
              </a>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        点击体验或扫码后将离开九章网站，进入第三方演示环境。
      </p>
    </div>
  );
}
