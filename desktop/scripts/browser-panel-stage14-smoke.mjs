#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage14-smoke.mjs — round14：3011 跨进程真实 userData 验证
 *
 * 验证命题（累计最大欠账，本轮实锤并修复一个 P1）：
 *  1. bug 实锤：打包版 Info.plist CFBundleName = productName（中文）≠
 *     ai-content-desktop → 修复前 macOS 打包版 userData 与 backend 推导对不上，
 *     面板模式开关/面板桥凭据两条跨进程链全断。
 *  2. 修复：desktop 打包版（win+mac）统一固定 userData 到 ai-content-desktop
 *     （user-data-path.js 纯函数 + main.js 接线），backend 零改动。
 *  3. 写读闭环：manager.setAgentMode（真实链，writeMode 0600 文件 + pid 探活）
 *     → **backend dist 真实编译产物** readPanelModeRegistry 经 HOME 推导读到
 *     同一目录（子进程 env HOME=临时目录，走真实默认推导代码路径，零 env 覆盖、
 *     零生产污染）。
 *
 * 9 项检查：
 *   S1 bug 实锤：Info.plist CFBundleName ≠ ai-content-desktop
 *   S2 纯函数 spec 绿（win 既有语义回归 + mac 新增分支）
 *   S3 真实链 on：setAgentMode(true) → backend dist 读到 'on' 且文件 0600
 *   S4 setAgentMode(false)（删文件）→ 读到 null（默认 off）
 *   S5 pid 已死 → null（fail-closed pid 探活跨进程）
 *   S6 startedAt 老化 8 天 → null
 *   S7 存量 0644 → backend 读时收紧 0600
 *   S8 1s 缓存窗口：文件变化后立即读旧值，clear 缓存后立即生效
 *   S9 目录对称性：backend 推导目录 == desktop 写入目录（同一约定）
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage14-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage14-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, WebContentsView } = require('electron');
const { BrowserPanelManager } = require(path.join(__dirname, '..', 'browser-panel-manager.js'));
const { wireBrowserPanel } = require(path.join(__dirname, '..', 'browser-broker-wiring.js'));
const { writeMode, readMode, clearMode } = require(path.join(__dirname, '..', 'browser-panel-mode-registry.js'));

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const backendRoot = path.join(repoRoot, 'backend');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage14-evidence-${stamp}.json`);
const MANAGED_NODE = '/Users/yanghy/.workbuddy/binaries/node/versions/22.22.2-2/bin/node';

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    backendDist: fs.existsSync(path.join(backendRoot, 'dist/modules/local-engine/agent-panel-bridge.service.js')) ? 'fresh' : 'MISSING',
    scenario: 'round14：3011 跨进程真实 userData（desktop writeMode → backend dist readPanelModeRegistry，HOME 隔离）',
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 500)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** backend dist 读取子进程：HOME=tmpHome（真实默认推导代码路径，无 KAYPAL_* 覆盖）。
 *  ops: read（读 mode）| readAndFix（读+回传 stat）/stat；cacheTest 由专用子进程承担。 */
function backendRead(tmpHome) {
  const script = `
    const bridge = require(${JSON.stringify(path.join(backendRoot, 'dist/modules/local-engine/agent-panel-bridge.service.js'))});
    const paths = require(${JSON.stringify(path.join(backendRoot, 'dist/common/project-paths.js'))});
    const fs = require('fs');
    bridge.clearPanelModeRegistryCache();
    const mode = bridge.readPanelModeRegistry();
    const p = paths.resolveDesktopUserDataDir();
    const f = p ? require('path').join(p, 'browser-panel-mode.json') : null;
    let perm = null;
    try { perm = (fs.statSync(f).mode & 0o777).toString(8); } catch {}
    console.log(JSON.stringify({ mode, dir: p, file: f, perm }));
  `;
  const out = spawnSync(MANAGED_NODE, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome },
    timeout: 15000,
  });
  try {
    const line = (out.stdout || '').trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch {
    throw new Error(`backendRead 解析失败: stdout=${(out.stdout || '').slice(0, 200)} stderr=${(out.stderr || '').slice(0, 200)}`);
  }
}

/** 缓存窗口专用子进程（同进程内连读）：读 → 外部队列改为 off → 立即读（应命中缓存）→ clear → 读 */
function backendCacheTest(tmpHome, offPayloadPath) {
  const script = `
    const bridge = require(${JSON.stringify(path.join(backendRoot, 'dist/modules/local-engine/agent-panel-bridge.service.js'))});
    const fs = require('fs');
    bridge.clearPanelModeRegistryCache();
    const before = bridge.readPanelModeRegistry();           // on
    fs.writeFileSync(${JSON.stringify(offPayloadPath)}, fs.readFileSync(${JSON.stringify(offPayloadPath)}, 'utf8').replace('"mode": "on"', '"mode": "off"'));
    const during = bridge.readPanelModeRegistry();           // 缓存命中应仍 on
    bridge.clearPanelModeRegistryCache();
    const after = bridge.readPanelModeRegistry();            // 清缓存后 off
    console.log(JSON.stringify({ before, during, after }));
  `;
  const out = spawnSync(MANAGED_NODE, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome },
    timeout: 15000,
  });
  try {
    const line = (out.stdout || '').trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch {
    throw new Error(`backendCacheTest 解析失败: ${(out.stdout || '').slice(0, 200)} / ${(out.stderr || '').slice(0, 200)}`);
  }
}

/** 双页 fixture（同 stage12/13） */
function startFixtureServer() {
  const page = (title) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1 id="title">${title}</h1></body></html>`;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const title = (req.url || '').includes('page-b') ? 'page-b-title' : 'page-a-title';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(title));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, urlA: `http://127.0.0.1:${server.address().port}/page-a` });
    });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { server, urlA } = await startFixtureServer();
  await app.whenReady();

  const watchdog = setTimeout(() => {
    console.error('STAGE14 WATCHDOG: 150s 强制退出');
    app.exit(1);
  }, 150_000);
  watchdog.unref?.();

  // 临时 HOME + 修复后打包版 userData 目录约定（完全隔离，零生产污染）
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stage14-home-'));
  const appDataMac = path.join(tmpHome, 'Library', 'Application Support');
  const stableDir = path.join(appDataMac, 'ai-content-desktop');
  app.setPath('userData', stableDir);

  const win = new BrowserWindow({
    width: 1600, height: 900, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const bizView = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(bizView);
  const fakeTabManager = {
    rightInset: 0,
    relayout() {
      const { width, height } = win.getContentBounds();
      bizView.setBounds({ x: 0, y: 38, width: Math.max(0, width - this.rightInset), height: height - 38 });
    },
    broadcast: () => undefined,
    sendToBusiness: () => true,
    isOwnedWebContents: () => true,
  };
  win.on('resize', () => fakeTabManager.relayout());

  const storeData = {};
  const manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store: { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } },
    tabManager: fakeTabManager,
    // 生产接线 = () => app.getPath('userData')；本脚本 app.setPath 已指 stableDir，
    // 直接走同一路径（真实链），不用假注入
    getUserDataDir: () => app.getPath('userData'),
  });
  manager.attach(win);
  const wiring = wireBrowserPanel({ manager });

  try {
    // ---- S1 bug 实锤：打包产物 Info.plist ----
    try {
      const plistPath = path.join(desktopRoot, 'dist', 'mac-arm64', 'JIUZHANG AI 内容创作平台.app', 'Contents', 'Info.plist');
      const out = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleName', plistPath], { encoding: 'utf8' });
      const bundleName = (out.stdout || '').trim();
      record(
        'S1 bug 实锤：打包版 CFBundleName ≠ ai-content-desktop（修复前 userData 断链依据）',
        !!bundleName && bundleName !== 'ai-content-desktop',
        { bundleName, plistExists: fs.existsSync(plistPath) },
      );
    } catch (error) {
      record('S1 bug 实锤：打包版 CFBundleName ≠ ai-content-desktop', false, { error: error.message });
    }

    // ---- S2 纯函数 spec（win 既有语义回归 + mac 新增分支）----
    try {
      const out = spawnSync(MANAGED_NODE, [path.join(desktopRoot, 'user-data-path.spec.js')], { encoding: 'utf8', timeout: 15000 });
      record(
        'S2 user-data-path 纯函数 spec 全绿（win 平移回归 + mac 打包固定/迁移分支）',
        /PASSED \(\d+\)/.test(out.stdout || '') && !(out.stdout || '').includes('FAILED'),
        { tail: (out.stdout || '').trim().split('\n').pop() },
      );
    } catch (error) {
      record('S2 user-data-path 纯函数 spec 全绿', false, { error: error.message });
    }

    // ---- S3 真实链 on：manager.setAgentMode(true) → backend dist 读到 on 且 0600 ----
    try {
      const ret = manager.setAgentMode(true);
      const read = backendRead(tmpHome);
      record(
        'S3 真实链 on：setAgentMode(true) → backend dist(HOME 推导) 读到 on 且文件 0600',
        ret === 'on' && read?.mode === 'on' && read?.perm === '600' &&
          read?.dir === stableDir,
        { ret, read },
      );
    } catch (error) {
      record('S3 真实链 on：setAgentMode(true) → backend dist 读到 on 且 0600', false, { error: error.message });
    }

    // ---- S4 setAgentMode(false)（删文件）→ null ----
    try {
      const ret = manager.setAgentMode(false);
      const read = backendRead(tmpHome);
      record(
        'S4 setAgentMode(false)（clearMode 删文件）→ backend 读到 null（默认 off）',
        ret === 'off' && read?.mode === null && !fs.existsSync(path.join(stableDir, 'browser-panel-mode.json')),
        { ret, read },
      );
    } catch (error) {
      record('S4 setAgentMode(false)（删文件）→ backend 读到 null', false, { error: error.message });
    }

    // ---- S5 pid 已死 → null（fail-closed）----
    try {
      const { server: _s, ...rest } = {};
      writeMode({ userDataDir: stableDir, mode: 'on', pid: 2147483000 });
      const read = backendRead(tmpHome);
      record('S5 写文件进程 pid 已死 → backend 读 null（fail-closed 跨进程探活）', read?.mode === null, { read });
      clearMode({ userDataDir: stableDir });
    } catch (error) {
      record('S5 写文件进程 pid 已死 → null', false, { error: error.message });
    }

    // ---- S6 老化 8 天 → null ----
    try {
      writeMode({ userDataDir: stableDir, mode: 'on', pid: process.pid });
      const file = path.join(stableDir, 'browser-panel-mode.json');
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      payload.startedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
      const read = backendRead(tmpHome);
      record('S6 startedAt 老化 8 天 → backend 读 null（超 7 天阈值）', read?.mode === null, { read });
      clearMode({ userDataDir: stableDir });
    } catch (error) {
      record('S6 老化 8 天 → null', false, { error: error.message });
    }

    // ---- S7 存量 0644 → backend 读时收紧 0600 ----
    try {
      writeMode({ userDataDir: stableDir, mode: 'on', pid: process.pid });
      const file = path.join(stableDir, 'browser-panel-mode.json');
      fs.chmodSync(file, 0o644);
      const read = backendRead(tmpHome);
      const permAfter = (fs.statSync(file).mode & 0o777).toString(8);
      record(
        'S7 存量 0644 → backend 读后收紧 0600 且读到 on',
        read?.mode === 'on' && permAfter === '600',
        { read, permAfter },
      );
      clearMode({ userDataDir: stableDir });
    } catch (error) {
      record('S7 0644 → 收紧 0600', false, { error: error.message });
    }

    // ---- S8 1s 缓存窗口（同子进程：读→外部改→立即读=旧值→clear→新值）----
    try {
      writeMode({ userDataDir: stableDir, mode: 'on', pid: process.pid });
      const file = path.join(stableDir, 'browser-panel-mode.json');
      const result = backendCacheTest(tmpHome, file);
      record(
        'S8 1s 缓存窗口：改文件后立即读=旧值(on)，clear 缓存后=新值(off)',
        result?.before === 'on' && result?.during === 'on' && result?.after === 'off',
        result,
      );
      clearMode({ userDataDir: stableDir });
    } catch (error) {
      record('S8 1s 缓存窗口', false, { error: error.message });
    }

    // ---- S9 目录对称性：backend 推导 == desktop 写入（同 HOME 约定）----
    try {
      const read = backendRead(tmpHome);
      record(
        'S9 目录对称性：backend resolveDesktopUserDataDir == desktop app.getPath(userData)',
        read?.dir === stableDir,
        { backend: read?.dir, desktop: stableDir },
      );
    } catch (error) {
      record('S9 目录对称性', false, { error: error.message });
    }

    // ---- 附带：面板功能无回归（真实 open，同 stage12 姿态）----
    try {
      manager.open({ url: urlA, ownerId: 'u1', tenantId: 't1' });
      await sleep(800);
      const ok = manager.panelWebContents()?.getURL().includes('/page-a');
      record('S10 附带：面板 open 无回归（真实 manager + fixture）', !!ok, { url: manager.panelWebContents()?.getURL() });
    } catch (error) {
      record('S10 附带：面板 open 无回归', false, { error: error.message });
    }
  } finally {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    const failed = checks.filter((c) => !c.pass).length;
    console.log(`\nSTAGE14 ${failed === 0 ? 'PASSED' : 'FAILED'} (${checks.length - failed}/${checks.length})`);
    console.log(`evidence: ${evidencePath}`);
    try { wiring.dispose(); } catch {}
    try { manager.destroy(); } catch {}
    try { win.destroy(); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }
}

main().catch((error) => {
  console.error('STAGE14 FATAL:', error);
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, fatal: String(error) }, null, 2));
  } catch {}
  app.exit(1);
});
