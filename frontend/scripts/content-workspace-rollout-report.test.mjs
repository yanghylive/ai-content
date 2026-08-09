import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  runRolloutReport,
  summarizeRolloutEvents,
  validateRolloutEvent,
} from "./content-workspace-rollout-report.mjs";

const baseEvent = (eventName, overrides = {}) => ({
  schemaVersion: 1,
  eventName,
  flagKey: "content_workspace_result_entry_v1",
  flagEnabled: true,
  rolloutPercent: 10,
  task: "create",
  platform: "wechat",
  occurredAt: "2026-07-26T18:00:00.000Z",
  ...overrides,
});

test("report accepts the frozen lifecycle and computes rates", () => {
  const report = summarizeRolloutEvents([
    baseEvent("result_entry_viewed"),
    baseEvent("intent_form_viewed"),
    baseEvent("intent_submitted"),
    baseEvent("draft_created"),
    baseEvent("intent_submitted"),
    baseEvent("draft_create_failed"),
  ]);
  assert.equal(report.acceptedEvents, 6);
  assert.equal(report.rejectedEvents, 0);
  assert.equal(report.funnel.draftCreateSuccessRate, 0.5);
  assert.equal(report.funnel.draftCreateFailureRate, 0.5);
});

test("report rejects unknown events and identity/content fields", () => {
  const event = baseEvent("unknown_event", {
    userId: "user-leak",
    goal: "content leak",
  });
  assert.ok(validateRolloutEvent(event, 0).length >= 2);
  const report = summarizeRolloutEvents([event]);
  assert.equal(report.acceptedEvents, 0);
  assert.equal(report.rejectedEvents, 1);
});

test("strict CLI mode fails when input contains rejected events", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "content-rollout-report-"));
  const input = path.join(root, "events.json");
  try {
    writeFileSync(input, JSON.stringify([baseEvent("bad")]), "utf8");
    const result = runRolloutReport(["--input", input, "--json", "--strict"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /rejectedEvents/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI accepts the sessionStorage export wrapper", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "content-rollout-report-"));
  const input = path.join(root, "events.json");
  try {
    writeFileSync(
      input,
      JSON.stringify({ metrics: [baseEvent("draft_created")] }),
      "utf8",
    );
    const result = runRolloutReport(["--input", input, "--json"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /"acceptedEvents": 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
