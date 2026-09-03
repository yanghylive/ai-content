#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage5-xhs-smoke.mjs — 阶段 5 第一站（2026-09-04）：小红书登录/只读
 * 真机冒烟（3011 生产灰度 dom-agent × 面板上行桥）
 *
 * 验证链：
 *   S1 3011 生产登录（测试账号）；
 *   S2 建会话 platform=xiaohongshu（startUrl 小红书首页，域名白名单合并走
 *      PLATFORM_PROFILES —— 白名单本身由 3011 日志「域名白名单=」行佐证）；
 *   S3 open 面板（真实 owner/tenant）→ 桥 binding 落盘（0600）；
 *   S4 GET sessions/:id/login-state → 200 + platform=xiaohongshu +
 *      state ∈ 三态（新面板未登录预期 login_prompt；已带 cookie 则 logged_in，
 *      两者都是合法真机证据，脚本记录实际值）；
 *   S5 负向①：未注册平台（douyin）→ 400「不支持登录态查询」；
 *   S6 负向②：general-web 会话 → 400；
 *   S7 destroy 面板 → binding 清理（磁盘不留 token）。
 *
 * 前置（外部）：
 *   - 3011 生产已 sync 新 bundle（含 login-state 端点）并重启；
 *   - userData 下有合法 browser-panel-mode.json（mode=on，pid 活，dev 桌面端提供）。
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage5-xhs-smoke.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
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
const evidencePath = path.join(evidenceDir, `stage5-xhs-evidence-${stamp}.json`);

/** 3011 生产（阶段 5 灰度 dom-agent 已开，env.secure AGENT_BROWSER_MODE=dom-agent） */
const BACKEND = 'http://127.0.0.1:3011';
const REAL_USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'ai-content-desktop');
const XHS_HOME = 'https://www.xiaohongshu.com';

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: '阶段5第一站：小红书登录/只读（3011 生产 × 面板桥 login-state）',
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

  app.setPath('userData', REAL_USER_DATA);
  await app.whenReady();

  const watchdog = setTimeout(() => {
    console.error('STAGE5 WATCHDOG: 180s 强制退出');
    app.exit(1);
  }, 180_000);
  watchdog.unref?.();

  const win = new BrowserWindow({
    width: 1600, height: 900, show: false,
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
  // 防旧 binding 干扰（stage16 教训：跑前清残留）
  try { fs.rmSync(bindingPath, { force: true }); } catch {}

  // mode 开关文件：此前 stage16 借用 dev 桌面端写入的那份已被 7 天老化清掉，
  // 本 harness 自写（pid=本进程，存活探测必过），清理时恢复原状（缺失则删）。
  const modeFilePath = path.join(REAL_USER_DATA, 'browser-panel-mode.json');
  const modeFileBackup = fs.existsSync(modeFilePath)
    ? fs.readFileSync(modeFilePath, 'utf8')
    : null;
  function writeModeFile() {
    const payload = {
      version: 1,
      protocol: 'kaypal-browser-panel-mode',
      mode: 'on',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(modeFilePath, JSON.stringify(payload), { mode: 0o600 });
  }
  function restoreModeFile() {
    try {
      if (modeFileBackup === null) fs.rmSync(modeFilePath, { force: true });
      else fs.writeFileSync(modeFilePath, modeFileBackup, { mode: 0o600 });
    } catch {}
  }
  writeModeFile();

  let xhsSessionId = null;

  try {
    // ---- S1 3011 生产登录 ----
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: '__REDACTED_TEST_USER__', password: '__REDACTED_TEST_PASS__' },
    });
    const cookie = (login.setCookies || []).map((c) => c.split(';')[0]).join('; ');
    const userId = login.json?.data?.user?.id;
    record(
      'S1 3011 生产登录成功',
      login.json?.success === true && !!userId && !!cookie,
      { status: login.status, userId, hasCookie: !!cookie, message: login.json?.message },
    );

    // ---- S2 建会话 platform=xiaohongshu ----
    const created = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { platform: 'xiaohongshu', startUrl: XHS_HOME },
    });
    xhsSessionId = created.json?.data?.id;
    const tenantId = created.json?.data?.lease?.tenantId;
    record(
      'S2 建会话成功（platform=xiaohongshu，白名单合并佐证=3011 日志行）',
      created.status === 201 && !!xhsSessionId && !!tenantId,
      { status: created.status, sessionId: xhsSessionId, tenantId, message: created.json?.message },
    );

    // ---- S3 open 面板（小红书首页）→ 桥 binding 落盘 ----
    manager.open({ url: XHS_HOME, ownerId: userId, tenantId });
    await sleep(4000); // 给外站真实页面加载留时间
    let binding = null;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(bindingPath)) break;
      await sleep(200);
    }
    try {
      binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    } catch {}
    record(
      'S3 面板 open（小红书首页）→ 桥 binding 落盘（0600）',
      !!binding?.endpoint && String(binding.endpoint).startsWith('http://127.0.0.1:'),
      { endpoint: binding?.endpoint, panelId: binding?.panelId },
    );

    // ---- S4 login-state 正向（新面板未登录预期 login_prompt；带 cookie 则 logged_in）----
    const ls = await api(`/local-engine/agent-browser/sessions/${xhsSessionId}/login-state`, { cookie });
    const state = ls.json?.data?.state;
    const validState = ['logged_in', 'login_prompt', 'unknown'].includes(state);
    record(
      `S4 login-state 200（platform=xiaohongshu，state=${state ?? '∅'}）`,
      ls.status === 200 && ls.json?.data?.ok === true && ls.json?.data?.platform === 'xiaohongshu' && validState,
      { status: ls.status, data: ls.json?.data, message: ls.json?.message },
    );

    // ---- S5 负向①：未注册平台 douyin → 400 ----
    const douyin = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { platform: 'douyin', startUrl: 'https://www.douyin.com' },
    });
    const douyinId = douyin.json?.data?.id;
    const lsDouyin = douyinId
      ? await api(`/local-engine/agent-browser/sessions/${douyinId}/login-state`, { cookie })
      : { status: 0, json: {} };
    record(
      'S5 负向① 未注册平台 douyin → 400 不支持登录态查询',
      lsDouyin.status === 400 && String(lsDouyin.json?.message ?? '').includes('不支持登录态查询'),
      { status: lsDouyin.status, message: lsDouyin.json?.message },
    );

    // ---- S6 负向②：general-web 会话 → 400 ----
    const gw = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { startUrl: 'https://example.com' },
    });
    const gwId = gw.json?.data?.id;
    const lsGw = gwId
      ? await api(`/local-engine/agent-browser/sessions/${gwId}/login-state`, { cookie })
      : { status: 0, json: {} };
    record(
      'S6 负向② general-web 会话 → 400（仅注册平台支持）',
      lsGw.status === 400 && String(lsGw.json?.message ?? '').includes('不支持登录态查询'),
      { status: lsGw.status, message: lsGw.json?.message },
    );

    // ---- S7 退出清理 ----
    manager.destroy();
    restoreModeFile();
    await sleep(1200);
    record(
      'S7 close 面板 → binding 清理 + mode 文件恢复原状（磁盘无残留 token）',
      !fs.existsSync(bindingPath) &&
        fs.existsSync(modeFilePath) === (modeFileBackup !== null),
      { bindingExists: fs.existsSync(bindingPath), modeFileExists: fs.existsSync(modeFilePath) },
    );
  } catch (error) {
    record('FATAL 未预期异常', false, { error: error.message, stack: String(error.stack).slice(0, 600) });
  } finally {
    restoreModeFile();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`\nevidence: ${evidencePath}`);
    const failed = checks.filter((c) => !c.pass);
    console.log(`\nSTAGE5-XHS RESULT: ${checks.length - failed.length}/${checks.length} PASS`);
    setTimeout(() => app.exit(failed.length ? 1 : 0), 300);
  }
}

main().catch((error) => {
  console.error('STAGE5 FATAL:', error);
  app.exit(1);
});
