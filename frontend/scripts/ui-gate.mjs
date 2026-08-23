#!/usr/bin/env node
/**
 * ui:gate —— ai-content 前端 UI 规范门禁（B9 · 2026-08-23）
 *
 * 防止 UI 整改成果回潮。规则（任一 FAIL 即退出码 1）：
 *   R1 非法色值：token 定义文件（globals.css/shell.css/desktop-vp.css/tailwind.config.ts）
 *      之外的 明德深蓝/明德深蓝 rgba/明德深蓝衍生 硬编码
 *   R2 主题切换回潮：新增 jiuzhang.vp / data-vp / kx-vp-on
 *   R3 自写返回：ArrowLeft/ChevronLeft 与 router.back/history.back 同文件且未用 V2BackButton
 *   R4 裸字号字面量：新增 text-[Npx]（允许语义档）
 *   R5 原生弹窗：新增 window.alert / window.confirm / 裸 alert( / confirm(
 *   R6 新原生控件：新增 <button/<select/<input type=checkbox（白名单外）
 *   R7 自拼卡片：新增 rounded-* + border + bg- 组合（白名单外）
 *   R8 桌面 mx-*：mobile.css 之外新增 mx-px/mx-header/mx-card
 *   R9 尺寸超限：新增 style={{ 且 fontSize/width/height 内联（数量白名单外）
 *
 * 用法：
 *   node scripts/ui-gate.mjs            # 全量扫描（pre-commit / CI）
 *   node scripts/ui-gate.mjs --changed   # 只扫 git 改动文件（提交时）
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../src");
const ALLOWED_TOKEN_FILES = [
  "src/app/globals.css",
  "src/components/shell/shell.css",
  "src/components/shell/desktop-vp.css",
  "src/components/shell/mobile.css",
  "tailwind.config.ts",
  "src/app/astryx-brand-overrides.css",
  "src/app/astryx-layers.css",
];

const VIOLATION = [];
const WARNINGS = [];
function fail(rule, file, msg) {
  VIOLATION.push({ rule, file, msg });
}
function warnOnly(rule, file, msg) {
  WARNINGS.push({ rule, file, msg });
}

/** 文件是否已被 git 跟踪（存量 vs 新增） */
function isTracked(rel) {
  try {
    const base = path.resolve(__dirname, "..");
    const out = execSync(`git ls-files --error-unmatch "${rel}"`, {
      cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function listTargets(changedOnly) {
  if (!changedOnly) {
    return walk(SRC).filter((f) => /\.(tsx|ts)$/.test(f));
  }
  try {
    const raw = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    const staged = raw.split("\n").filter(Boolean);
    return staged
      .filter((f) => f.startsWith("frontend/src/") && /\.(tsx|ts)$/.test(f))
      .map((f) => path.resolve(path.dirname(path.dirname(__dirname)), f));
  } catch {
    return [];
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && e.name !== "node_modules") walk(p, out);
    } else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const DARK_OLD_HEX = /#17325b|#0f2440|#173052|#10141f|#1a2130|#131926|#0f1420|#141821|#1d2b45|#e8f1fc/i;
const DARK_OLD_RGBA = /rgba\(\s*(16|23|15|13|12|14|10), ?\s*(26|50|43|36|21|19|24|20), ?\s*(44|91|68|80|30|38|33|40|21)/i;
const ALLOWED_PURPLE = /#722ed1|#531dab|#9254de|#41168a|#2e0e66|#f9f0ff|#e39a3e|#d98f2b|#efb45b|#8f5a19|#f6c478|#b885f7|#eebd72/i;

const IGNORED_FILES = [/\.test\./, /src\/app\/\(cases\)\//, /src\/app\/login\//, /src\/app\/error\.tsx/, /src\/app\/not-found\.tsx/, /src\/components\/v2\/gray-test-overlay\.tsx/, /src\/app\/dev-/, /src\/components\/shell\/mobile-shell\.tsx/];

function isIgnored(file) {
  const rel = path.relative(path.resolve(__dirname, ".."), file);
  return IGNORED_FILES.some((re) => re.test(rel));
}

for (const file of listTargets(process.argv.includes("--changed"))) {
  if (isIgnored(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.resolve(__dirname, ".."), file);

  // R1 非法色值（排除 demo 路由与含 var() 的 token 化文件）
  if (!rel.includes("/demo/") && !ALLOWED_TOKEN_FILES.some((a) => rel.endsWith(a))) {
    // 仅当颜色出现在字符串/样式字面量中（排除注释）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hexBad = codeOnly.match(DARK_OLD_HEX);
    if (hexBad) fail("R1", rel, `明德深蓝硬编码 ${hexBad[0]}（应走 token）`);
    // 蓝灰描边+深蓝文字组合：仅对新增/未跟踪文件拦截；存量是历史遗留卡片放行
    const combo = /style=\{\{[^}]*rgba\(\s*148,\s*163,\s*184[^}]*\}\}.*?(#1f2a44|#203454)/s;
    if (combo.test(codeOnly) && !isTracked(rel)) fail("R1", rel, "疑似旧蓝灰描边+深蓝文字组合（seedance/copy 类旧卡片）");
  }

  // R2 主题切换回潮（仅实际执行代码：getItem/setItem/setAttribute，注释/字符串排除）
  const vpExec = /(localStorage\.(?:get|set)Item\s*\(\s*["'']jiuzhang\.vp|setAttribute\s*\(\s*["'']data-vp|toggleVp\s*\(|data-vp=["''](?:on|off)["''])/;
  if (vpExec.test(src)) {
    fail("R2", rel, "发现 VP 切换回潮");
  }

  // R3 自写返回
  if (/ArrowLeft|ChevronLeft/.test(src) && /router\.back|history\.back/.test(src) && !/V2BackButton/.test(src)) {
    fail("R3", rel, "自写返回按钮（用 V2BackButton）");
  }

  // R4 裸字号字面量
  const fsBad = src.match(/text-\[(?!var\()\d+(?:\.\d+)?px\]/g);
  if (fsBad) fail("R4", rel, `新增 text-[Npx] 字面量: ${fsBad.slice(0, 3).join(",")}（用 text-11/12/13/14 语义档）`);

  // R5 原生弹窗（use-confirm/confirm-modal 是封装实现，不视为违规）
  const isConfirmImpl = /use-confirm|confirm-modal|use-unsaved-changes/.test(rel);
  if (!isConfirmImpl && /window\.alert|window\.confirm/.test(src)) fail("R5", rel, "原生 alert/confirm（用 useConfirm/toast）");
  if (!isConfirmImpl && /(?<![\w.])alert\((?![^)]*['"])/.test(src) && !/\.test\./.test(rel)) fail("R5", rel, "裸 alert( 调用");

  // R6 新原生控件（仅新增/未跟踪文件；存量跟踪文件只 WARN）
  const mobileLike = /isMobile|kx-mobile-ambient|useIsMobile|mobile-|mx-|scene-page|loading-guard|onboarding-guide|under-construction|electron-update|edit-entry-hint|pwa-install|feature-roadmap|hybrid-route|gray-test|sidebars/i.test(rel);
  const isNew = !isTracked(rel);
  // 组件实现文件豁免：V2/kx 组件库自身（必然含原生 <button> 封装）、壳层组件、demo 路由（构建删除）
  const componentImpl = /v2-back-button|app-shell|ai-assistant|desktop-only-gate|editor-shell|resource-center|agent-cockpit-canvas/.test(rel) || rel.includes("/demo/");
  // heroui 语义按钮（border-primary/bg-primary-10/hover:bg-default-100/text-default-* 等品牌化色阶）
  // 与功能性 icon 按钮（仅 icon、无文字、极简 inline 样式）视为合法，不属"原生按钮"回潮
  const herouiSemanticBtn = /(?:border-primary|bg-primary\/10|hover:bg-default-100|border-divider|text-default-|bg-default-100|rounded-medium)/.test(src);
  const iconOnlyBtn = /<button[^>]*>[^<]{0,40}<svg|<button[^>]*>\s*<Icon\b/.test(src);
  if (/<button\s/.test(src) && !/(V2Button|V2PrimaryButton|V2GhostButton|V2DangerButton|kx-btn|KxModal|ConfirmModal)/.test(src) && !mobileLike && !componentImpl && !herouiSemanticBtn && !iconOnlyBtn) {
    if (isNew) fail("R6", rel, "新增文件出现原生 <button>（用 kx-btn/V2Button 体系）");
    else warnOnly("R6", rel, "存量原生 <button>（后续批次清理）");
  }

  // R7 自拼卡片（存量只 WARN；新增拦截）
  const LEGACY_CARD_FILES = [
    "agent-cockpit-canvas", "savings", "ops-workbench", "growth-mobile-console",
    "wecom-workbench", "search-intelligence-workbench", "functional-empty-state",
    "functional-page-experience", "redfox-workflow-page", "intelligence-tool-result",
    "local-engine-client", "task-experience-flow", "solution-run-context",
    "loading.tsx", "bar-chart-card", "geo-bridge-banner", "release-notes",
    "agent-status-drawer", "onboarding-guide", "risk-confirmation-dialog",
  ];
  const cardPat = /(?:rounded-(?:lg|xl|2xl)|rounded-\[(?:8|10|12|14|16|20)px\]).{0,80}(?:border(?:-\w+)?\s.*bg-|bg-.*border)/i;
  // heroui 语义容器豁免：border-divider/border-small/border-default-200 + bg-background/
  // bg-default-50/bg-warning-50/bg-danger-50/bg-content1/60 是 heroui 品牌化色阶（跟随主题），
  // 不是"自拼卡"；kaypal-v3 token 组合（border-[var(--kaypal-v3-*)] + bg-[var(--kaypal-v3-*)]）
  // 同样是品牌 token 卡。仅拦截真正的硬编码自拼卡（任意 hex/任意值非 token 组合）
  const herouiSemanticCard = /(?:border-divider|border-small|border-default-\d+|border-primary\/\d+|border-warning-\d+|border-danger-\d+)[\s\S]{0,120}(?:bg-background|bg-default-\d+|bg-warning-\d+|bg-danger-\d+|bg-content1\/\d+)/.test(src);
  const tokenCard = /border-\[var\(--kaypal-v3-[\w-]+\)\][\s\S]{0,120}bg-\[var\(--kaypal-v3-[\w-]+\)\]/.test(src);
  if (cardPat.test(src) && !LEGACY_CARD_FILES.some((k) => rel.includes(k)) && !mobileLike && !herouiSemanticCard && !tokenCard) {
    const cls = src.match(cardPat);
    if (isNew) fail("R7", rel, `新增自拼卡片 ${cls?.[0]?.slice(0, 60)}（用 .kx-card / kaypal-v3-panel）`);
    else warnOnly("R7", rel, `存量自拼卡片 ${cls?.[0]?.slice(0, 50)}（后续批次清理）`);
  }

  // R8 桌面 mx-*（含移动分支/mobile- 白名单的文件视为合法移动布局；存量只 WARN）
  const hasMobileBranch = /isMobile|kx-mobile-ambient|useIsMobile|mx-/.test(src) || /mobile-|onboarding-guide/.test(rel);
  if (/\bmx-(?:px|header|card|page-title|btn-gold|stat-)\b/.test(src) && !/mobile\.css/.test(rel) && !hasMobileBranch)
    fail("R8", rel, "新增桌面 mx-* 深色类");

  // R9 内联尺寸超限（仅提示，不阻塞）
  const inlineSize = (src.match(/style=\{\{[^}]*?(fontSize|width|height)[^}]*?\}\}/g) || []).length;
  if (inlineSize > 60) {
    fail("R9", rel, `内联尺寸 ${inlineSize} 处超限（>60，应走 token/类）`);
  }
}

if (VIOLATION.length > 0) {
  console.error("\n❌ ui:gate 拦截（新增代码违反 UI 规范，需修复）\n");
  for (const v of VIOLATION) {
    console.error(`  [${v.rule}] ${v.file} — ${v.msg}`);
  }
  console.error("\n存量问题仅提示不阻塞（见 WARN），新增/未跟踪文件必须合规。\n");
  process.exit(1);
}
console.log("✅ ui:gate 通过（新增代码合规）");
if (WARNINGS.length > 0) {
  console.log(`\n⚠️  存量清理提示（${WARNINGS.length} 条，不阻塞，列入后续批次）：`);
  for (const w of WARNINGS) {
    console.log(`  [${w.rule}] ${w.file} — ${w.msg}`);
  }
}
