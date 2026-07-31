"use client";

import Link from "next/link";
import { Button, Card, CardBody } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";

type CapabilityInfoAction = {
  label: string;
  href: string;
  icon?: string;
};

type CapabilityInfoItem = {
  title: string;
  description: string;
  icon: string;
};

type CapabilityInfoPageProps = {
  title: string;
  description: string;
  icon: string;
  primaryAction: CapabilityInfoAction;
  secondaryActions: CapabilityInfoAction[];
  items: CapabilityInfoItem[];
};

export function CapabilityInfoPage({
  title,
  description,
  icon,
  primaryAction,
  secondaryActions,
  items,
}: CapabilityInfoPageProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* 品牌信息条：让功能页统一露出 JIUZHANG AI 品牌 */}
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-divider bg-content1/60 px-4 py-2">
        <img
          src="/brand/jiuzhang-ai-logo.png"
          alt="JIUZHANG AI"
          className="h-5 w-auto shrink-0"
          draggable={false}
        />
        <span className="text-[12px] text-default-500">
          {title} · 由 JIUZHANG AI 智能驱动
        </span>
      </div>
      <Card className="border border-divider bg-content1 shadow-sm">
        <CardBody className="gap-5 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-primary-50 text-primary">
                <Icon icon={icon} width={24} />
              </div>
              <div className="min-w-0 space-y-2">
                <h1 className="text-[24px] font-semibold leading-8 text-foreground">
                  {title}
                </h1>
                <p className="max-w-3xl text-[14px] leading-6 text-default-500">
                  {description}
                </p>
              </div>
            </div>
            <Button
              as={Link}
              color="primary"
              href={primaryAction.href}
              startContent={
                primaryAction.icon ? <Icon icon={primaryAction.icon} /> : null
              }
            >
              {primaryAction.label}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {secondaryActions.map((action) => (
              <Button
                key={`${action.href}-${action.label}`}
                as={Link}
                className="justify-start"
                href={action.href}
                startContent={action.icon ? <Icon icon={action.icon} /> : null}
                variant="flat"
              >
                {action.label}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <Card
            key={item.title}
            className="border border-divider bg-content1 shadow-sm"
          >
            <CardBody className="gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-default-100 text-default-700">
                <Icon icon={item.icon} width={20} />
              </div>
              <div className="space-y-1">
                <h2 className="text-[15px] font-semibold text-foreground">
                  {item.title}
                </h2>
                <p className="text-[13px] leading-5 text-default-500">
                  {item.description}
                </p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
