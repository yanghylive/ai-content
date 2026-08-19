import {
  CalendarDays,
  CalendarClock,
  Download,
  ExternalLink,
  MonitorSmartphone,
  QrCode,
  ShieldAlert,
  Video,
} from "lucide-react";
import type { PublicDemoEndpointDto } from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { ShortLinkQrCode } from "./qr-code";

/**
 * 体验入口面板（PRD §9.5 第 8 步 + §9.7）：
 *   - 按 endpointType 展示（Web/H5 新窗口、小程序码、下载、预约演示）；
 *   - 显示有效期 / 允许设备 / 操作说明；
 *   - 回退方案（视频/图集）提示；
 *   - 不直接暴露 targetUrl：跳转一律走短链 /r/:code。
 */

const ENDPOINT_META: Record<
  string,
  { label: string; description: string }
> = {
  h5: { label: "H5 体验", description: "移动端网页体验，新窗口打开" },
  web: { label: "Web 体验", description: "桌面端网页体验，新窗口打开" },
  wechat_mini_program: {
    label: "微信小程序",
    description: "打开微信扫码或搜索小程序码",
  },
  download: { label: "下载", description: "受控下载体验安装包" },
  appointment: { label: "预约演示", description: "预约一对一产品演示" },
};

const HEALTH_META: Record<
  string,
  { label: string; background: string; foreground: string }
> = {
  healthy: {
    label: "可用",
    background: "var(--kaypal-v3-success-soft)",
    foreground: "var(--kaypal-v3-success)",
  },
  warning: {
    label: "轻微异常",
    background: "var(--kaypal-v3-warning-soft)",
    foreground: "var(--kaypal-v3-warning)",
  },
  broken: {
    label: "异常",
    background: "var(--kaypal-v3-danger-soft)",
    foreground: "var(--kaypal-v3-danger)",
  },
  expired: {
    label: "已过期",
    background: "var(--kaypal-v3-danger-soft)",
    foreground: "var(--kaypal-v3-danger)",
  },
  unknown: {
    label: "状态未知",
    background: "var(--kaypal-v3-paper-muted)",
    foreground: "var(--kaypal-v3-muted)",
  },
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "桌面",
  mobile: "手机",
  tablet: "平板",
  wechat: "微信",
};

const FALLBACK_NOTES: Record<string, string> = {
  media: "体验入口异常时将自动回退到视频或图集演示。",
  url: "体验入口异常时将回退到备用链接。",
  none: "",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 短链跳转地址（M4 实现 /r/:code 302 重定向，M3 仅渲染入口） */
function shortLinkUrl(shortCode: string | null): string | null {
  return shortCode ? `/r/${encodeURIComponent(shortCode)}` : null;
}

function EndpointAction({
  endpoint,
  caseId,
  caseSlug,
}: {
  endpoint: PublicDemoEndpointDto;
  caseId?: string;
  caseSlug?: string;
}) {
  const unavailable = endpoint.healthStatus === "broken" || endpoint.healthStatus === "expired";
  const type = endpoint.endpointType;
  const shortLink = shortLinkUrl(endpoint.shortCode);

  const trackOpen = () => {
    trackCaseEvent("demo_open", {
      case_id: caseId,
      endpoint_id: endpoint.id,
      endpoint_type: endpoint.endpointType,
    });
  };

  if (unavailable) {
    return (
      <p className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--kaypal-v3-danger)]">
        <ShieldAlert className="h-4 w-4" aria-hidden />
        入口暂不可用，可查看下方媒体演示
      </p>
    );
  }

  if (type === "appointment") {
    return (
      <a
        href={`/demo-request?case=${caseSlug ?? ""}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={trackOpen}
        className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        预约演示
      </a>
    );
  }

  if (type === "wechat_mini_program") {
    return (
      <div className="flex items-center gap-3">
        <span
          className="flex h-20 w-20 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] border border-dashed border-[var(--kaypal-v3-border)]"
          style={{
            background: "var(--kaypal-v3-paper-soft)",
            color: "var(--kaypal-v3-accent-ink)",
          }}
          aria-label="小程序码占位"
        >
          <QrCode className="h-10 w-10" aria-hidden />
        </span>
        <span className="text-xs text-[var(--kaypal-v3-muted)]">
          小程序码由运营配置下发，请以最新分享为准
        </span>
      </div>
    );
  }

  if (type === "download") {
    return (
      <a
        href={shortLink ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={trackOpen}
        className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
      >
        <Download className="h-4 w-4" aria-hidden />
        下载体验
      </a>
    );
  }

  // web / h5：新窗口打开，走短链 /r/:code，不直接暴露 targetUrl
  if (shortLink) {
    return (
      <a
        href={shortLink}
        target="_blank"
        rel="noopener noreferrer"
        onClick={trackOpen}
        className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
        打开体验
      </a>
    );
  }

  return (
    <p className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)] px-3 py-2 text-xs font-semibold text-[var(--kaypal-v3-muted)]">
      <MonitorSmartphone className="h-4 w-4" aria-hidden />
      体验入口即将开放
    </p>
  );
}

function EndpointCard({
  endpoint,
  caseId,
  caseSlug,
}: {
  endpoint: PublicDemoEndpointDto;
  caseId?: string;
  caseSlug?: string;
}) {
  const meta = ENDPOINT_META[endpoint.endpointType] ?? ENDPOINT_META.web;
  const health = HEALTH_META[endpoint.healthStatus] ?? HEALTH_META.unknown;
  const devices = endpoint.allowedDevices
    .map((d) => DEVICE_LABELS[d] ?? d)
    .filter(Boolean);
  const fallbackNote = FALLBACK_NOTES[endpoint.fallbackType];
  const unavailable =
    endpoint.healthStatus === "broken" || endpoint.healthStatus === "expired";
  const showQr =
    !unavailable &&
    endpoint.endpointType !== "appointment" &&
    endpoint.endpointType !== "wechat_mini_program";

  return (
    <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
          {meta.label}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none"
          style={{ background: health.background, color: health.foreground }}
        >
          {health.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
        {meta.description}
      </p>

      {(devices.length > 0 || endpoint.accessInstruction) && (
        <dl className="mt-3 space-y-1 text-xs text-[var(--kaypal-v3-muted)]">
          {devices.length > 0 && (
            <div className="flex gap-1.5">
              <dt className="sr-only">允许设备</dt>
              {devices.map((device) => (
                <dd
                  key={device}
                  className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 font-semibold"
                >
                  {device}
                </dd>
              ))}
            </div>
          )}
          {endpoint.accessInstruction && (
            <dd className="leading-5">{endpoint.accessInstruction}</dd>
          )}
        </dl>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--kaypal-v3-muted)]">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {endpoint.validUntil ? (
          <span>有效期至 {formatDate(endpoint.validUntil)}</span>
        ) : endpoint.validFrom ? (
          <span>自 {formatDate(endpoint.validFrom)} 起可用</span>
        ) : (
          <span>长期有效</span>
        )}
      </div>

      <div className="mt-3">
        <EndpointAction endpoint={endpoint} caseId={caseId} caseSlug={caseSlug} />
      </div>

      {showQr && (
        <ShortLinkQrCode
          shortCode={endpoint.shortCode}
          caseId={caseId}
          endpointId={endpoint.id}
        />
      )}

      {fallbackNote && (
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[var(--kaypal-v3-muted)]">
          <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {fallbackNote}
        </p>
      )}
    </div>
  );
}

export function DemoEndpointPanel({
  endpoints,
  caseId,
  caseSlug,
}: {
  endpoints: PublicDemoEndpointDto[];
  caseId?: string;
  caseSlug?: string;
}) {
  if (endpoints.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
        在线体验
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {endpoints.map((endpoint) => (
          <EndpointCard
            key={endpoint.id}
            endpoint={endpoint}
            caseId={caseId}
            caseSlug={caseSlug}
          />
        ))}
      </div>
    </section>
  );
}
