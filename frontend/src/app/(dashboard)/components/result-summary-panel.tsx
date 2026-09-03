"use client";

import type React from "react";
import Link from "next/link";
import { Button, Card, CardBody, Chip } from "@heroui/react";
import {
  ArrowRight,
  CheckCircle2,
  CopyPlus,
  Download,
  RotateCcw,
  XCircle,
} from "@/components/iconpark";
import { commercialPrimaryText } from "@/lib/commercial-display-text";

type ResultSummaryAction = {
  href?: string;
  label: string;
  onPress?: () => void;
  tone?: "primary" | "default";
};

type ResultSummaryPanelProps = {
  actions?: ResultSummaryAction[];
  failed?: number;
  skipped?: number;
  subtitle?: string;
  succeeded?: number;
  title: string;
  total?: number;
};

export function ResultSummaryPanel({
  actions = [],
  failed = 0,
  skipped = 0,
  subtitle,
  succeeded = 0,
  title,
  total,
}: ResultSummaryPanelProps) {
  const totalValue = total ?? succeeded + failed + skipped;
  return (
    <Card className="border-small border-divider bg-background shadow-none">
      <CardBody className="gap-2 p-3">
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip color="primary" size="sm" variant="flat">
                结果摘要
              </Chip>
              <h3 className="text-small font-semibold text-default-900">
                {commercialPrimaryText(title)}
              </h3>
            </div>
            {subtitle ? (
              <p className="mt-0.5 truncate text-tiny leading-5 text-default-500" title={commercialPrimaryText(subtitle)}>
                {commercialPrimaryText(subtitle)}
              </p>
            ) : null}
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-1.5 text-center">
            <SummaryNumber label="总数" value={totalValue} />
            <SummaryNumber
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="成功"
              tone="success"
              value={succeeded}
            />
            <SummaryNumber
              icon={<XCircle className="h-3.5 w-3.5" />}
              label="失败"
              tone={failed ? "danger" : "default"}
              value={failed}
            />
            <SummaryNumber label="跳过" tone="warning" value={skipped} />
          </div>
        </div>
        {actions.length ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action, index) => {
              const icon =
                action.label.includes("复用") || action.label.includes("复制") ? (
                  <CopyPlus className="h-4 w-4" />
                ) : action.label.includes("导出") ? (
                  <Download className="h-4 w-4" />
                ) : action.label.includes("重试") ? (
                  <RotateCcw className="h-4 w-4" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                );
              const color =
                action.tone === "primary" || index === 0
                  ? ("primary" as const)
                  : ("default" as const);
              if (action.href) {
                return (
                  <Button
                    key={`${action.label}-${action.href}`}
                    as={Link}
                    color={color}
                    href={action.href}
                    size="sm"
                    startContent={icon}
                    variant="flat"
                  >
                    {action.label}
                  </Button>
                );
              }
              return (
                <Button
                  key={action.label}
                  color={color}
                  size="sm"
                  startContent={icon}
                  variant="flat"
                  onPress={action.onPress}
                >
                  {action.label}
                </Button>
              );
            })}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function SummaryNumber({
  icon,
  label,
  tone = "default",
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
  value: number;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success-50 text-success-700"
      : tone === "warning"
        ? "bg-warning-50 text-warning-700"
        : tone === "danger"
          ? "bg-danger-50 text-danger-700"
          : "bg-default-100 text-default-700";
  return (
    <div className={`min-w-[56px] rounded-[6px] px-1.5 py-1 ${toneClass}`}>
      <p className="flex items-center justify-center gap-1 text-11 font-semibold">
        {icon}
        {label}
      </p>
      <p className="text-base font-bold leading-5">{value}</p>
    </div>
  );
}
