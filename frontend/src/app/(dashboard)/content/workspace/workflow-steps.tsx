"use client";

import { Check } from "lucide-react";
import { WORKSPACE_STEPS, type WorkspaceStepId } from "./workspace-types";

type WorkflowStepsProps = {
  activeStep: WorkspaceStepId;
  isStepDisabled?: (step: WorkspaceStepId) => boolean;
  onStepChange: (step: WorkspaceStepId) => void;
};

export function WorkflowSteps({
  activeStep,
  isStepDisabled,
  onStepChange,
}: WorkflowStepsProps) {
  const activeIndex = WORKSPACE_STEPS.findIndex((item) => item.id === activeStep);

  return (
    <nav
      aria-label="内容创作步骤"
      className="border-b border-divider bg-content1"
    >
      <ol className="grid grid-cols-5">
        {WORKSPACE_STEPS.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.id === activeStep;
          const isComplete = index < activeIndex;
          const isDisabled = isStepDisabled?.(step.id) ?? false;
          return (
            <li key={step.id} className="min-w-0">
              <button
                aria-current={isActive ? "step" : undefined}
                aria-label={`${index + 1}. ${step.label}：${step.description}`}
                className={`group flex min-h-14 w-full flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-12 sm:flex-row sm:gap-1.5 sm:px-2 sm:text-left xl:justify-start xl:px-3 ${
                  isActive
                    ? "border-primary bg-primary-50 text-primary-700"
                    : "border-transparent text-default-500 hover:bg-default-50 hover:text-foreground"
                }`}
                disabled={isDisabled}
                type="button"
                onClick={() => onStepChange(step.id)}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border sm:h-7 sm:w-7 ${
                    isActive
                      ? "border-primary-300 bg-primary-100 text-primary-700"
                      : isComplete
                        ? "border-success-200 bg-success-50 text-success-700"
                        : "border-divider bg-content1 text-default-500"
                  }`}
                >
                  {isComplete ? (
                    <Check aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  ) : (
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  )}
                </span>
                <span className="min-w-0 max-w-full">
                  <span className="block whitespace-nowrap text-[11px] font-semibold leading-4">
                    {step.label}
                  </span>
                  <span className="hidden truncate text-[11px] leading-4 text-default-400 2xl:block">
                    {step.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
