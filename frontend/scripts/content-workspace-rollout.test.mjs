import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_WORKSPACE_EVENT_NAMES,
  CONTENT_WORKSPACE_FLAG_KEY,
  contentWorkspaceBucket,
  isContentWorkspaceRolloutEligible,
  recordContentWorkspaceMetric,
  readContentWorkspaceRolloutConfig,
} from "../src/lib/content-workspace/rollout.ts";

test("rollout is closed by default and rollback is explicit", () => {
  const config = readContentWorkspaceRolloutConfig({});
  assert.equal(config.flagKey, CONTENT_WORKSPACE_FLAG_KEY);
  assert.equal(config.enabled, false);
  assert.equal(config.rolloutPercent, 0);
  assert.equal(isContentWorkspaceRolloutEligible(config, 0), false);

  const rollback = readContentWorkspaceRolloutConfig({
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED: "false",
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "100",
  });
  assert.equal(rollback.enabled, false);
  assert.equal(isContentWorkspaceRolloutEligible(rollback, 0), false);
});

test("rollout percentage is bounded to a whole number", () => {
  assert.equal(
    readContentWorkspaceRolloutConfig({
      NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED: "true",
      NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "12",
    }).rolloutPercent,
    12,
  );
  assert.equal(
    readContentWorkspaceRolloutConfig({
      NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "-20",
    }).rolloutPercent,
    0,
  );
  assert.equal(
    readContentWorkspaceRolloutConfig({
      NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "120",
    }).rolloutPercent,
    0,
  );
});

test("the same authenticated user stays in the same cohort", () => {
  const first = contentWorkspaceBucket("user-alpha");
  assert.equal(contentWorkspaceBucket("user-alpha"), first);
  assert.notEqual(contentWorkspaceBucket("user-beta"), first);

  const config = readContentWorkspaceRolloutConfig({
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED: "true",
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "10",
  });
  assert.equal(isContentWorkspaceRolloutEligible(config, 9), true);
  assert.equal(isContentWorkspaceRolloutEligible(config, 10), false);
});

test("the ten percent cohort is distributed without persisting identity", () => {
  const config = readContentWorkspaceRolloutConfig({
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ENABLED: "true",
    NEXT_PUBLIC_CONTENT_WORKSPACE_RESULT_ENTRY_ROLLOUT_PERCENT: "10",
  });
  const eligible = Array.from({ length: 10_000 }, (_, index) =>
    isContentWorkspaceRolloutEligible(
      config,
      contentWorkspaceBucket(`qa-user-${index}`),
    ),
  ).filter(Boolean).length;
  assert.ok(eligible > 700 && eligible < 1_300, `eligible=${eligible}`);
});

test("event dictionary is fixed to the S2 result-entry lifecycle", () => {
  assert.deepEqual(CONTENT_WORKSPACE_EVENT_NAMES, [
    "result_entry_viewed",
    "intent_form_viewed",
    "intent_submitted",
    "draft_created",
    "draft_create_failed",
  ]);
});

test("metric sink redacts unapproved fields and survives storage failure", () => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  let detail;
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    dispatchEvent(event) {
      detail = event.detail;
    },
    sessionStorage: {
      getItem() {
        throw new Error("quota");
      },
      setItem() {
        throw new Error("quota");
      },
    },
  };

  try {
    recordContentWorkspaceMetric(
      "intent_submitted",
      {
        status: "enabled",
        flagKey: CONTENT_WORKSPACE_FLAG_KEY,
        enabled: true,
        rolloutPercent: 10,
        reason: "eligible",
        bucket: 4,
      },
      {
        task: "create",
        platform: "wechat",
        errorCode: "none",
        userId: "must-not-persist",
        goal: "must-not-persist",
      },
    );
    assert.deepEqual(Object.keys(detail).sort(), [
      "eventName",
      "flagEnabled",
      "flagKey",
      "occurredAt",
      "platform",
      "rolloutPercent",
      "schemaVersion",
      "task",
      "errorCode",
    ].sort());
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});
