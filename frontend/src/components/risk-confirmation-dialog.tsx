"use client";

import React from "react";
import { AlertTriangle, ShieldAlert } from "@/components/iconpark";
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";

type RiskLevel = "low" | "medium" | "high";

type RiskConfirmationDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  riskLevel?: RiskLevel;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  impactItems?: Array<{
    label: string;
    value: React.ReactNode;
  }>;
  checklist?: string[];
};

const riskMeta: Record<
  RiskLevel,
  {
    label: string;
    color: "default" | "warning" | "danger";
    iconColor: string;
    iconBg: string;
    panelClassName: string;
  }
> = {
  low: {
    label: "低风险",
    color: "default",
    iconColor: "text-default-600",
    iconBg: "bg-default-100",
    panelClassName: "border-default-200 bg-default-50 text-default-700",
  },
  medium: {
    label: "中风险",
    color: "warning",
    iconColor: "text-warning-600",
    iconBg: "bg-warning-100",
    panelClassName: "border-warning-200 bg-warning-50 text-warning-700",
  },
  high: {
    label: "高风险",
    color: "danger",
    iconColor: "text-danger",
    iconBg: "bg-danger-50",
    panelClassName: "border-danger-200 bg-danger-50 text-danger-700",
  },
};

export function RiskConfirmationDialog({
  isOpen,
  title,
  description,
  riskLevel = "high",
  confirmLabel = "确认执行",
  cancelLabel = "取消",
  isLoading,
  onCancel,
  onConfirm,
  impactItems = [],
  checklist = [],
}: RiskConfirmationDialogProps) {
  const meta = riskMeta[riskLevel];

  return (
    <Modal
      backdrop="blur"
      isDismissable={!isLoading}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isLoading) onCancel();
      }}
      size="md"
      classNames={{
        base: "bg-background border-small border-divider",
        header: "border-b-small border-divider",
        footer: "border-t-small border-divider",
      }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-3 pt-6">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${meta.iconBg} ${meta.iconColor}`}
                >
                  {riskLevel === "high" ? (
                    <ShieldAlert className="h-5 w-5" strokeWidth={1.9} />
                  ) : (
                    <AlertTriangle className="h-5 w-5" strokeWidth={1.9} />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold leading-6">
                      {title}
                    </span>
                    <Chip color={meta.color} size="sm" variant="flat">
                      {meta.label}
                    </Chip>
                  </div>
                  <p className="mt-1 text-small font-normal leading-6 text-default-500">
                    {description}
                  </p>
                </div>
              </div>
            </ModalHeader>
            <ModalBody className="gap-4 py-5">
              {impactItems.length ? (
                <div className="grid gap-2 rounded-[8px] border-small border-divider bg-default-50 p-3">
                  {impactItems.map((item) => (
                    <div
                      key={item.label}
                      className="grid gap-1 text-small md:grid-cols-[96px_1fr]"
                    >
                      <span className="font-semibold text-default-500">
                        {item.label}
                      </span>
                      <span className="min-w-0 break-words text-default-800">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {checklist.length ? (
                <div
                  className={`rounded-[8px] border-small px-4 py-3 text-small leading-6 ${meta.panelClassName}`}
                >
                  <p className="font-semibold">确认前请检查：</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {checklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div
                  className={`rounded-[8px] border-small px-4 py-3 text-small leading-6 ${meta.panelClassName}`}
                >
                  这一步会影响真实数据或外部平台状态，确认后会继续执行。
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                color="default"
                isDisabled={isLoading}
                variant="flat"
                onPress={onCancel}
              >
                {cancelLabel}
              </Button>
              <Button
                color={riskLevel === "high" ? "danger" : "primary"}
                isLoading={isLoading}
                onPress={onConfirm}
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
