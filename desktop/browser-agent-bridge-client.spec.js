'use strict';
/**
 * browser-agent-bridge-client.spec.js — 上行桥客户端 SDK 测试（对真实桥服务器端到端）
 * 运行：node desktop/browser-agent-bridge-client.spec.js
 *
 * 覆盖：
 *  - 构造期 fail-closed：缺 token / 非回环 endpoint / 非法协议 endpoint 一律抛；
 *  - 只读 observe / 健康检查成功路径（真实 http 往返）；
 *  - 跨 owner 被服务端拒 → BridgeError(POLICY_DENIED, 403)，客户端不吞错不降级；
 *  - 客户端本地拒绝缺 actor / 缺 panelId / 缺 method（不发无效请求）；
 *  - 错 token → BridgeError(UNAUTHORIZED, 401)；
 *  - 连续两次 observe 各带新 nonce 均成功（防重放不误伤正常重试）；
 *  - 桥 close 后调用 → NETWORK_ERROR（端口已释放，证明退出收尾有效）。
 */
const assert = require('node:assert/strict');
const { startBrowserBridge } = require('./browser-agent-bridge-server');
const {
  createBrowserBridgeClient,
  parseEndpoint,
  BridgeError,
} = require('./browser-agent-bridge-client');

const ACTOR_A = { ownerId: 'user-a', tenantId: 'tenant-a' };

function makeFakeWiring() {
  const session = {
    panelId: 'panel-x',
    sessionId: 'sess-x',
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    url: 'http://127.0.0.1:80/page?token=SECRET-abc&keep=1',
    webContentsId: 77,
  };
  return {
    resolveTargetForAgent(panelId, actor) {
      if (panelId !== 'panel-x') throw new Error('未登记');
      if (!actor || !actor.ownerId) throw new Error('actor 必须携带身份');
      if (actor.ownerId !== session.ownerId || actor.tenantId !== session.tenantId) {
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
      return { ...session };
    },
    async sendCDPForAgent(_panelId, actor, method, params, opts) {
      if (!actor || actor.ownerId !== session.ownerId || actor.tenantId !== session.tenantId) {
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
      this._lastCall = { method, params, opts };
      if (method === 'Runtime.evaluate') {
        return {
          result: { result: { value: JSON.stringify({ title: 'T', text: 'hello' }) } },
          target: { ...session },
        };
      }
      return { result: { ok: true }, target: { ...session } };
    },
    requestActionForAgent(panelId, actor, method) {
      if (!actor || actor.ownerId !== session.ownerId) throw new Error('不一致');
      return { actionId: 'act-1', binding: { webContentsId: 77, method } };
    },
    listPendingActions() {
      return [{ actionId: 'act-1', method: 'Page.navigate' }];
    },
  };
}

async function withBridge(fn) {
  const wiring = makeFakeWiring();
  const bridge = await startBrowserBridge({
    wiring,
    logger: { warn: () => {}, error: () => {} },
  });
  try {
    await fn(bridge, wiring);
  } finally {
    await bridge.close();
  }
}

async function expectBridgeError(promise, code, status) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof BridgeError, `应抛 BridgeError，实际 ${error}`);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return error;
  }
  assert.fail(`应当抛错但没有：${code}`);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('构造期：缺 token → TOKEN_REQUIRED（缺失即失败，不静默降级）', () => {
  assert.throws(
    () => createBrowserBridgeClient({ endpoint: 'http://127.0.0.1:1234' }),
    (e) => e instanceof BridgeError && e.code === 'TOKEN_REQUIRED',
  );
});

test('构造期：非回环 endpoint → BAD_ENDPOINT', () => {
  for (const bad of [
    'http://evil.example.com:1234',
    'http://10.0.0.5:1234',
    'http://192.168.1.9:1234',
  ]) {
    assert.throws(
      () => createBrowserBridgeClient({ endpoint: bad, token: 't' }),
      (e) => e instanceof BridgeError && e.code === 'BAD_ENDPOINT',
      bad,
    );
  }
});

test('构造期：非法协议 / 非法 URL → BAD_ENDPOINT', () => {
  for (const bad of ['file:///tmp/bridge', 'not-a-url', 'ftp://127.0.0.1:21']) {
    assert.throws(
      () => createBrowserBridgeClient({ endpoint: bad, token: 't' }),
      (e) => e instanceof BridgeError && e.code === 'BAD_ENDPOINT',
      bad,
    );
  }
});

test('parseEndpoint：回环地址放行并解析端口', () => {
  assert.deepEqual(parseEndpoint('http://127.0.0.1:54321'), {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 54321,
  });
  assert.equal(parseEndpoint('https://localhost').port, 443);
  assert.equal(parseEndpoint('http://[::1]:8080').port, 8080);
});

test('health 免 actor 成功（真实往返）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const data = await client.health();
    assert.equal(data.ok, true);
    assert.equal(data.protocol, 'kaypal-browser-bridge');
  });
});

test('observe 成功且 URL 已脱敏（SECRET 不出网）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const data = await client.observe({ panelId: 'panel-x', actor: ACTOR_A });
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes('SECRET-abc'), '凭据原文不得出现在 observe 返回中');
    assert.ok(serialized.includes('token=***'), '应保留脱敏占位');
    assert.equal(data.binding.webContentsId, 77);
    assert.equal(data.binding.sessionId, 'sess-x');
    assert.equal(data.binding.panelId, 'panel-x');
    assert.ok(String(data.binding.url).includes('token=***'), 'binding.url 也须脱敏');
  });
});

test('客户端本地拒绝：缺 actor / 缺 panelId / 缺 method（不发无效请求）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    await expectBridgeError(client.observe({ panelId: 'panel-x' }), 'ACTOR_REQUIRED', 400);
    await expectBridgeError(client.observe({ actor: ACTOR_A }), 'PANEL_REQUIRED', 400);
    await expectBridgeError(
      client.requestAction({ panelId: 'panel-x', actor: ACTOR_A }),
      'METHOD_REQUIRED',
      400,
    );
  });
});

test('跨 owner 被服务端拒 → BridgeError(POLICY_DENIED, 403)，不吞错', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    await expectBridgeError(
      client.observe({ panelId: 'panel-x', actor: { ownerId: 'user-b', tenantId: 'tenant-b' } }),
      'POLICY_DENIED',
      403,
    );
  });
});

test('错 token → BridgeError(UNAUTHORIZED, 401)', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: 'wrong-token' });
    await expectBridgeError(client.health(), 'UNAUTHORIZED', 401);
  });
});

test('连续两次 observe 各带新 nonce 均成功（防重放不误伤）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const a = await client.observe({ panelId: 'panel-x', actor: ACTOR_A });
    const b = await client.observe({ panelId: 'panel-x', actor: ACTOR_A });
    assert.equal(a.binding.webContentsId, b.binding.webContentsId);
  });
});

test('requestAction 只拿到确认单（含 webContentsId 绑定）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const ticket = await client.requestAction({
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Input.dispatchMouseEvent',
      summary: { label: '点击发布' },
    });
    assert.equal(ticket.actionId, 'act-1');
    assert.equal(ticket.binding.webContentsId, 77);
    assert.equal(ticket.binding.method, 'Input.dispatchMouseEvent');
  });
});

test('execute：写动作必须带 actionId，缺单被服务端拒（不静默执行）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    await expectBridgeError(
      client.execute({ panelId: 'panel-x', actor: ACTOR_A, method: 'Page.navigate', params: {} }),
      'POLICY_DENIED',
      403,
    );
  });
});

test('execute：带已批准 actionId 的写动作成功，confirmed 单号透传到闸门', async () => {
  await withBridge(async (bridge, wiring) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const out = await client.execute({
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Page.navigate',
      params: { url: 'https://kaypal.cn/x' },
      actionId: 'act-1',
    });
    assert.equal(out.executed, true);
    assert.equal(out.binding.webContentsId, 77);
    assert.equal(out.result, null, '写动作不回传原始 CDP 结果');
    assert.equal(wiring._lastCall.opts.approvedActionId, 'act-1');
  });
});

test('execute：客户端本地拒绝缺 panelId / 缺 method（不发无效请求）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    await expectBridgeError(
      client.execute({ actor: ACTOR_A, method: 'Page.navigate', actionId: 'a1' }),
      'PANEL_REQUIRED',
      400,
    );
    await expectBridgeError(
      client.execute({ panelId: 'panel-x', actor: ACTOR_A, actionId: 'a1' }),
      'METHOD_REQUIRED',
      400,
    );
  });
});

test('pendingActions：拿到待批列表（不含 token）', async () => {
  await withBridge(async (bridge) => {
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    const out = await client.pendingActions({ panelId: 'panel-x', actor: ACTOR_A });
    assert.equal(out.items[0].actionId, 'act-1');
    assert.ok(!JSON.stringify(out).includes(bridge.token));
  });
});

test('actionState：pending / approved / none 三态可读；缺参本地拒绝', async () => {
  await withBridge(async (bridge, wiring) => {
    wiring.actionStateForAgent = (panelId, actor, actionId) => ({
      actionId,
      state: actionId === 'ok-1' ? 'approved' : 'pending',
      panelId,
      method: 'Page.navigate',
      approvedAt: actionId === 'ok-1' ? Date.now() : null,
    });
    const client = createBrowserBridgeClient({ endpoint: bridge.endpoint, token: bridge.token });
    assert.equal(
      (await client.actionState({ panelId: 'panel-x', actor: ACTOR_A, actionId: 'ok-1' })).state,
      'approved',
    );
    assert.equal(
      (await client.actionState({ panelId: 'panel-x', actor: ACTOR_A, actionId: 'p-1' })).state,
      'pending',
    );
    await expectBridgeError(
      client.actionState({ panelId: 'panel-x', actor: ACTOR_A }),
      'METHOD_REQUIRED',
      400,
    );
  });
});

test('桥 close 后调用 → NETWORK_ERROR（端口已释放）', async () => {
  const bridge = await startBrowserBridge({
    wiring: makeFakeWiring(),
    logger: { warn: () => {}, error: () => {} },
  });
  const { endpoint, token } = bridge;
  const client = createBrowserBridgeClient({ endpoint, token });
  assert.equal((await client.health()).ok, true);
  await bridge.close();
  await expectBridgeError(client.health(), 'NETWORK_ERROR', 0);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error && error.message}`);
    }
  }
  if (failed > 0) {
    console.error(`BRIDGE CLIENT SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`BRIDGE CLIENT SPEC PASSED (${tests.length})`);
  }
})();
