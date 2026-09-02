#!/usr/bin/env node
'use strict';
/**
 * browser-panel-stage5-agent.mjs — 阶段 5 端到端里的「3011 一侧」子进程
 *
 * 故意跑在**独立进程**里：凭证投递的意义就是跨进程，同进程内直接传对象等于没验。
 * 这个脚本扮演 3011 后端：
 *   1. 从 userData 目录读 0600 凭据文件（真实磁盘、真实权限）；
 *   2. 用真实 client SDK 调 /health 与 /observe；
 *   3. 用真实 client SDK 申请一张 navigate 确认单（**只签单，不执行**）；
 *   4. 把结果打到 stdout（JSON），由父进程断言。
 *
 * 用法：node scripts/browser-panel-stage5-agent.mjs <userDataDir> <mode>
 *   mode=observe  → 只做 1-2
 *   mode=full     → 1-3
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createBrowserBridgeClient,
  BridgeError,
} = require('../browser-agent-bridge-client.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [userDataDir, mode = 'observe', expectedTextArg = '', actionId = ''] =
  process.argv.slice(2);
const expectedText = expectedTextArg || process.env.BP_E2E_EXPECT_TEXT || '';

// 导航目标由父进程经环境注入：E2E 不该依赖外网（可离线复现）
const NAV_URL = process.env.BP_E2E_NAV_URL || 'https://kaypal.cn/e2e-panel-navigation';

const ACTOR = { ownerId: 'e2e-owner', tenantId: 'e2e-tenant' };

function fail(code, message) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + '\n');
  process.exit(0);
}

async function main() {
  if (!userDataDir) fail('NO_USER_DATA_DIR', '缺少 userDataDir 参数');
  process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = path.join(
    userDataDir,
    'browser-panel-bridge.json',
  );

  // 这里刻意**不** import 任何 electron 模块：3011 是纯 node 进程，
  // 这一步顺带证明整个通道对后端是"零 electron 依赖"的。
  const { readRegistry } = require('../browser-panel-bridge-registry.js');
  const credentials = readRegistry({ userDataDir });
  if (!credentials) fail('NO_CREDENTIALS', '读不到桥凭据（面板未开或凭据不合规）');

  const client = createBrowserBridgeClient({
    endpoint: credentials.endpoint,
    token: credentials.token,
  });

  const health = await client.health();
  const observe = await client.observe({ panelId: credentials.panelId, actor: ACTOR });

  const result = {
    ok: true,
    pid: process.pid,
    registry: {
      endpoint: credentials.endpoint,
      panelId: credentials.panelId,
      sessionId: credentials.sessionId,
      webContentsId: credentials.webContentsId,
      ageMs: credentials.ageMs,
    },
    health,
    observe: {
      binding: observe.binding,
      title: observe.title,
      textSample: observe.textSample,
    },
  };

  if (expectedText && !String(observe.textSample || '').includes(expectedText)) {
    result.expectedTextFound = false;
  } else {
    result.expectedTextFound = expectedText ? true : null;
  }

  // mode=sign：签一张导航确认单，并读回它此时的状态（期望 pending）
  if (mode === 'sign' || mode === 'full') {
    // 只签单：拿得到 actionId 说明"写动作要先过审批闸门"，拿不到就是通道有问题
    const ticket = await client.requestAction({
      panelId: credentials.panelId,
      actor: ACTOR,
      method: 'Page.navigate',
      params: { url: NAV_URL },
      summary: { label: 'E2E 导航验证' },
    });
    result.ticket = ticket;
    const state = await client.actionState({
      panelId: credentials.panelId,
      actor: ACTOR,
      actionId: ticket.actionId,
    });
    result.ticketState = state.state;
    // 待批状态下带单执行必须被拒（后端不能替用户点头）
    try {
      await client.execute({
        panelId: credentials.panelId,
        actor: ACTOR,
        method: 'Page.navigate',
        params: { url: NAV_URL },
        actionId: ticket.actionId,
      });
      result.pendingExecuteBlocked = false;
    } catch (error) {
      result.pendingExecuteBlocked = true;
      result.pendingExecuteError = error instanceof BridgeError ? error.code : String(error);
    }
  }

  // mode=execute <actionId>：假定用户已批准，查状态后带单执行，再回读页面
  if (mode === 'execute' && actionId) {
    const state = await client.actionState({
      panelId: credentials.panelId,
      actor: ACTOR,
      actionId,
    });
    result.actionState = state;
    if (state.state !== 'approved') {
      result.executed = false;
      result.skipReason = `确认单状态 ${state.state}（未获批准，不执行）`;
    } else {
      const out = await client.execute({
        panelId: credentials.panelId,
        actor: ACTOR,
        method: 'Page.navigate',
        params: { url: NAV_URL },
        actionId,
      });
      result.execute = out;
      // Page.navigate 返回时新文档往往还没提交，webContents.getURL() 会滞后一拍
      //（阶段 5 实测：文本已是新页、URL 还是旧页）。因此回读必须轮询，
      // 否则会拿到"内容与 URL 不自洽"的假证据。
      const deadline = Date.now() + 6000;
      let after = await client.observe({ panelId: credentials.panelId, actor: ACTOR });
      let polls = 1;
      while (Date.now() < deadline) {
        const urlOk = String(after.binding?.url || '').includes(NAV_URL);
        const textOk = !expectedText
          || String(after.textSample || '').includes(expectedText);
        if (urlOk && textOk) break;
        await new Promise((r) => setTimeout(r, 300));
        after = await client.observe({ panelId: credentials.panelId, actor: ACTOR });
        polls += 1;
      }
      result.afterObserve = {
        binding: after.binding,
        title: after.title,
        textSample: after.textSample,
      };
      result.observePolls = polls;
    }
  }

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((error) => {
  const code = error instanceof BridgeError ? error.code : 'UNEXPECTED';
  fail(code, error && error.message ? error.message : String(error));
});
