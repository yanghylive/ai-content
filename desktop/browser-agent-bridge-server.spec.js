'use strict';
/**
 * browser-agent-bridge-server.spec.js — 上行桥安全边界端到端测试（纯 node http）
 * 运行：node desktop/browser-agent-bridge-server.spec.js
 *
 * 覆盖：
 *  - 无 token / 错 token → 401；重放 nonce → 409；时钟偏差 → 401；
 *  - 缺 actor → 400；跨 owner/tenant → 403（wiring 透传 broker fail-closed）；
 *  - observe 只读通路成功且 URL 脱敏；action-request 只签发确认单（不自批）；
 *  - 未知路由 404；不代理任意 CDP（无 /cdp 泛化端点）。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const {
  startBrowserBridge,
  timingSafeEqualStr,
  TOKEN_HEADER,
  NONCE_HEADER,
  TS_HEADER,
} = require('./browser-agent-bridge-server');

function makeFakeWiring() {
  const session = {
    panelId: 'panel-x',
    sessionId: 'sess-x',
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    url: 'http://127.0.0.1:80/page?token=SECRET-abc&keep=1',
    webContentsId: 77,
  };
  const redact = (u) => String(u).replace(/token=[^&]+/, 'token=***');
  return {
    hasHandle: (id) => id === 'panel-x',
    resolveTargetForAgent(panelId, actor) {
      if (panelId !== 'panel-x') throw new Error('未登记');
      if (!actor || !actor.ownerId) throw new Error('actor 必须携带身份');
      if (actor.ownerId !== session.ownerId || actor.tenantId !== session.tenantId) {
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
      return { ...session };
    },
    async sendCDPForAgent(panelId, actor, method, params, opts) {
      // 与真实 wiring.handleFor 对齐：actor 断言在**每个**入口都要过，
      // 不能只在 resolveTarget 上（否则 /execute 会成为绕过缝）
      if (!actor || actor.ownerId !== session.ownerId || actor.tenantId !== session.tenantId) {
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
      this._lastCdp = method;
      this._lastCall = { panelId, actor, method, params, opts };
      // observe 内部会 evaluate 拿 title/text
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
    listPendingActions(panelId) {
      return panelId === 'panel-x'
        ? [{ actionId: 'act-1', method: 'Page.navigate', summary: { label: '导航' } }]
        : [];
    },
    actionStateForAgent(panelId, actor, actionId) {
      if (!actor || actor.ownerId !== session.ownerId) {
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
      if (actionId === 'approved-1') {
        return {
          actionId,
          state: 'approved',
          panelId,
          method: 'Page.navigate',
          approvedAt: Date.now(),
        };
      }
      if (actionId === 'act-1') {
        return {
          actionId,
          state: 'pending',
          panelId,
          method: 'Page.navigate',
          approvedAt: null,
        };
      }
      return { actionId, state: 'none', panelId: null, method: null, approvedAt: null };
    },
    listEventsForAgent() {
      return [];
    },
    // 2026-09-05 panel-open：引擎打开面板端点的转发目标
    openPanelForAgent(input) {
      if (!input || !input.url) throw new Error('panel-open: url 必填');
      let host = null;
      try {
        host = new URL(input.url).host;
      } catch {
        host = null;
      }
      const allowed =
        host &&
        ['douyin.com', 'weixin.qq.com', 'xiaohongshu.com'].some(
          (h) => host === h || host.endsWith('.' + h),
        );
      if (!allowed) throw new Error(`panel-open 仅允许已知平台域名（命中: ${String(host)}）`);
      return {
        panelId: 'panel-x',
        accountId: input.accountId ?? null,
        platform: input.platform ?? null,
        partition: `persist:kaypal-browser-local-desktop-${input.accountId ?? ''}`,
        url: input.url,
      };
    },
  };
}

function request(port, token, path, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: data ? 'POST' : 'GET',
        headers: {
          [TOKEN_HEADER]: opts.wrongToken ? 'wrong' : token,
          [NONCE_HEADER]: opts.nonce ?? crypto.randomBytes(16).toString('hex'),
          [TS_HEADER]: String(opts.ts ?? Date.now()),
          ...(data ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const ACTOR_A = { ownerId: 'user-a', tenantId: 'tenant-a' };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function withBridge(fn) {
  const wiring = makeFakeWiring();
  const bridge = await startBrowserBridge({ wiring, logger: { warn: () => {}, error: () => {} } });
  try {
    await fn(bridge, wiring);
  } finally {
    await bridge.close();
  }
}

test('无 token → 401', async () => {
  await withBridge(async (bridge) => {
    const res = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/health', method: 'GET' }, (r) => {
        r.resume();
        r.on('end', () => resolve(r.statusCode));
      });
      req.end();
    });
    assert.equal(res, 401);
  });
});

test('错 token → 401（timing-safe）', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/health', null, { wrongToken: true });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'UNAUTHORIZED');
  });
});

test('重放 nonce → 409', async () => {
  await withBridge(async (bridge) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const first = await request(bridge.port, bridge.token, '/health', null, { nonce });
    assert.equal(first.status, 200);
    const replay = await request(bridge.port, bridge.token, '/health', null, { nonce });
    assert.equal(replay.status, 409);
    assert.equal(replay.json.error.code, 'REPLAY');
  });
});

test('时钟偏差过大 → 401 STALE', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/health', null, {
      ts: Date.now() - 10 * 60_000,
    });
    assert.equal(status, 401);
    assert.equal(json.error.code, 'STALE_REQUEST');
  });
});

test('observe 成功且 URL 脱敏（凭据 query 不出网）', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(status, 200);
    assert.equal(json.data.target.sessionId, 'sess-x');
    assert.ok(json.data.target.url.includes('token=***'), 'token 应脱敏');
    assert.ok(!json.data.target.url.includes('SECRET-abc'), '原文不得出现');
    assert.ok(json.data.target.url.includes('keep=1'), '非敏感保留');
    assert.equal(json.data.title, 'T');
  });
});

test('observe 跨 owner → 403 POLICY_DENIED', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
      actor: { ownerId: 'user-b', tenantId: 'tenant-b' },
    });
    assert.equal(status, 403);
    assert.equal(json.error.code, 'POLICY_DENIED');
  });
});

test('403 拒绝原因细分：token 过期 → TOKEN_EXPIRED + reason 透出（2026-09-04）', async () => {
  await withBridge(async (bridge, wiring) => {
    wiring.resolveTargetForAgent = () => {
      throw new Error('capability token 已过期（fail-closed）');
    };
    const { status, json } = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(status, 403);
    assert.equal(json.error.code, 'TOKEN_EXPIRED');
    assert.ok(json.error.reason, 'reason 应透出（安全 message，不含堆栈）');
    assert.ok(/已过期/.test(json.error.reason));
  });
});

test('403 拒绝原因细分：token 无效 → TOKEN_INVALID；面板不存在 → PANEL_NOT_FOUND', async () => {
  await withBridge(async (bridge, wiring) => {
    wiring.resolveTargetForAgent = () => {
      throw new Error('capability token 无效（fail-closed）');
    };
    const r1 = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(r1.status, 403);
    assert.equal(r1.json.error.code, 'TOKEN_INVALID');

    wiring.resolveTargetForAgent = () => {
      throw new Error('面板不存在');
    };
    const r2 = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(r2.status, 403);
    assert.equal(r2.json.error.code, 'PANEL_NOT_FOUND');
  });
});

test('缺 actor → 400', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/observe', {
      panelId: 'panel-x',
    });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'ACTOR_REQUIRED');
  });
});

test('action-request 只签发确认单（不自批）', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/action-request', {
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Input.dispatchMouseEvent',
      summary: { label: '点击' },
    });
    assert.equal(status, 200);
    assert.equal(json.data.actionId, 'act-1');
    assert.equal(json.data.binding.webContentsId, 77);
  });
});

test('execute 写动作缺确认单 → 403（桥不自我批准，fail-closed）', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/execute', {
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Page.navigate',
      params: { url: 'https://kaypal.cn/x' },
    });
    assert.equal(status, 403);
    assert.equal(json.error.code, 'POLICY_DENIED');
  });
});

test('execute 写动作带已批准确认单 → 200，且不回传原始 CDP 结果', async () => {
  await withBridge(async (bridge, wiring) => {
    const { status, json } = await request(bridge.port, bridge.token, '/execute', {
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Page.navigate',
      params: { url: 'https://kaypal.cn/x' },
      actionId: 'act-1',
    });
    assert.equal(status, 200);
    assert.equal(json.data.executed, true);
    assert.equal(json.data.binding.webContentsId, 77);
    // 写动作只回执，不把页面内容/凭据带回后端进程
    assert.equal(json.data.result, null);
    // 确认单确实传到了闸门（否则等于绕过审批）
    assert.equal(wiring._lastCall.opts.approvedActionId, 'act-1');
    assert.equal(wiring._lastCall.method, 'Page.navigate');
  });
});

test('execute 只读方法无需确认单 → 200 且回传结果', async () => {
  await withBridge(async (bridge, wiring) => {
    const { status, json } = await request(bridge.port, bridge.token, '/execute', {
      panelId: 'panel-x',
      actor: ACTOR_A,
      method: 'Runtime.evaluate',
      params: { expression: '1+1', returnByValue: true },
    });
    assert.equal(status, 200);
    assert.equal(json.data.executed, true);
    assert.equal(json.data.result.result.value, JSON.stringify({ title: 'T', text: 'hello' }));
    assert.equal(wiring._lastCall.opts.approvedActionId, undefined);
  });
});

test('execute 跨 owner → 403（执行缝同样受 actor 断言保护）', async () => {
  await withBridge(async (bridge) => {
    const { status } = await request(bridge.port, bridge.token, '/execute', {
      panelId: 'panel-x',
      actor: { ownerId: 'user-b', tenantId: 'tenant-b' },
      method: 'Page.navigate',
      actionId: 'act-1',
    });
    assert.equal(status, 403);
  });
});

test('pending-actions 返回待批列表（不含 token）', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/pending-actions', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(status, 200);
    assert.equal(json.data.items.length, 1);
    assert.equal(json.data.items[0].actionId, 'act-1');
    assert.ok(!JSON.stringify(json).includes(bridge.token), '列表不得回传 token');
  });
});

test('action-state：待批=pending / 已批准=approved / 未知=none', async () => {
  await withBridge(async (bridge) => {
    const q = (actionId) => request(bridge.port, bridge.token, '/action-state', {
      panelId: 'panel-x',
      actor: ACTOR_A,
      actionId,
    });
    const pending = await q('act-1');
    assert.equal(pending.status, 200);
    assert.equal(pending.json.data.state, 'pending');
    const approved = await q('approved-1');
    assert.equal(approved.json.data.state, 'approved');
    assert.ok(approved.json.data.approvedAt > 0);
    const none = await q('does-not-exist');
    assert.equal(none.json.data.state, 'none');
  });
});

test('action-state：缺 actionId → 403 fail-closed；跨 owner → 403', async () => {
  await withBridge(async (bridge) => {
    const missing = await request(bridge.port, bridge.token, '/action-state', {
      panelId: 'panel-x',
      actor: ACTOR_A,
    });
    assert.equal(missing.status, 403);
    const cross = await request(bridge.port, bridge.token, '/action-state', {
      panelId: 'panel-x',
      actor: { ownerId: 'user-b', tenantId: 'tenant-b' },
      actionId: 'act-1',
    });
    assert.equal(cross.status, 403);
  });
});

test('未知路由 → 404（无任意 CDP 代理端点）', async () => {
  await withBridge(async (bridge) => {
    const { status } = await request(bridge.port, bridge.token, '/cdp', { method: 'Network.getAllCookies' });
    assert.equal(status, 404);
  });
});

test('health 免 actor', async () => {
  await withBridge(async (bridge) => {
    const { status, json } = await request(bridge.port, bridge.token, '/health');
    assert.equal(status, 200);
    assert.equal(json.data.ok, true);
    assert.equal(json.data.protocol, 'kaypal-browser-bridge');
  });
});

test('timingSafeEqualStr：长度不等也返回 false 不抛', () => {
  assert.equal(timingSafeEqualStr('abc', 'abcdef'), false);
  assert.equal(timingSafeEqualStr('same', 'same'), true);
});

test('close 后端口释放 + 后续调用不可达（before-quit 收尾语义）', async () => {
  const bridge = await startBrowserBridge({
    wiring: makeFakeWiring(),
    logger: { warn: () => {}, error: () => {} },
  });
  const { port, token } = bridge;
  // 关桥前可用
  const alive = await request(port, token, '/health');
  assert.equal(alive.status, 200);
  await bridge.close();
  // 关桥后：同一端口应拒绝连接（token 与 endpoint 一并失效）
  let refused = false;
  try {
    await request(port, token, '/health');
  } catch (error) {
    refused = /ECONNREFUSED/i.test(String(error && error.message));
  }
  assert.equal(refused, true, 'close() 后端口必须释放，旧 token 不再可用');
  // 重复 close 幂等
  await bridge.close();
});

// ---- 2026-09-05 引擎「内置面板优先」：POST /panel-open ----

test('panel-open：放行白名单域并转发 wiring，返回 partition 映射', async () => {
  let received = null;
  const wiring = makeFakeWiring();
  const original = wiring.openPanelForAgent;
  wiring.openPanelForAgent = (input) => {
    received = input;
    return original.call(wiring, input);
  };
  const bridge = await startBrowserBridge({ wiring, logger: { warn: () => {}, error: () => {} } });
  try {
    const res = await request(bridge.port, bridge.token, '/panel-open', {
      actor: { ownerId: 'local-engine', tenantId: 'local-tenant' },
      url: 'https://creator.douyin.com/creator-micro/home',
      accountId: '7',
      platform: 'douyin',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.partition, 'persist:kaypal-browser-local-desktop-7');
    assert.equal(received.accountId, '7');
    assert.equal(received.platform, 'douyin');
  } finally {
    await bridge.close();
  }
});

test('panel-open：非白名单域 403 + 缺 actor 400（fail-closed）', async () => {
  const wiring = makeFakeWiring();
  const bridge = await startBrowserBridge({ wiring, logger: { warn: () => {}, error: () => {} } });
  try {
    const bad = await request(bridge.port, bridge.token, '/panel-open', {
      actor: { ownerId: 'local-engine', tenantId: 'local-tenant' },
      url: 'https://evil.example.com/x',
      accountId: '1',
      platform: 'douyin',
    });
    assert.equal(bad.status, 403, '白名单外域名必须 403');
    const noActor = await request(bridge.port, bridge.token, '/panel-open', {
      url: 'https://creator.douyin.com/creator-micro/home',
    });
    assert.equal(noActor.status, 400, '缺 actor 必须 400');
  } finally {
    await bridge.close();
  }
});

// 2026-09-05 复核 P1：panel 路由 actor 归属校验（与 /execute 同强度）
test('panel-state：引擎 actor 200 / 非 local-engine 身份 403（fail-closed）', async () => {
  const wiring = makeFakeWiring();
  wiring.panelStateForAgent = (actor) => {
    if (
      !actor ||
      actor.ownerId !== 'local-engine' ||
      actor.tenantId !== 'local-tenant'
    ) {
      throw new Error('面板路由 actor 身份不一致（仅允许 local-engine 引擎身份，fail-closed）');
    }
    return { hasSession: false, accountId: null, partition: null };
  };
  const bridge = await startBrowserBridge({ wiring, logger: { warn: () => {}, error: () => {} } });
  try {
    const ok = await request(bridge.port, bridge.token, '/panel-state', {
      actor: { ownerId: 'local-engine', tenantId: 'local-tenant' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.hasSession, false);
    const wrong = await request(bridge.port, bridge.token, '/panel-state', {
      actor: { ownerId: 'someone-else', tenantId: 'local-tenant' },
    });
    assert.equal(wrong.status, 403, '非引擎身份必须 403');
    assert.equal(wrong.json.error.code, 'POLICY_DENIED');
  } finally {
    await bridge.close();
  }
});

test('panel-open：actor 身份不一致透传为 403（wiring 断言生效）', async () => {
  const wiring = makeFakeWiring();
  wiring.openPanelForAgent = (input) => {
    if (
      !input ||
      !input.actor ||
      input.actor.ownerId !== 'local-engine' ||
      input.actor.tenantId !== 'local-tenant'
    ) {
      throw new Error('面板路由 actor 身份不一致（仅允许 local-engine 引擎身份，fail-closed）');
    }
    return { panelId: 'p1', accountId: input.accountId, partition: null };
  };
  const bridge = await startBrowserBridge({ wiring, logger: { warn: () => {}, error: () => {} } });
  try {
    const wrong = await request(bridge.port, bridge.token, '/panel-open', {
      actor: { ownerId: 'local-engine', tenantId: 'other-tenant' },
      url: 'https://creator.douyin.com/creator-micro/home',
    });
    assert.equal(wrong.status, 403, 'actor 身份不一致必须 403');
    assert.equal(wrong.json.error.code, 'POLICY_DENIED');
  } finally {
    await bridge.close();
  }
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
    console.error(`BRIDGE SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`BRIDGE SPEC PASSED (${tests.length})`);
  }
})();
