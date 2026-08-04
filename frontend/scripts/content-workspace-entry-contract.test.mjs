import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_INTENTS,
  buildWorkspaceIntentDraftInput,
  buildWorkspaceIntentHref,
  parseWorkspaceIntent,
  shouldShowWorkspaceIntent,
} from "../src/app/(dashboard)/content/workspace/workspace-intent.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const read = (relativePath) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

const expectedIntents = ["create", "multiplatform", "prepare", "rewrite"];

function intentValues() {
  return (Array.isArray(WORKSPACE_INTENTS)
    ? WORKSPACE_INTENTS.map((item) =>
        typeof item === "string" ? item : item.id,
      )
    : Object.keys(WORKSPACE_INTENTS)
  ).sort();
}

function assertIntentLink(source, intent) {
  const helperCall = new RegExp(
    `buildWorkspaceIntentHref\\(\\s*["']${intent}["']\\s*\\)`,
  );
  const literalHref = new RegExp(
    `["']/content/workspace\\?intent=${intent}["']`,
  );
  assert.ok(
    helperCall.test(source) || literalHref.test(source),
    `missing content workspace link for intent=${intent}`,
  );
}

test("workspace intent v1 exposes exactly the four frozen task values", () => {
  assert.deepEqual(intentValues(), expectedIntents);

  for (const intent of expectedIntents) {
    assert.equal(parseWorkspaceIntent(new URLSearchParams({ intent })), intent);
    assert.equal(
      buildWorkspaceIntentHref(intent),
      `/content/workspace?intent=${intent}`,
    );
  }

  assert.deepEqual(
    buildWorkspaceIntentDraftInput("rewrite", "  提升表达清晰度  ", "wechat")
      .workspaceIntent,
    {
      task: "rewrite",
      goal: "提升表达清晰度",
      platforms: ["wechat"],
    },
  );
});

test("unknown, missing, and legacy publish intents never enter the intent flow", () => {
  for (const intent of ["", "unknown", "publish", "CREATE", "../create"]) {
    const params = new URLSearchParams();
    if (intent) params.set("intent", intent);
    assert.equal(parseWorkspaceIntent(params), null);
    assert.equal(shouldShowWorkspaceIntent(params), false);
  }
});

test("legacy articleId or step deep links take precedence over a valid intent", () => {
  assert.equal(
    shouldShowWorkspaceIntent(new URLSearchParams({ intent: "create" })),
    true,
  );

  for (const params of [
    { intent: "create", articleId: "article-1" },
    { intent: "rewrite", step: "outline" },
    { articleId: "article-1" },
    { step: "brief" },
  ]) {
    assert.equal(shouldShowWorkspaceIntent(new URLSearchParams(params)), false);
  }
});

test("the home page renders all four result-oriented content entries", () => {
  const page = read("src/app/(dashboard)/page-legacy.tsx");
  const entry = read("src/app/(dashboard)/components/content-result-entry.tsx");
  assert.match(page, /ContentResultEntry/);
  assert.match(page, /<ContentResultEntry\s*\/>/);
  assert.match(entry, /WORKSPACE_INTENTS\.map/);
  assert.match(entry, /href\s*=\s*{buildWorkspaceIntentHref\(intent\.id\)}/);

  assert.deepEqual(
    Object.fromEntries(
      WORKSPACE_INTENTS.map((definition) => [
        definition.id,
        definition.label,
      ]),
    ),
    {
      create: "写一篇内容",
      rewrite: "改写已有内容",
      multiplatform: "生成多平台版本",
      prepare: "准备发布",
    },
  );
});

test("the start-task content entry uses create intent while the legacy route remains", () => {
  const solutions = read("src/app/(dashboard)/solutions/page-legacy.tsx");
  const intentEntry = read(
    "src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
  );
  const sidebar = read("src/app/(dashboard)/sidebar-items.tsx");
  const contentEntry = solutions.match(
    /title:\s*["']写内容和做素材["'][\s\S]{0,800}?(?=\n\s*},)/,
  );

  assert.ok(contentEntry, "missing 写内容和做素材 entry");
  assertIntentLink(contentEntry[0], "create");
  assert.match(
    `${intentEntry}\n${sidebar}`,
    /["']\/content\/optimization["']/,
  );
});

test("the workspace route shows intent UI only for a valid non-legacy intent", () => {
  const page = read("src/app/(dashboard)/content/workspace/page-legacy.tsx");
  const route = read(
    "src/app/(dashboard)/content/workspace/content-workspace-route.tsx",
  );

  assert.match(page, /ContentWorkspaceRoute/);
  assert.match(route, /shouldShowWorkspaceIntent/);
  assert.match(route, /ContentWorkspaceIntentEntry/);
  assert.match(route, /ContentWorkspaceClient/);
  assert.match(route, /useContentWorkspaceRollout/);
  assert.match(route, /rollout\.status\s*===\s*["']enabled["']/);
});

test("S2 wiring keeps the result entry behind a flag and records the frozen events", () => {
  const entry = read("src/app/(dashboard)/components/content-result-entry.tsx");
  const intentEntry = read(
    "src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
  );
  const rollout = read("src/lib/content-workspace/rollout.ts");
  assert.match(
    entry,
    /if\s*\(rollout\.status\s*!==\s*["']enabled["']\)\s*return\s+null/,
  );
  for (const eventName of [
    "result_entry_viewed",
    "intent_form_viewed",
    "intent_submitted",
    "draft_created",
    "draft_create_failed",
  ]) {
    assert.match(rollout, new RegExp(`['"]${eventName}['"]`));
  }
  assert.match(
    intentEntry,
    /recordContentWorkspaceMetric\("intent_submitted"/,
  );
  assert.match(intentEntry, /recordContentWorkspaceMetric\("draft_created"/);
  assert.match(
    intentEntry,
    /recordContentWorkspaceMetric\("draft_create_failed"/,
  );
});

test("new S1 UI surfaces stay inside the Astryx component boundary", () => {
  for (const relativePath of [
    "src/app/(dashboard)/components/content-result-entry.tsx",
    "src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
  ]) {
    const source = read(relativePath);
    assert.match(source, /from\s+["']@astryxdesign\/core\//);
    assert.doesNotMatch(source, /from\s+["']@heroui\/react["']/);
    assert.doesNotMatch(source, /<(?:div|span)(?:\s|>)/);
  }
});

test("successful intent creation persists once and opens the brief deep link", () => {
  const entry = read(
    "src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
  );
  const createCalls =
    entry.match(/(?:articlesApi|contentWorkspaceApi)\.createDraft\s*\(/g) || [];
  const createIndex = entry.search(
    /(?:articlesApi|contentWorkspaceApi)\.createDraft\s*\(/,
  );
  const navigateIndex = entry.indexOf("router.replace(");

  assert.equal(createCalls.length, 1);
  assert.match(
    entry,
    /buildWorkspaceIntentDraftInput\(\s*intent\s*,\s*goal\s*,\s*platform\s*\)/,
  );
  assert.match(
    entry,
    /const\s*\[\s*platforms?\s*,\s*setPlatforms?\s*\]\s*=\s*(?:React\.)?useState/,
  );
  assert.ok(createIndex >= 0 && navigateIndex > createIndex);
  assert.match(
    entry,
    /router\.replace\(\s*`\/content\/workspace\?articleId=\$\{encodeURIComponent\([^)]*\.id\)\}&step=brief`\s*,?\s*\)/,
  );
});

test("creation failure keeps entered values and exposes the same action for retry", () => {
  const entry = read(
    "src/app/(dashboard)/content/workspace/content-workspace-intent-entry.tsx",
  );
  const catchBlock = entry.match(
    /catch\s*\([^)]*\)\s*{([\s\S]*?)}\s*finally\s*{/,
  );

  assert.ok(catchBlock, "intent creation must handle request failure");
  assert.match(catchBlock[1], /set[A-Za-z]*Error\s*\(/);
  assert.doesNotMatch(catchBlock[1], /setGoal\s*\(\s*["']{2}\s*\)/);
  assert.doesNotMatch(catchBlock[1], /setPlatforms\s*\(\s*\[\s*\]\s*\)/);
  assert.doesNotMatch(catchBlock[1], /router\.(?:push|replace)\s*\(/);
  assert.match(entry, /(?:重试|重新创建)/);
  assert.match(
    entry,
    /(?:onSubmit|onPress)\s*=\s*{[^}\n]*(?:submit|create)[^}\n]*}/i,
  );
  assert.match(entry, /value\s*=\s*{goal}/);
});
