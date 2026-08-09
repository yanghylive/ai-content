#!/usr/bin/env node

import { readFileSync } from "node:fs";

export const ALLOWED_EVENT_NAMES = new Set([
  "result_entry_viewed",
  "intent_form_viewed",
  "intent_submitted",
  "draft_created",
  "draft_create_failed",
]);

const FORBIDDEN_KEYS = new Set([
  "userId",
  "tenantId",
  "brandId",
  "goal",
  "articleId",
  "materialIds",
  "citationIds",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function readEventsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  const object = asObject(payload);
  if (!object) return [];
  if (Array.isArray(object.events)) return object.events;
  if (Array.isArray(object.metrics)) return object.metrics;
  return [];
}

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  const object = asObject(value);
  if (!object) return false;
  return Object.entries(object).some(
    ([key, child]) => FORBIDDEN_KEYS.has(key) || hasForbiddenKey(child),
  );
}

export function validateRolloutEvent(event, index) {
  const issues = [];
  const object = asObject(event);
  if (!object) {
    return [`event[${index}] must be an object`];
  }
  if (!ALLOWED_EVENT_NAMES.has(object.eventName)) {
    issues.push(`event[${index}] has an unknown eventName`);
  }
  if (object.schemaVersion !== 1) {
    issues.push(`event[${index}] has an unsupported schemaVersion`);
  }
  if (typeof object.flagEnabled !== "boolean") {
    issues.push(`event[${index}] flagEnabled must be boolean`);
  }
  if (
    !Number.isInteger(object.rolloutPercent) ||
    object.rolloutPercent < 0 ||
    object.rolloutPercent > 100
  ) {
    issues.push(`event[${index}] rolloutPercent must be an integer from 0 to 100`);
  }
  if (typeof object.occurredAt !== "string" || !object.occurredAt.trim()) {
    issues.push(`event[${index}] occurredAt is required`);
  }
  if (hasForbiddenKey(object)) {
    issues.push(`event[${index}] contains a forbidden identity or content field`);
  }
  return issues;
}

export function summarizeRolloutEvents(input) {
  const events = readEventsPayload(input);
  const accepted = [];
  const rejectionReasons = [];
  let rejectedEvents = 0;
  events.forEach((event, index) => {
    const issues = validateRolloutEvent(event, index);
    if (issues.length) {
      rejectedEvents += 1;
      rejectionReasons.push(...issues);
    }
    else accepted.push(event);
  });

  const counts = Object.fromEntries(
    [...ALLOWED_EVENT_NAMES].map((eventName) => [eventName, 0]),
  );
  const rolloutStates = {};
  for (const event of accepted) {
    counts[event.eventName] += 1;
    const state = `${event.flagEnabled ? "enabled" : "disabled"}:${event.rolloutPercent}`;
    rolloutStates[state] = (rolloutStates[state] || 0) + 1;
  }

  const submitted = counts.intent_submitted;
  const created = counts.draft_created;
  const failed = counts.draft_create_failed;
  return {
    schemaVersion: 1,
    inputEvents: events.length,
    acceptedEvents: accepted.length,
    rejectedEvents,
    rejectionReasons,
    counts,
    rolloutStates,
    funnel: {
      draftCreateSuccessRate:
        submitted > 0 ? Number((created / submitted).toFixed(4)) : null,
      draftCreateFailureRate:
        submitted > 0 ? Number((failed / submitted).toFixed(4)) : null,
    },
  };
}

function parseArgs(argv) {
  const args = { input: "", json: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") args.input = argv[++index] || "";
    else if (value === "--json") args.json = true;
    else if (value === "--strict") args.strict = true;
  }
  return args;
}

export function runRolloutReport(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.input) {
    return {
      exitCode: 2,
      output: "Usage: node content-workspace-rollout-report.mjs --input events.json [--json] [--strict]",
    };
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(args.input, "utf8"));
  } catch {
    return { exitCode: 2, output: `Cannot read JSON input: ${args.input}` };
  }
  const report = summarizeRolloutEvents(payload);
  if (args.strict && report.rejectedEvents > 0) {
    report.strictFailure = true;
  }
  return {
    exitCode: report.strictFailure ? 1 : 0,
    output: args.json
      ? JSON.stringify(report, null, 2)
      : [
          `accepted=${report.acceptedEvents}`,
          `rejected=${report.rejectedEvents}`,
          `result_entry_viewed=${report.counts.result_entry_viewed}`,
          `intent_form_viewed=${report.counts.intent_form_viewed}`,
          `intent_submitted=${report.counts.intent_submitted}`,
          `draft_created=${report.counts.draft_created}`,
          `draft_create_failed=${report.counts.draft_create_failed}`,
          `draft_create_success_rate=${report.funnel.draftCreateSuccessRate ?? "n/a"}`,
          `draft_create_failure_rate=${report.funnel.draftCreateFailureRate ?? "n/a"}`,
        ].join("\n"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runRolloutReport();
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}
