"use client";

import React from "react";
import { commercialPrimaryText } from "@/lib/commercial-display-text";

type ClassNameProp = {
  className?: string;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function OpsDesktopPage({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: ClassNameProp & {
  title?: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || description || eyebrow || actions);
  return (
    <div
      className={cx(
        "mx-auto flex min-w-0 w-full max-w-[1420px] flex-col gap-2 overflow-x-clip pb-5 text-foreground",
        className,
      )}
    >
      {hasHeader ? (
        <div className="flex min-h-11 flex-col items-stretch justify-between gap-2 border-b border-divider bg-background px-3 py-2 sm:flex-row sm:items-center sm:px-4">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <div className="mb-0.5 text-11 font-medium text-[var(--kaypal-v3-brand)]">
                {commercialPrimaryText(eyebrow)}
              </div>
            ) : null}
            {title ? (
              <h1 className="truncate kx-greet leading-6 text-foreground">
                {commercialPrimaryText(title)}
              </h1>
            ) : null}
            {description ? (
              <p className="mt-0.5 max-w-[760px] truncate text-12 leading-5 text-default-500" title={commercialPrimaryText(description)}>
                {commercialPrimaryText(description)}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function OpsToolbar({
  children,
  className,
}: ClassNameProp & { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-wrap items-center gap-1.5 rounded-[12px] border border-divider bg-background/80 px-3 py-2 backdrop-blur-[22px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function OpsPanel({
  title,
  extra,
  children,
  className,
}: ClassNameProp & {
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cx("min-w-0 border border-divider bg-background", className)}>
      {title || extra ? (
        <div className="flex min-h-10 items-center justify-between gap-2 border-b border-divider px-3 py-1.5">
          {title ? (
            <h2 className="truncate text-14 font-semibold leading-5 text-foreground">
              {commercialPrimaryText(title)}
            </h2>
          ) : (
            <span />
          )}
          {extra}
        </div>
      ) : null}
      <div className="min-w-0 p-3">{children}</div>
    </section>
  );
}

export function OpsMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
}) {
  const toneClass =
    tone === "success"
      ? "text-[var(--kaypal-v3-success)]"
      : tone === "warning"
        ? "text-[var(--kaypal-v3-amber)]"
        : tone === "danger"
          ? "text-[var(--kaypal-v3-danger)]"
          : tone === "brand"
            ? "text-[var(--kaypal-v3-brand)]"
            : "text-foreground";
  return (
    <div className="min-w-[104px] border-r border-divider pr-3 last:border-r-0">
      <div className="text-12 text-default-500">{label}</div>
      <div className={cx("mt-1 text-lg font-semibold leading-6", toneClass)}>
        {value}
      </div>
    </div>
  );
}

export function OpsTabs({
  items,
  activeKey,
  onChange,
  ariaLabel = "页面视图",
}: {
  items: Array<{
    key: string;
    label: string;
    count?: React.ReactNode;
    panelId?: string;
  }>;
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  const moveSelection = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else {
      return;
    }

    const next = items[nextIndex];
    if (!next) return;
    event.preventDefault();
    onChange(next.key);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="tab"]',
    );
    tabs?.[nextIndex]?.focus();
  };

  return (
    <div
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 border-b border-divider bg-background px-3 pt-2"
      role="tablist"
    >
      {items.map((item, index) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            aria-controls={item.panelId}
            aria-selected={active}
            className={cx(
              "min-h-10 border-b-2 px-2.5 text-13 font-medium transition md:h-8 md:min-h-0",
              active
                ? "border-[var(--kaypal-v3-brand)] text-[var(--kaypal-v3-brand)]"
                : "border-transparent text-default-600 hover:text-foreground",
            )}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="ml-1 rounded-full bg-default-100 px-1.5 py-0.5 text-11 text-default-500">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function OpsButton({
  children,
  tone = "default",
  className,
  ...props
}: ClassNameProp &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "default" | "brand" | "danger" | "ghost";
  }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[6px] border px-2.5 text-13 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 md:h-8 md:min-h-0",
        tone === "brand"
          ? "border-[var(--kaypal-v3-brand-solid)] bg-[var(--kaypal-v3-brand-solid)] text-white hover:border-[var(--kaypal-v3-brand-hover)] hover:bg-[var(--kaypal-v3-brand-hover)]"
          : tone === "danger"
            ? "border-danger-200 bg-danger-50 text-[var(--kaypal-v3-danger)] hover:bg-danger-100"
            : tone === "ghost"
              ? "border-transparent bg-transparent text-default-600 hover:bg-default-100"
              : "border-divider bg-background text-default-700 hover:bg-default-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function OpsStatusPill({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-success-200 bg-success-50 text-[var(--kaypal-v3-success)] dark:border-success-500/30 dark:bg-success-500/15"
      : tone === "warning"
        ? "border-warning-200 bg-warning-50 text-[var(--kaypal-v3-amber)] dark:border-warning-500/30 dark:bg-warning-500/15"
        : tone === "danger"
          ? "border-danger-200 bg-danger-50 text-[var(--kaypal-v3-danger)] dark:border-danger-500/30 dark:bg-danger-500/15"
          : tone === "brand"
            ? "border-[var(--kaypal-v3-brand-border)] bg-[var(--kaypal-v3-brand-soft)] text-[var(--kaypal-v3-brand)]"
            : "border-divider bg-default-50 text-default-600";
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center rounded-[999px] border px-2 text-12 font-medium",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OpsDenseTable({
  children,
  className,
}: ClassNameProp & { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "min-w-0 max-w-full touch-pan-x overflow-x-auto overscroll-x-contain border border-divider bg-background [-webkit-overflow-scrolling:touch] [&_table]:w-full [&_table]:min-w-[560px] md:[&_table]:min-w-full [&_td]:border-b [&_td]:border-divider [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-13 [&_td]:leading-5 [&_td]:text-foreground [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-divider [&_th]:bg-default-50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-12 [&_th]:font-semibold [&_th]:text-default-600",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function OpsFormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-2 md:grid-cols-[100px_minmax(0,1fr)] md:items-center">
      <span className="text-13 font-medium text-default-600 md:text-right">
        {label}
      </span>
      {children}
    </label>
  );
}
