import type { ReactNode } from "react";
import { cn } from "@heroui/react";

type DashboardPageShellProps = {
  children: ReactNode;
  className?: string;
  width?: "standard" | "wide" | "full";
};

const widthClasses: Record<
  NonNullable<DashboardPageShellProps["width"]>,
  string
> = {
  standard: "max-w-5xl",
  wide: "max-w-[1280px]",
  full: "max-w-[1680px]",
};

export function DashboardPageShell({
  children,
  className,
  width = "standard",
}: DashboardPageShellProps) {
  return (
    <div
      className={cn(
        "dashboard-page-shell mx-auto flex w-full min-w-0 flex-col gap-4 pb-8",
        widthClasses[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

type DashboardPageHeaderProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function DashboardPageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: DashboardPageHeaderProps) {
  return (
    <header
      className={cn(
        "dashboard-page-header flex min-w-0 flex-col gap-3 pb-1 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
      data-dashboard-page-header
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="dashboard-page-header__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-[28px] text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-default-500">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="dashboard-page-header__actions flex min-w-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
