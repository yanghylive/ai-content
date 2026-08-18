import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.join(
  scriptDir,
  "../src/app/(dashboard)/content/workspace",
);

function source(fileName) {
  return readFileSync(path.join(workspaceDir, fileName), "utf8");
}

test("workflow steps fit the viewport without a hidden horizontal track", () => {
  const steps = source("workflow-steps.tsx");
  assert.match(steps, /grid grid-cols-5/);
  assert.doesNotMatch(steps, /min-w-\[720px\]/);
  assert.doesNotMatch(steps, /overflow-x-auto/);
});

test("narrow workspaces expose context through a titled drawer", () => {
  // 2026-08-18：V2 换皮——队列面板已合并移除，仅保留创作上下文 drawer；
  // placement 固定 right（不再条件切换）；toolbar + Drawer isOpen 控制
  const tools = source("workspace-mobile-tools.tsx");
  assert.match(tools, /<Drawer/);
  assert.match(tools, /isContextOpen/);
  assert.match(tools, /创作上下文/);
  assert.match(tools, /placement="right"/);
  assert.match(tools, /w-\[85vw\]/);
});

test("desktop keeps responsive columns while drawer panels stay out of mobile flow", () => {
  // 2026-08-18：V2 换皮——三列 grid-cols-[280px_1fr_320px] 改单列基础
  // + lg:order 断点；移动工具 Drawer variant 保留
  const client = source("content-workspace-client.tsx");
  assert.match(client, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(client, /<WorkspaceMobileTools/);
  assert.match(client, /lg:order-2/);
  assert.match(client, /variant="drawer"/);
});

test("drawer and desktop context instances use distinct accessible ids", () => {
  const client = source("content-workspace-client.tsx");
  const context = source("workspace-context.tsx");
  assert.match(client, /idPrefix="workspace-context-mobile"/);
  assert.match(context, /idPrefix = "workspace-context"/);
  assert.match(context, /aria-controls=\{`\$\{idPrefix\}-\$\{tab\.id\}`\}/);
});

test("mobile editor keeps save and next-step actions at the viewport bottom", () => {
  const editor = source("content-editor.tsx");
  assert.match(editor, /fixed inset-x-0 bottom-0/);
  assert.match(editor, /--workspace-footer-left/);
  assert.match(editor, /--workspace-footer-width/);
  assert.match(editor, /md:left-\[var\(--workspace-footer-left\)\]/);
  assert.match(editor, /lg:static/);
  assert.match(editor, /mobilePanelOpen \? "hidden lg:flex" : "flex"/);
  assert.match(editor, /max-sm:pl-14/);
  assert.match(editor, /onPress=\{onSave\}/);
  assert.match(editor, /saveState === "error" \? "重试保存" : "保存"/);
  assert.match(editor, /继续：\{nextStep\.label\}/);
});

test("narrow layouts expose one save action and keep publish preparation in the review footer", () => {
  const header = source("workspace-header.tsx");
  const editor = source("content-editor.tsx");
  // 2026-08-18：header 重构为纯状态徽章（无操作按钮），隐藏类断言删除；
  // 发布准备入口收敛到 editor footer（onPrepare/Tooltip prepareHint）
  assert.doesNotMatch(header, /onPrepare|进入发布准备|prepareHint/);
  assert.match(editor, /onPress=\{onPrepare\}/);
  assert.match(editor, /进入发布准备/);
  assert.match(editor, /<Tooltip content=\{prepareHint\}>/);
});

test("local rule preview is disclosed and never persisted as an optimization version", () => {
  const client = source("content-workspace-client.tsx");
  const editor = source("content-editor.tsx");
  assert.match(client, /buildLocalRulePreview/);
  assert.match(client, /固定文本规则预览，不调用模型/);
  assert.match(editor, /本地规则建议差异/);
  assert.doesNotMatch(client, /buildLocalCandidate|saveVersion\(/);
  assert.doesNotMatch(editor, /Sparkles|AI|智能|真实生成/);
});

test("candidate and version states cannot add a second primary action", () => {
  const client = source("content-workspace-client.tsx");
  const editor = source("content-editor.tsx");
  assert.match(editor, /shouldShowRulePreview/);
  assert.match(editor, /resolveContentEditorPrimaryAction/);
  assert.match(editor, /primaryAction === "resolve-rule-preview"/);
  assert.match(editor, /先处理规则建议再继续/);
  assert.match(editor, /getVersionRowActionAppearance/);
  assert.doesNotMatch(editor, /color=\{matchesCurrent \? "primary"/);
  assert.match(editor, /data-workspace-primary-action="rule-preview"/);
  assert.match(editor, /data-workspace-primary-action="advance"/);
  assert.match(editor, /data-workspace-primary-action="prepare"/);
  assert.match(client, /shouldClearRulePreviewOnStepChange/);
});

test("outline confirmation gates the single next-step action", () => {
  const editor = source("content-editor.tsx");
  assert.match(
    editor,
    /!canEnterWorkspaceStep\(value, nextStep\.id\)/,
  );
  assert.match(editor, /nextStepBlocked: isNextStepBlocked/);
  assert.match(editor, /primaryAction === "advance" && nextStep/);
  assert.match(editor, /确认大纲后可继续/);
  assert.match(editor, /outlineConfirmed \? \(/);
  assert.match(editor, /当前大纲已确认/);
  assert.doesNotMatch(editor, /isDisabled=\{isNextStepBlocked\}/);
  assert.match(editor, /isDisabled=\{confirmingOutline\}/);
});
