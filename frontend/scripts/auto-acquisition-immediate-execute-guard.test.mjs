import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pageSource = readFileSync(
  path.join(frontendRoot, "src/app/(dashboard)/apps/auto-acquisition/page.tsx"),
  "utf8",
);

test("auto acquisition keeps scheduling and exposes a form-level immediate action", () => {
  assert.match(pageSource, /label="每天启动时间"/);
  assert.match(pageSource, /\{editingId \? "保存" : "创建"\}/);
  assert.match(
    pageSource,
    /\{editingId \? "保存并立即执行" : "创建并立即执行"\}/,
  );
  assert.match(pageSource, /onPress=\{requestDraftImmediateExecution\}/);
  assert.match(pageSource, /!enabled/);
});

test("draft and saved immediate actions share one visible risk confirmation", () => {
  assert.match(pageSource, /import \{ RiskConfirmationDialog \}/);
  assert.match(pageSource, /title="确认立即执行短视频评论获客"/);
  assert.match(pageSource, /可能产生真实评论回复/);
  assert.match(pageSource, /可能在外部评论区产生真实写入/);
  assert.match(
    pageSource,
    /onPress=\{\(\) =>\s*requestSavedImmediateExecution\(config\)\s*\}/,
  );
  assert.doesNotMatch(
    pageSource,
    /onPress=\{\(\) => void executeConfig\(config\)\}/,
  );
});

test("confirmation saves a draft before using the single execute API path", () => {
  const executeCalls =
    pageSource.match(/aiEmployeeApi\.executeAutoAcquisitionConfig\(/g) || [];
  assert.equal(executeCalls.length, 1);
  assert.match(
    pageSource,
    /const savedConfig = normalizeStoredConfig\([\s\S]*?createAutoAcquisitionConfig\(next\)[\s\S]*?if \(executeAfterSave\)[\s\S]*?await executeConfig\(savedConfig\)/,
  );
  assert.match(
    pageSource,
    /async function confirmImmediateExecution\(\)[\s\S]*?submitConfig\(\{ executeAfterSave: true \}\)[\s\S]*?executeConfig\(pending\.config\)/,
  );
  assert.match(
    pageSource,
    /createAutoAcquisitionExecutionConfirmation\([\s\S]*?executeAutoAcquisitionConfig\([\s\S]*?confirmationId: approval\.confirmationId/,
  );
  assert.match(pageSource, /immediateExecutionLockRef\.current/);
  assert.match(pageSource, /setConfirmingImmediateExecution\(true\)/);
  assert.match(pageSource, /isLoading=\{confirmingImmediateExecution\}/);
});
