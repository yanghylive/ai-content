#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage16-smoke.mjs — round16：真实任务全链（backend dom-agent 循环
 * × 面板上行桥）真机冒烟
 *
 * 背景：round12~15 已真机验证"面板桥单动作链"（免单/审批/截图/tab），但
 * 「backend AGENT_BROWSER_MODE=dom-agent 的 Observe-Act-Verify 循环 → 面板桥 →
 * 用户面板页」的**端到端真实任务**从未整链跑通过。本脚本补这条链：
 *
 *   harness（electron，桌面端角色）
 *     1. userData 固定到真实目录（ai-content-desktop，backend 可读）；
 *     2. node 侧 fetch 3013 隔离实例：登录 → 建会话（拿 userId/tenantId）；
 *     3. 真实 manager open 面板（ownerId/tenantId=真实值）→ bridge runtime
 *        起桥 + 写 0600 binding（browser-panel-bridge.json）；
 *        mode 文件复用 dev 桌面端已写的 browser-panel-mode.json（不触碰）；
 *     4. fetch run instruction="提取 h1，然后截图"（全免单动作）；
 *     5. 校验终态 + 事件（extract 值/screenshot 字节数/无 base64 泄漏）；
 *     6. close 面板 → binding 清理（磁盘不留 token）。
 *
 * 前置（外部，脚本不负责）：
 *   - 3013 隔离实例已起：SQLite bundle + backend.env.secure +
 *     PORT=3013 AGENT_BROWSER_MODE=dom-agent（不碰 3011 生产灰度）；
 *   - userData 下已有合法 browser-panel-mode.json（mode=on，pid 活）。
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage16-smoke.mjs
 *
 * 输出：docs/browser-panel-baseline/stage16-evidence-<timestamp>.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { BrowserPanelManager } = require(path.join(__dirname, '..', 'browser-panel-manager.js'));
const { wireBrowserPanel } = require(path.join(__dirname, '..', 'browser-broker-wiring.js'));
const { registerBrowserPanelIpc } = require(path.join(__dirname, '..', 'browser-panel-ipc.js'));
const { createBrowserBridgeRuntime } = require(path.join(__dirname, '..', 'browser-panel-bridge-runtime.js'));

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDir = path.join(repoRoot, 'docs', 'browser-panel-baseline');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidencePath = path.join(evidenceDir, `stage16-evidence-${stamp}.json`);

/** 3013 隔离实例（dom-agent 灰度只在此实例生效，不碰 3011 生产） */
const BACKEND = 'http://127.0.0.1:3013';
/** backend resolveDesktopUserDataDir 的真实推导路径（round14 修复后的约定） */
const REAL_USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'ai-content-desktop');

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: 'round16：真实任务全链（3013 dom-agent 循环 × 面板上行桥）',
    backend: BACKEND,
    realUserData: REAL_USER_DATA,
  },
  checks,
};

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass && detail) console.log(`       detail: ${JSON.stringify(detail).slice(0, 500)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFixtureServer() {
  const page = (title) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1 id="title">${title}</h1></body></html>`;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page('stage16-real-task-title'));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/page-a` });
    });
  });
}

/** 3013 REST 小客户端（手动 cookie） */
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BACKEND}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, setCookies };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { server, url: fixtureUrl } = await startFixtureServer();

  // userData 必须在 ready 前固定到真实目录（backend 读 binding/mode 的位置）
  app.setPath('userData', REAL_USER_DATA);
  await app.whenReady();

  const watchdog = setTimeout(() => {
    console.error('STAGE16 WATCHDOG: 180s 强制退出');
    app.exit(1);
  }, 180_000);
  watchdog.unref?.();

  const win = new BrowserWindow({
    width: 1600, height: 900, show: false, // 无头姿态：面板 View 本身 stage15 已真机验证
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
    getUserDataDir: () => app.getPath('userData'),
  });
  manager.attach(win);
  const wiring = wireBrowserPanel({ manager });
  registerBrowserPanelIpc({ ipcMain, getPanel: () => manager, getWiring: () => wiring });
  const bridgeRuntime = createBrowserBridgeRuntime({
    manager,
    wiring,
    getUserDataDir: () => app.getPath('userData'),
    logger: console,
  });
  if (typeof manager.onSessionEvent === 'function') {
    manager.onSessionEvent((event) => bridgeRuntime.sync(event));
  }

  const bindingPath = path.join(REAL_USER_DATA, 'browser-panel-bridge.json');

  try {
    // ---- S1 登录 + 建会话（拿真实 userId/tenantId）----
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: '__REDACTED_TEST_USER__', password: '__REDACTED_TEST_PASS__' },
    });
    const cookie = (login.setCookies || []).map((c) => c.split(';')[0]).join('; ');
    const userId = login.json?.data?.user?.id;
    record(
      'S1 3013 登录成功（syncTenantOrgTables P1 修复链）',
      login.json?.success === true && !!userId && !!cookie,
      { status: login.status, userId, hasCookie: !!cookie, message: login.json?.message },
    );

    const created = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { startUrl: fixtureUrl },
    });
    const sessionId = created.json?.data?.id;
    const tenantId = created.json?.data?.lease?.tenantId;
    record(
      'S2 建会话成功（agent-browser 灰度 dom-agent 生效）',
      created.status === 201 && !!sessionId && !!tenantId,
      { status: created.status, sessionId, tenantId, message: created.json?.message },
    );

    // ---- S3 open 面板（真实 owner）→ 桥起 + binding 落盘 ----
    manager.open({ url: fixtureUrl, ownerId: userId, tenantId });
    await sleep(1200);
    let binding = null;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(bindingPath)) break;
      await sleep(200);
    }
    try {
      binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    } catch {}
    record(
      'S3 面板 open → 桥 binding 落盘（0600，browser-panel-bridge.json）',
      !!binding?.endpoint && String(binding.endpoint).startsWith('http://127.0.0.1:'),
      { endpoint: binding?.endpoint, panelId: binding?.panelId },
    );

    // ---- S4 发真实任务（全免单动作：extract + screenshot）----
    const runAt = Date.now();
    const run = await api(`/local-engine/agent-browser/sessions/${sessionId}/run`, {
      method: 'POST',
      cookie,
      body: { instruction: '提取 h1，然后截图' },
    });
    const runMs = Date.now() - runAt;
    // run 是 202 + loop 同步跑完（controller await loop.run）
    const finalStatus = run.json?.data?.status;
    record(
      'S4 run 受理并同步完成（202，非 engine_unavailable/legacy 拒绝）',
      run.status === 202 && !!finalStatus && finalStatus !== 'needs-human',
      { status: run.status, finalStatus, runMs, message: run.json?.message },
    );

    // ---- S5 会话终态 + 事件校验 ----
    const detail = await api(`/local-engine/agent-browser/sessions/${sessionId}`, { cookie });
    const events = detail.json?.data?.events ?? [];
    const extractStep = events.find((e) => e.action === 'extract' || e.type === 'step' && /extract/i.test(e.action ?? ''));
    const shotStep = events.find((e) => e.action === 'screenshot' || /screenshot/i.test(e.action ?? ''));
    const eventsRaw = JSON.stringify(events);
    record(
      'S5 终态 succeeded 且 extract 拿到真实标题',
      finalStatus === 'succeeded' &&
        eventsRaw.includes('stage16-real-task-title'),
      {
        finalStatus,
        eventTypes: events.map((e) => `${e.type}:${e.action ?? ''}:${e.ok ?? ''}`).slice(0, 12),
        message: detail.json?.message,
      },
    );
    record(
      'S6 screenshot 事件报字节数且事件流无 base64 泄漏',
      !!shotStep && !eventsRaw.includes('iVBORw0KGgo'),
      {
        shotEvent: shotStep ? { ok: shotStep.ok, message: String(shotStep.message ?? '').slice(0, 160) } : null,
        hasBase64: eventsRaw.includes('iVBORw0KGgo'),
      },
    );

    // ---- S7 退出清理：destroy 面板 → binding 删除（磁盘不留 token）----
    manager.destroy();
    await sleep(1200);
    record(
      'S7 close 面板 → binding 清理（fail-closed 磁盘无残留 token）',
      !fs.existsSync(bindingPath),
      { bindingExists: fs.existsSync(bindingPath) },
    );
  } catch (error) {
    record('FATAL 未预期异常', false, { error: error.message, stack: String(error.stack).slice(0, 600) });
  } finally {
    server.close();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`\nevidence: ${evidencePath}`);
    const failed = checks.filter((c) => !c.pass);
    console.log(`\nSTAGE16 RESULT: ${checks.length - failed.length}/${checks.length} PASS`);
    setTimeout(() => app.exit(failed.length ? 1 : 0), 300);
  }
}

main().catch((error) => {
  console.error('STAGE16 FATAL:', error);
  app.exit(1);
});
