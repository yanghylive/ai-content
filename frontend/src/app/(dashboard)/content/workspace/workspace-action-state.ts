import type { WorkspaceStepId } from "./workspace-types";

export type ContentEditorPrimaryAction =
  | "resolve-rule-preview"
  | "advance"
  | "blocked"
  | "prepare";

export function shouldShowRulePreview(
  activeStep: WorkspaceStepId,
  hasCandidate: boolean,
) {
  return activeStep === "draft" && hasCandidate;
}

export function resolveContentEditorPrimaryAction({
  activeStep,
  hasCandidate,
  hasNextStep,
  nextStepBlocked,
}: {
  activeStep: WorkspaceStepId;
  hasCandidate: boolean;
  hasNextStep: boolean;
  nextStepBlocked: boolean;
}): ContentEditorPrimaryAction {
  if (shouldShowRulePreview(activeStep, hasCandidate)) {
    return "resolve-rule-preview";
  }
  if (hasNextStep) {
    return nextStepBlocked ? "blocked" : "advance";
  }
  return "prepare";
}

export function shouldClearRulePreviewOnStepChange(
  currentStep: WorkspaceStepId,
  nextStep: WorkspaceStepId,
) {
  return currentStep !== nextStep;
}

export function getVersionRowActionAppearance() {
  return { color: "default", variant: "bordered" } as const;
}
