"use client";

import Link from "next/link";
import { Button, Card, CardBody } from "@heroui/react";
import { FilePlus2, Lightbulb, type LucideIcon } from "lucide-react";
import { commercialPrimaryText } from "@/lib/commercial-display-text";

type EmptyStateAction = {
  href?: string;
  icon?: LucideIcon;
  label: string;
  onPress?: () => void;
};

type FunctionalEmptyStateProps = {
  actions?: EmptyStateAction[];
  description: string;
  examples?: string[];
  icon?: LucideIcon;
  surface?: "card" | "plain";
  title: string;
};

export function FunctionalEmptyState({
  actions = [],
  description,
  examples = [],
  icon: IconComponent = FilePlus2,
  surface = "card",
  title,
}: FunctionalEmptyStateProps) {
  const content = (
    <div className="flex flex-col items-center gap-2.5 p-4 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-background text-primary">
          <IconComponent aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="max-w-xl">
          <p className="text-small font-semibold text-default-800">{commercialPrimaryText(title)}</p>
          <p className="mt-0.5 line-clamp-2 text-small leading-5 text-default-500" title={commercialPrimaryText(description)}>
            {commercialPrimaryText(description)}
          </p>
        </div>
        {examples.length ? (
          <div className="flex max-w-2xl flex-wrap justify-center gap-1.5">
            {examples.map((example) => (
              <span
                key={example}
                className="inline-flex items-center gap-1 rounded-[6px] bg-background px-2 py-1 text-tiny text-default-500"
              >
                <Lightbulb aria-hidden="true" className="h-3.5 w-3.5" />
                {commercialPrimaryText(example)}
              </span>
            ))}
          </div>
        ) : null}
        {actions.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {actions.map((action, index) => {
              const ActionIcon = action.icon || FilePlus2;
              const commonProps = {
                color: index === 0 ? ("primary" as const) : ("default" as const),
                size: "sm" as const,
                startContent: (
                  <ActionIcon aria-hidden="true" className="h-4 w-4" />
                ),
                variant: index === 0 ? ("solid" as const) : ("flat" as const),
              };
              if (action.href) {
                return (
                  <Button
                    key={`${action.label}-${action.href}`}
                    as={Link}
                    href={action.href}
                    {...commonProps}
                  >
                    {action.label}
                  </Button>
                );
              }
              return (
                <Button
                  key={action.label}
                  onPress={action.onPress}
                  {...commonProps}
                >
                  {action.label}
                </Button>
              );
            })}
          </div>
        ) : null}
    </div>
  );

  if (surface === "plain") {
    return (
      <div className="rounded-[8px] border-small border-dashed border-divider bg-default-50/70">
        {content}
      </div>
    );
  }

  return (
    <Card className="border-small border-divider bg-default-50 shadow-none">
      <CardBody className="p-0">{content}</CardBody>
    </Card>
  );
}
