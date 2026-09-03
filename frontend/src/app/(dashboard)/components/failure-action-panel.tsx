"use client";

import Link from "next/link";
import { Button, Card, CardBody } from "@heroui/react";
import { AlertTriangle, RotateCcw } from "@/components/iconpark";
import { commercialDisplayText, commercialPrimaryText } from "@/lib/commercial-display-text";

type FailureAction = {
  href?: string;
  label: string;
  onPress?: () => void;
};

type FailureActionPanelProps = {
  actions?: FailureAction[];
  impact: string;
  nextAction: string;
  reason: string;
  technicalDetails?: Array<string | null | undefined> | string;
  title?: string;
};

export function FailureActionPanel({
  actions = [],
  impact,
  nextAction,
  reason,
  technicalDetails,
  title = "需要处理",
}: FailureActionPanelProps) {
  const normalizedDetails = Array.isArray(technicalDetails)
    ? technicalDetails
        .map((item) => (item ? commercialDisplayText(item) : ""))
        .filter(Boolean)
    : technicalDetails
      ? [commercialDisplayText(technicalDetails)]
      : [];

  return (
    <Card className="border-small border-warning-200 bg-warning-50 shadow-none">
      <CardBody className="gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 text-warning" />
          <h3 className="text-small font-semibold text-warning-700">
            {title}
          </h3>
        </div>
        <div className="min-w-0">
          <p className="text-small leading-5 text-warning-800">
            {commercialPrimaryText(reason)}
          </p>
          <p className="mt-1 text-small font-medium leading-5 text-default-700">
            下一步：{commercialPrimaryText(nextAction)}
          </p>
        </div>
        {actions.length ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) =>
              action.href ? (
                <Button
                  key={`${action.label}-${action.href}`}
                  as={Link}
                  href={action.href}
                  size="sm"
                  startContent={<RotateCcw className="h-4 w-4" />}
                  variant="flat"
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  key={action.label}
                  size="sm"
                  startContent={<RotateCcw className="h-4 w-4" />}
                  variant="flat"
                  onPress={action.onPress}
                >
                  {action.label}
                </Button>
              ),
            )}
          </div>
        ) : null}
        {normalizedDetails.length ? (
          <details className="mt-1 text-tiny text-default-500">
            <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-warning-700 underline decoration-dotted underline-offset-4 transition-colors hover:text-warning-900">
              查看高级信息
            </summary>
            <div className="mt-2 grid gap-1">
              <InfoBlock label="影响" value={impact} />
              {normalizedDetails.map((detail, index) => (
                <p key={`${detail}-${index}`} className="break-words leading-5">
                  {detail}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-default-50 px-2.5 py-2">
      <p className="text-tiny font-semibold text-default-500">{label}</p>
      <p className="mt-0.5 text-small leading-5 text-default-700">
        {commercialDisplayText(value)}
      </p>
    </div>
  );
}
