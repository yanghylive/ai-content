import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { completeWorkspaceBriefFieldSources } from "../src/lib/content-workspace-types.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const read = (relativePath) =>
  readFileSync(path.join(frontendRoot, relativePath), "utf8");

test("legacy documents receive explainable suggestions without inventing a deadline", () => {
  const api = read("src/lib/api/content-workspace.ts");
  assert.match(api, /function suggestedWorkspaceBrief/);
  assert.match(api, /根据关联选题预填/);
  assert.match(api, /根据选题关键词建议/);
  assert.match(api, /未指定发布平台/);
  assert.match(api, /未关联营销任务，可选填/);
  assert.match(api, /deadline: null/);
});

test("a non-empty historical brief receives explicit unknown provenance", () => {
  const brief = completeWorkspaceBriefFieldSources({
    goal: "提升转化",
    audience: "门店会员",
    platforms: [],
    deadline: null,
    action: "预约到店",
    constraints: "不得夸大承诺",
  });

  assert.deepEqual(brief.fieldSources?.goal, {
    source: "legacy_unknown",
    label: "历史简报，来源未记录",
    edited: false,
  });
  assert.deepEqual(brief.fieldSources?.platforms, {
    source: "unavailable",
    label: "尚未关联来源",
    edited: false,
  });
  assert.deepEqual(brief.fieldSources?.deadline, {
    source: "unavailable",
    label: "尚未关联来源",
    edited: false,
  });
});

test("partial historical provenance is preserved and only missing fields are completed", () => {
  const brief = completeWorkspaceBriefFieldSources({
    goal: "提升转化",
    audience: "门店会员",
    platforms: ["wechat"],
    deadline: null,
    action: "预约到店",
    constraints: "不得夸大承诺",
    fieldSources: {
      goal: {
        source: "user",
        label: "已由你修改",
        edited: true,
      },
    },
  });

  assert.deepEqual(brief.fieldSources?.goal, {
    source: "user",
    label: "已由你修改",
    edited: true,
  });
  assert.equal(brief.fieldSources?.audience?.source, "legacy_unknown");
  assert.equal(brief.fieldSources?.platforms?.source, "legacy_unknown");
  assert.equal(Object.keys(brief.fieldSources || {}).length, 6);
});

test("editing any brief field replaces its provenance with a persisted user marker", () => {
  const editor = read(
    "src/app/(dashboard)/content/workspace/content-editor.tsx",
  );
  assert.match(editor, /function briefFieldSourcesAfterEdit/);
  assert.match(
    editor,
    /source: "user", label: "已由你修改", edited: true/,
  );
  assert.doesNotMatch(editor, /已有简报内容/);
  for (const field of [
    "goal",
    "audience",
    "platforms",
    "deadline",
    "action",
    "constraints",
  ]) {
    assert.match(editor, new RegExp(`briefFieldDescription\\(value\\.brief, "${field}"\\)`));
    assert.match(
      editor,
      new RegExp(`briefFieldSourcesAfterEdit\\(value\\.brief, "${field}"\\)`),
    );
  }
});
