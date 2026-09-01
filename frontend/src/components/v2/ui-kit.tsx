"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * JIUZHANG AI v2 UI 基础件库
 * 全部使用 kaypal-v3 设计令牌（globals.css），浅色紫/深色原配自动生效。
 * 深层页改造统一用这套件，保证视觉一致 + 零学习成本模式落地。
 */

/* ================= 布局件 ================= */

/** 卡片分区：标题 + 说明 + 内容 */
export function V2Section({
  title,
  description,
  action,
  children,
  padding = true,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  padding?: boolean;
}) {
  return (
    <section className="kaypal-v3-panel">
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-6 py-4">
          <div>
            {title && (
              <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      <div className={padding ? "p-6" : ""}>{children}</div>
    </section>
  );
}

/* ================= 表单件 ================= */

/** 表单字段：标签 + 控件 + 提示 */
export function V2Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
        {label}
        {required && (
          <span className="ml-1 text-[var(--kaypal-v3-danger)]">*</span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">{hint}</p>
      )}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-field-border-hover)] focus:border-[var(--kaypal-v3-accent)] focus:shadow-[0_0_0_3px_hsl(var(--agent-cockpit-primary)_/_0.12),0_1px_4px_-1px_hsl(var(--agent-cockpit-primary)_/_0.12)]";

export function V2Input(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={`${inputClass} ${props.className || ""}`} />;
}

export function V2Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={`${inputClass} h-auto min-h-[96px] py-2.5 ${props.className || ""}`}
    />
  );
}

export function V2Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select
      {...props}
      className={`${inputClass} ${props.className || ""}`}
    />
  );
}

/* ================= 按钮件 ================= */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  loading?: boolean;
};

export function V2PrimaryButton({
  icon: Icon,
  loading,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_hsl(var(--agent-cockpit-primary)_/_0.3),0_2px_8px_-2px_hsl(var(--agent-cockpit-primary)_/_0.2),inset_0_1px_0_var(--kaypal-v3-btn-inset,rgba(255,255,255,0.18))] transition duration-150 ease-out hover:-translate-y-px hover:shadow-[0_2px_4px_hsl(var(--agent-cockpit-primary)_/_0.35),0_4px_16px_-2px_hsl(var(--agent-cockpit-primary)_/_0.3),inset_0_1px_0_var(--kaypal-v3-btn-inset-hover,rgba(255,255,255,0.22))] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      )}
      {children}
    </button>
  );
}

export function V2GhostButton({
  icon: Icon,
  loading,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition duration-150 ease-out hover:border-[var(--kaypal-v3-accent-border)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      )}
      {children}
    </button>
  );
}

export function V2DangerButton({
  icon: Icon,
  loading,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-danger)] transition duration-150 ease-out hover:bg-[var(--kaypal-v3-danger-soft)] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      )}
      {children}
    </button>
  );
}

/* ================= 展示件 ================= */

type Tone = "success" | "warning" | "danger" | "accent" | "muted";

const toneStyles: Record<Tone, string> = {
  success:
    "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]",
  warning:
    "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]",
  danger:
    "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]",
  accent:
    "border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
  muted:
    "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-muted)] text-[var(--kaypal-v3-muted)]",
};

/** 状态徽章 */
export function V2StatusChip({
  tone = "muted",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneStyles[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-90" />
      {children}
    </span>
  );
}

/** 统计卡片(支持可选 trend 迷你趋势线) */
export function V2StatCard({
  label,
  value,
  tone = "muted",
  icon: Icon,
  trend,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  icon?: LucideIcon;
  trend?: number[];
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--kaypal-v3-radius)] border p-5 shadow-[var(--kaypal-v3-shadow-1)] transition duration-200 hover:-translate-y-px hover:shadow-[var(--kaypal-v3-shadow-2)] ${toneStyles[tone]}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--kaypal-v3-accent)] via-[var(--kaypal-v3-accent-tint)] to-[var(--kaypal-v3-accent-border)] opacity-70" />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--kaypal-v3-muted)]">{label}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
        </div>
        {Icon && <Icon className="h-6 w-6" />}
      </div>
      {trend && trend.length >= 2 ? (
        <Sparkline data={trend} className="mt-3" />
      ) : null}
    </div>
  );
}

/** 空状态：图标 + 标题 + 说明 + 可选操作（T5.7：empty=没数据 / unavailable=未连接未同步） */
export function V2EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "empty",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "empty" | "unavailable";
}) {
  return (
    <div className="kx-scale-fade-in py-12 text-center">
      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          variant === "unavailable"
            ? "bg-amber-50 text-amber-500"
            : "bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
        }`}
      >
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
        {title}
      </h3>
      {description && (
        <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** 高级选项折叠（渐进式披露） */
export function V2Disclosure({
  title = "高级设置（可选）",
  children,
  defaultOpen = false,
}: {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
        onClick={() => setOpen(!open)}
      >
        <span>{open ? "收起" : title}</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* grid-rows 0fr→1fr 实现高度动画，避免内容瞬移（动效规范 2026-08-29） */}
      <div
        aria-hidden={!open}
        inert={!open}
        className="grid transition-[grid-template-rows,opacity] duration-200"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transitionTimingFunction: "var(--kaypal-v3-ease-out)",
        }}
      >
        <div className="overflow-hidden">
          <div className="kaypal-v3-surface mt-3 p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** 单选卡片组（发给谁/什么时候发这类大选项） */
export function V2OptionCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-[var(--kaypal-v3-radius)] border p-5 text-left transition ${
        selected
          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="kaypal-v3-icon-tile">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-[var(--kaypal-v3-ink)]">{title}</p>
          {description && (
            <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
              {description}
            </p>
          )}
        </div>
        {selected && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent)] text-xs text-white">
            ✓
          </span>
        )}
      </div>
    </button>
  );
}

/** 迷你趋势线(纯 SVG,零依赖):传入 number[] 渲染折线+面积 */
function Sparkline({ data, width = 64, height = 20, className }: { data: number[]; width?: number; height?: number; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <polygon points={areaPoints} fill="var(--kaypal-v3-accent)" opacity={0.08} />
      <polyline points={points} fill="none" stroke="var(--kaypal-v3-accent)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
