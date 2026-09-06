"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, type LucideIcon } from "@/components/iconpark";

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

/** 下拉选项（V2Pick 用） */
export type V2PickOption = {
  value: string;
  label: string;
  /** 次行说明（两行式选项） */
  desc?: string;
  icon?: LucideIcon;
  /** 真实 logo 图（优先于 icon）；brandColor 作圆角色底 */
  image?: string;
  brandColor?: string;
  /** 标签（如「自定义」），跟在标题后 */
  badge?: string;
};

/**
 * 美化下拉单选（2026-09-07）：替代原生 select——触发器同系统输入框口径，
 * 弹层为白底圆角面板 + 两行式选项（图标/标题/说明/选中勾），支持底部动作行。
 */
export function V2Pick({
  value,
  options,
  placeholder = "请选择",
  onChange,
  footer,
  ariaLabel,
  className,
}: {
  value: string;
  options: V2PickOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  /** 底部动作行（如「新增自定义行业」） */
  footer?: { label: string; onClick: () => void };
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  /* 弹层用 portal + fixed 定位：不受祖先 overflow/层叠上下文裁剪；
     下方空间不足时自动向上翻 */
  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const listH = Math.min(320, 44 + (options.length + (footer ? 1 : 0)) * 46);
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < listH + 16 && rect.top > spaceBelow;
    setPanelStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      minWidth: 240,
      maxHeight: Math.min(320, (flip ? rect.top : spaceBelow) - 12),
      ...(flip
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  };
  useLayoutEffect(() => {
    if (open) place();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest?.("[data-v2pick-panel]")
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const renderMark = (option: V2PickOption, active: boolean) => {
    if (option.image) {
      return (
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px]"
          style={{ background: option.brandColor || "var(--kaypal-v3-accent)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={option.image} alt="" className="h-3.5 w-3.5 object-contain" />
        </span>
      );
    }
    const Icon = option.icon;
    if (!Icon) return null;
    return (
      <Icon
        size={16}
        className={`shrink-0 ${
          active
            ? "text-[var(--kaypal-v3-accent-ink)]"
            : "text-[var(--kaypal-v3-muted)]"
        }`}
      />
    );
  };

  const current = options.find((option) => option.value === value);

  return (
    <div ref={rootRef} className={`relative ${className || ""}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-2 rounded-[10px] border bg-[var(--kaypal-v3-paper)] px-3 text-left transition-colors"
        style={{
          borderColor: open
            ? "var(--kaypal-v3-accent)"
            : "var(--kaypal-v3-field-border)",
        }}
      >
        {current ? renderMark(current, true) : null}
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            current
              ? "font-semibold text-[var(--kaypal-v3-ink)]"
              : "text-[var(--kaypal-v3-muted)]"
          }`}
        >
          {current ? current.label : placeholder}
        </span>
        {current?.desc ? (
          <span className="hidden shrink-0 truncate text-xs text-[var(--kaypal-v3-muted)] sm:block">
            {current.desc}
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--kaypal-v3-muted)] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open
        ? createPortal(
            <div
              role="listbox"
              data-v2pick-panel=""
              style={panelStyle}
              className="z-[70] overflow-y-auto rounded-[12px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-1.5 shadow-[var(--kaypal-v3-shadow-2)]"
            >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-colors ${
                  active
                    ? "bg-[var(--kaypal-v3-accent-soft)]"
                    : "hover:bg-[var(--kaypal-v3-paper-soft)]"
                }`}
              >
                {renderMark(option, active)}
                <span className="min-w-0 flex-1">
                  <span
                    className={`flex items-center gap-1.5 text-sm font-medium ${
                      active
                        ? "text-[var(--kaypal-v3-accent-ink)]"
                        : "text-[var(--kaypal-v3-ink)]"
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.badge ? (
                      <span className="shrink-0 rounded-full bg-[var(--kaypal-v3-paper-soft)] px-1.5 py-px text-[10px] font-semibold text-[var(--kaypal-v3-muted)]">
                        {option.badge}
                      </span>
                    ) : null}
                  </span>
                  {option.desc ? (
                    <span className="mt-0.5 block truncate text-xs text-[var(--kaypal-v3-muted)]">
                      {option.desc}
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <Check
                    size={15}
                    className="shrink-0 text-[var(--kaypal-v3-accent-ink)]"
                  />
                ) : null}
              </button>
            );
          })}
          {footer ? (
            /* 吸底动作行：长列表滚动时始终可见 */
            <button
              type="button"
              onClick={() => {
                footer.onClick();
                setOpen(false);
              }}
              className="sticky bottom-0 mt-1 flex w-full items-center gap-2 rounded-[8px] border border-dashed border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-left text-sm font-medium text-[var(--kaypal-v3-accent-ink)] transition-colors hover:bg-[var(--kaypal-v3-accent-soft)]"
            >
              <Plus size={14} className="shrink-0" />
              {footer.label}
            </button>
          ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ================= 按钮件 ================= */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  loading?: boolean;
  /** 高度档:sm=32 / md=40(默认) / lg=48;不传保持旧视觉(md) */
  size?: "sm" | "md" | "lg";
};

/** 按钮档位 → 高度类(按钮系统规范 v1.0:32/40/48) */
const BTN_H: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8",
  md: "h-10",
  lg: "h-12",
};

function btnSize(props: ButtonProps): { h: string; px: string } {
  const size = props.size ?? "md";
  const px = size === "sm" ? "px-3.5" : size === "lg" ? "px-6" : "px-5";
  return { h: BTN_H[size], px };
}

export function V2PrimaryButton({
  icon: Icon,
  loading,
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const { h, px } = btnSize({ ...props, size });
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] ${h} ${px} text-sm font-semibold text-white shadow-[0_1px_2px_hsl(var(--agent-cockpit-primary)_/_0.3),0_2px_8px_-2px_hsl(var(--agent-cockpit-primary)_/_0.2),inset_0_1px_0_var(--kaypal-v3-btn-inset,rgba(255,255,255,0.18))] transition duration-150 ease-out hover:-translate-y-px hover:shadow-[0_2px_4px_hsl(var(--agent-cockpit-primary)_/_0.35),0_4px_16px_-2px_hsl(var(--agent-cockpit-primary)_/_0.3),inset_0_1px_0_var(--kaypal-v3-btn-inset-hover,rgba(255,255,255,0.22))] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

export function V2GhostButton({
  icon: Icon,
  loading,
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const { h, px } = btnSize({ ...props, size });
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] ${h} ${px} text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition duration-150 ease-out hover:border-[var(--kaypal-v3-accent-border)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

export function V2DangerButton({
  icon: Icon,
  loading,
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const { h, px } = btnSize({ ...props, size });
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-paper)] ${h} ${px} text-sm font-medium text-[var(--kaypal-v3-danger)] transition duration-150 ease-out hover:bg-[var(--kaypal-v3-danger-soft)] active:scale-[0.97] disabled:opacity-60 ${props.className || ""}`}
    >
      {Icon && (
        <Icon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
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
            ? "bg-amber-50 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300"
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
  badge,
  onDelete,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  badge?: string;
  onDelete?: () => void;
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
      <div className="relative flex items-center gap-3">
        <div className="shrink-0 kaypal-v3-icon-tile">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--kaypal-v3-ink)]">
            {title}
          </p>
          {description && (
            <p className="mt-0.5 truncate text-sm text-[var(--kaypal-v3-muted)]">
              {description}
            </p>
          )}
        </div>
        {badge && (
          <span className="shrink-0 rounded-full border border-[var(--kaypal-v3-brand-border)] bg-[var(--kaypal-v3-brand-soft)] px-2 py-0.5 text-11 font-medium text-[var(--kaypal-v3-brand)]">
            {badge}
          </span>
        )}
        {selected && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent)] text-xs text-white">
            ✓
          </span>
        )}
        {onDelete && (
          <span
            role="button"
            aria-label="删除该自定义行业"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }
            }}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm leading-none text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
          >
            ×
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
