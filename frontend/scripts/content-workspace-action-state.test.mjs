import assert from "node:assert/strict";
import test from "node:test";
import {
  getVersionRowActionAppearance,
  resolveContentEditorPrimaryAction,
  shouldClearRulePreviewOnStepChange,
  shouldShowRulePreview,
} from "../src/app/(dashboard)/content/workspace/workspace-action-state.ts";

test("a pending draft rule preview owns the only primary action", () => {
  assert.equal(shouldShowRulePreview("draft", true), true);
  assert.equal(
    resolveContentEditorPrimaryAction({
      activeStep: "draft",
      hasCandidate: true,
      hasNextStep: true,
      nextStepBlocked: false,
    }),
    "resolve-rule-preview",
  );
});

test("normal progression, blocked steps, and review preparation stay distinct", () => {
  assert.equal(
    resolveContentEditorPrimaryAction({
      activeStep: "draft",
      hasCandidate: false,
      hasNextStep: true,
      nextStepBlocked: false,
    }),
    "advance",
  );
  assert.equal(
    resolveContentEditorPrimaryAction({
      activeStep: "outline",
      hasCandidate: false,
      hasNextStep: true,
      nextStepBlocked: true,
    }),
    "blocked",
  );
  assert.equal(
    resolveContentEditorPrimaryAction({
      activeStep: "review",
      hasCandidate: false,
      hasNextStep: false,
      nextStepBlocked: false,
    }),
    "prepare",
  );
});

test("rule previews cannot leak across steps", () => {
  assert.equal(shouldShowRulePreview("versions", true), false);
  assert.equal(shouldClearRulePreviewOnStepChange("draft", "versions"), true);
  assert.equal(shouldClearRulePreviewOnStepChange("draft", "draft"), false);
});

test("version row actions remain secondary to footer progression", () => {
  assert.deepEqual(getVersionRowActionAppearance(), {
    color: "default",
    variant: "bordered",
  });
});
