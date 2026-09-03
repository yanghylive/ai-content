// workspace-tabs 外逃回归测试（2026-09-03 修复大王报告的「调出外部浏览器」bug 配套）
//
// 背景：业务 tab 视图的 setWindowOpenHandler 旧契约是「http 外链 shell.openExternal 外开
// 系统浏览器」，与 browser-panel 阶段 5 round17 固化的「宁 deny 不外逃」铁律冲突。
// 大王实证外逃：3010 前端 window.open(url, "_blank")（省钱面板/账号页/换脸作品预览）
// → 业务 tab open handler → shell.openExternal → 调出系统浏览器。
// 修复：popup 一律 deny；http(s) 目标转壳内无特权沙箱 web tab（kind='web'，无 preload、
// sandbox:true、独立 partition、不持久化）；非 http(s) 直接拒绝。
// 本测试锁死「浏览上下文外逃调用面归零」，防止旧契约回潮。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const DESKTOP = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(DESKTOP, rel), 'utf8');

test('workspace-tabs.js 外逃调用面归零：无 shell.openExternal、无 shell import', () => {
  const src = readSrc('workspace-tabs.js');
  assert.ok(!/shell\.openExternal\s*\(/.test(src), 'workspace-tabs.js 禁止调用 shell.openExternal（宁 deny 不外逃）');
  assert.ok(
    !/require\('electron'\)\.includes\('shell'\)/.test(src) && !/const\s*\{[^}]*\bshell\b[^}]*\}\s*=\s*require\('electron'\)/.test(src),
    'workspace-tabs.js 禁止引入 electron shell 模块',
  );
});

test('workspace-tabs.js windowOpenHandler 语义：popup deny + http(s) 转壳内 web 标签', () => {
  const src = readSrc('workspace-tabs.js');
  assert.ok(src.includes('setWindowOpenHandler'), '必须存在 setWindowOpenHandler');
  assert.ok(src.includes("kind: 'web'"), 'http(s) popup 必须转 kind=web 壳内标签');
  assert.ok(src.includes('startUrl: url'), 'web 标签必须以 popup 目标 URL 直接加载（startUrl）');
  assert.match(src, /setWindowOpenHandler[\s\S]{0,1200}return\s*\{\s*action:\s*'deny'\s*\}/, 'handler 必须恒 deny popup（不留 open action）');
});

test("web 标签沙箱加固：无业务 preload、sandbox:true、独立 partition、不持久化", () => {
  const src = readSrc('workspace-tabs.js');
  // webPreferences：只有 business 挂 preload，其余（octop/web）sandbox 加固
  assert.match(src, /kind === 'business'\s*\?\s*\{[\s\S]*?preload[\s\S]*?\}\s*:\s*\/\/[^\n]*\n\s*\{[\s\S]*?sandbox:\s*true/, '非 business kind 必须 sandbox:true 且无 preload');
  // persist / restore 均排除 web（外链标签为临时标签，URL 不落盘）
  assert.match(src, /filter\(\(t\) => t\.kind !== 'octop' && t\.kind !== 'web'\)/, 'persist 必须排除 web 标签');
  assert.match(src, /rec\.kind === 'octop' \|\| rec\.kind === 'web'/, 'restore 必须跳过 web 标签');
  // workspace header 注入只给 business（第三方页面不得带业务鉴权头）
  assert.match(src, /else if \(kind === 'business'\) \{\s*installWorkspaceHeaderInjection/, 'installWorkspaceHeaderInjection 仅限 business 标签');
});

test('browser-panel-manager.js 面板 open handler 保持 round17「宁 deny 不外逃」语义', () => {
  const src = readSrc('browser-panel-manager.js');
  assert.ok(src.includes('setWindowOpenHandler'), '面板必须存在 setWindowOpenHandler');
  assert.ok(!src.includes('openExternal'), '面板浏览上下文禁止 openExternal 外逃');
});

test('main.js shell:open-external 保留例外但必须受信 + 协议白名单约束（登录验证链路专用）', () => {
  const src = readSrc('main.js');
  const idx = src.indexOf("'shell:open-external'");
  assert.ok(idx > 0, 'shell:open-external handler 必须存在');
  const block = src.slice(idx, idx + 500);
  assert.ok(block.includes('isTrustedRendererSender'), '必须校验可信 renderer sender');
  assert.ok(block.includes('/^https') && block.includes('.test(url)'), '必须限定 http/https 协议');
});
