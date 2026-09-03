#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage5-platforms-smoke.mjs — 阶段 5 平台迁移统一冒烟（2026-09-04）
 * 「都干完了一起测」：xiaohongshu + douyin + wechat-channel 三平台一次跑完
 * （3011 生产灰度 dom-agent × 面板上行桥）。
 *
 * 验证链：
 *   S1 3011 生产登录（测试账号）；
 *   S2 xiaohongshu 会话 login-state（回归：此前专项已 7/7，本脚本保留三态断言）；
 *   S3 douyin 会话 login-state（新面板未登录预期 login_prompt）；
 *   S4 wechat-channel 会话 login-state（同上）；
 *   S5 白名单合并佐证（3011 日志「域名白名单=」行由外部 grep 交叉确认，
 *      本脚本只记录三个 sessionId 供日志比对）；
 *   S6 负向①：未注册平台（kuaishou）→ 400「不支持登录态查询」；
 *   S7 负向②：general-web 会话 → 400；
 *   S8 destroy 面板 → binding + mode 文件清理（磁盘无残留 token）。
 *
 * 前置（外部）：
 *   - 3011 生产已 sync 含 douyin/wechat-channel 注册表的 bundle 并重启；
 *   - mode 文件由本 harness 自写自恢复（4.20 教训：不指望 dev 桌面端那份）。
 *
 * 运行（desktop 目录）：
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/browser-panel-stage5-platforms-smoke.mjs
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
const evidencePath = path.join(evidenceDir, `stage5-platforms-evidence-${stamp}.json`);

const BACKEND = 'http://127.0.0.1:3011';
const REAL_USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'ai-content-desktop');
const VALID_STATES = ['logged_in', 'login_prompt', 'unknown'];

/** 三平台：登录起点（与 PLATFORM_PROFILES.loginUrl 一致）+ 预期状态 */
const PLATFORM_CASES = [
  { platform: 'xiaohongshu', loginUrl: 'https://www.xiaohongshu.com' },
  { platform: 'douyin', loginUrl: 'https://creator.douyin.com/' },
  { platform: 'wechat-channel', loginUrl: 'https://channels.weixin.qq.com/platform' },
];

const checks = [];
const evidence = {
  meta: {
    runAt: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    scenario: '阶段5统一冒烟：xiaohongshu + douyin + wechat-channel（3011 生产 × 面板桥 login-state）',
    backend: BACKEND,
    realUserData: REAL_USER_DATA,
    sessions: {},
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
    console.error('STAGE5 WATCHDOG: 240s 强制退出');
    app.exit(1);
  }, 240_000);
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
  try { fs.rmSync(bindingPath, { force: true }); } catch {}

  // mode 开关文件：harness 自写自恢复（4.20：7 天老化后 dev 桌面端那份会消失）
  const modeFilePath = path.join(REAL_USER_DATA, 'browser-panel-mode.json');
  const modeFileBackup = fs.existsSync(modeFilePath)
    ? fs.readFileSync(modeFilePath, 'utf8')
    : null;
  function writeModeFile() {
    fs.writeFileSync(
      modeFilePath,
      JSON.stringify({
        version: 1,
        protocol: 'kaypal-browser-panel-mode',
        mode: 'on',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
  }
  function restoreModeFile() {
    try {
      if (modeFileBackup === null) fs.rmSync(modeFilePath, { force: true });
      else fs.writeFileSync(modeFilePath, modeFileBackup, { mode: 0o600 });
    } catch {}
  }
  writeModeFile();

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

    // ---- S2 建首个会话拿真实 tenantId → open 面板（桥 actor 断言要与
    //      binding 的 owner/tenant 一致，tenant 传 undefined 会被 POLICY_DENIED）----
    const first = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { platform: 'xiaohongshu', startUrl: PLATFORM_CASES[0].loginUrl },
    });
    const firstSessionId = first.json?.data?.id;
    const tenantId = first.json?.data?.lease?.tenantId;
    if (first.status !== 201 || !firstSessionId || !tenantId) {
      record('S2 建首会话成功（拿 tenantId 供面板 actor 断言）', false, {
        status: first.status,
        message: first.json?.message,
      });
      return;
    }
    evidence.meta.sessions['xiaohongshu'] = firstSessionId;
    manager.open({ url: PLATFORM_CASES[0].loginUrl, ownerId: userId, tenantId });
    await sleep(4000);
    let binding = null;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(bindingPath)) break;
      await sleep(200);
    }
    try {
      binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    } catch {}
    record(
      'S2 面板 open（真实 owner/tenant）→ 桥 binding 落盘（0600）',
      !!binding?.endpoint && String(binding.endpoint).startsWith('http://127.0.0.1:'),
      { endpoint: binding?.endpoint, panelId: binding?.panelId },
    );

    // ---- S3~S5 三平台逐一 login-state（xiaohongshu 会话已建；douyin/
    //      wechat-channel 补建。面板 active 页固定 xiaohongshu 首页，
    //      douyin/wechat-channel 快照取当前页 → 预期 unknown（不在判定域），
    //      三态合法即通过；平台判定规则的确定性由 platform-login-rules.spec
    //      31 例锁定。扫码后 logged_in 全链复验属人工接管环节，另行验证）----
    for (const c of PLATFORM_CASES) {
      let sessionId = evidence.meta.sessions[c.platform];
      if (!sessionId) {
        const created = await api('/local-engine/agent-browser/sessions', {
          method: 'POST',
          cookie,
          body: { platform: c.platform, startUrl: c.loginUrl },
        });
        sessionId = created.json?.data?.id;
        evidence.meta.sessions[c.platform] = sessionId;
        if (created.status !== 201 || !sessionId) {
          record(
            `S ${c.platform} 建会话成功`,
            false,
            { status: created.status, message: created.json?.message },
          );
          continue;
        }
      }
      const ls = await api(`/local-engine/agent-browser/sessions/${sessionId}/login-state`, { cookie });
      const state = ls.json?.data?.state;
      record(
        `S ${c.platform} login-state（status=${ls.status}，state=${state ?? '∅'}）`,
        ls.status === 200 &&
          ls.json?.data?.ok === true &&
          ls.json?.data?.platform === c.platform &&
          VALID_STATES.includes(state),
        { status: ls.status, data: ls.json?.data, message: ls.json?.message },
      );
    }

    // ---- S6 负向①：未注册平台（kuaishou）→ 400 ----
    const ks = await api('/local-engine/agent-browser/sessions', {
      method: 'POST',
      cookie,
      body: { platform: 'kuaishou', startUrl: 'https://www.kuaishou.com' },
    });
    const ksId = ks.json?.data?.id;
    const lsKs = ksId
      ? await api(`/local-engine/agent-browser/sessions/${ksId}/login-state`, { cookie })
      : { status: 0, json: {} };
    record(
      'S6 负向① 未注册平台 kuaishou → 400 不支持登录态查询',
      lsKs.status === 400 && String(lsKs.json?.message ?? '').includes('不支持登录态查询'),
      { status: lsKs.status, message: lsKs.json?.message },
    );

    // ---- S7 负向②：general-web 会话 → 400 ----
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
      'S7 负向② general-web 会话 → 400（仅注册平台支持）',
      lsGw.status === 400 && String(lsGw.json?.message ?? '').includes('不支持登录态查询'),
      { status: lsGw.status, message: lsGw.json?.message },
    );

    // ---- S8 退出清理 ----
    manager.destroy();
    restoreModeFile();
    await sleep(1200);
    record(
      'S8 close 面板 → binding 清理 + mode 文件恢复原状（磁盘无残留 token）',
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
    console.log(`\nSTAGE5-PLATFORMS RESULT: ${checks.length - failed.length}/${checks.length} PASS`);
    setTimeout(() => app.exit(failed.length ? 1 : 0), 300);
  }
}

main().catch((error) => {
  console.error('STAGE5 FATAL:', error);
  app.exit(1);
});
