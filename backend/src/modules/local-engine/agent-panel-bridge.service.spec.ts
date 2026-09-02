import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, statSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import {
  AgentPanelBridgeService,
  PanelBridgeError,
} from './agent-panel-bridge.service';

const PROTOCOL = 'kaypal-browser-bridge';
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const ACTOR = { ownerId: 'u1', tenantId: 't1' };

/** 起一个符合桥协议的最小桩服务（token + nonce + 时钟偏差 + 三条路由） */
function startStubBridge(token: string) {
  const seen: Array<{ route: string; method: string; token?: string; body?: any }> =
    [];
  const nonceSeen = new Set<string>();
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const route = (req.url || '/').split('?')[0];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      seen.push({
        route,
        method: req.method || '',
        token: req.headers[TOKEN_HEADER] as string | undefined,
        body,
      });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const provided = req.headers[TOKEN_HEADER];
      if (provided !== token) {
        return send(401, { success: false, error: { code: 'UNAUTHORIZED' } });
      }
      const nonce = String(req.headers['x-kaypal-bridge-nonce'] || '');
      if (!nonce || nonceSeen.has(nonce)) {
        return send(409, { success: false, error: { code: 'REPLAY' } });
      }
      nonceSeen.add(nonce);
      const ts = Number(req.headers['x-kaypal-bridge-ts']);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) {
        return send(401, { success: false, error: { code: 'STALE_REQUEST' } });
      }
      if (route === '/health' && req.method === 'GET') {
        return send(200, { success: true, data: { ok: true, protocol: PROTOCOL } });
      }
      if (route === '/observe' && req.method === 'POST') {
        if (!body.actor?.ownerId) {
          return send(400, { success: false, error: { code: 'ACTOR_REQUIRED' } });
        }
        return send(200, {
          success: true,
          data: {
            binding: {
              panelId: 'panel-1',
              sessionId: 'sess-1',
              webContentsId: 77,
              url: 'http://127.0.0.1/page?token=***',
            },
            target: {},
            title: '测试页',
            textSample: 'hello',
          },
        });
      }
      if (route === '/action-request' && req.method === 'POST') {
        return send(200, {
          success: true,
          data: {
            actionId: 'act-1',
            binding: { webContentsId: 77, method: body.method },
          },
        });
      }
      if (route === '/execute' && req.method === 'POST') {
        // 写动作缺确认单 → 服务端拒绝（桥不自我批准）
        if (!body.actionId) {
          return send(403, { success: false, error: { code: 'POLICY_DENIED' } });
        }
        return send(200, {
          success: true,
          data: {
            binding: {
              panelId: 'panel-1',
              sessionId: 'sess-1',
              webContentsId: 77,
              url: 'https://kaypal.cn/landed',
            },
            method: body.method,
            executed: true,
            actionId: body.actionId,
            result: null,
          },
        });
      }
      if (route === '/action-state' && req.method === 'POST') {
        if (!body.actionId) {
          return send(403, { success: false, error: { code: 'POLICY_DENIED' } });
        }
        const state =
          body.actionId === 'approved-1'
            ? 'approved'
            : body.actionId === 'act-1'
              ? 'pending'
              : 'none';
        return send(200, {
          success: true,
          data: {
            actionId: body.actionId,
            state,
            panelId: 'panel-1',
            method: 'Page.navigate',
            approvedAt: state === 'approved' ? Date.now() : null,
          },
        });
      }
      if (route === '/pending-actions' && req.method === 'POST') {
        return send(200, {
          success: true,
          data: {
            items: [{ actionId: 'act-1', method: 'Page.navigate', summary: { label: '导航' } }],
          },
        });
      }
      return send(404, { success: false, error: { code: 'UNKNOWN_ROUTE' } });
    });
  });

  return new Promise<{
    port: number;
    seen: typeof seen;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        seen,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function writeCredFile(payload: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'panel-bridge-'));
  const file = join(dir, 'browser-panel-bridge.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      protocol: PROTOCOL,
      startedAt: new Date().toISOString(),
      pid: process.pid,
      ...payload,
    }),
    { mode: 0o600 },
  );
  return { dir, file };
}

function useCredFile(file: string | null) {
  if (file === null) {
    delete process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
  } else {
    process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = file;
  }
}

describe('AgentPanelBridgeService', () => {
  const originalFile = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
  const originalUserData = process.env.KAYPAL_DESKTOP_USER_DATA_DIR;

  afterEach(() => {
    if (originalFile === undefined) delete process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = originalFile;
    if (originalUserData === undefined) delete process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
    else process.env.KAYPAL_DESKTOP_USER_DATA_DIR = originalUserData;
  });

  it('凭据文件缺失 → 不可用（fail-closed，不伪造成功）', () => {
    useCredFile(null);
    process.env.KAYPAL_DESKTOP_USER_DATA_DIR = join(tmpdir(), '不存在的目录-xyz');
    const svc = new AgentPanelBridgeService();
    const status = svc.status();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('panel-not-open');
  });

  it('合规文件 → 读出 endpoint/panelId/sessionId/webContentsId', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:54321',
      token: 'tok',
      panelId: 'panel-1',
      sessionId: 'sess-1',
      webContentsId: 77,
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    const status = svc.status();
    expect(status.available).toBe(true);
    expect(status.endpoint).toBe('http://127.0.0.1:54321');
    expect(status.panelId).toBe('panel-1');
    expect(status.webContentsId).toBe(77);
  });

  it.each([
    ['非回环 endpoint', { endpoint: 'http://evil.example.com:1', token: 't' }],
    ['https 回环也不放行（桥只跑 http）', { endpoint: 'https://127.0.0.1:1', token: 't' }],
    ['协议不匹配', { endpoint: 'http://127.0.0.1:1', token: 't', protocol: 'other' }],
    ['缺 token', { endpoint: 'http://127.0.0.1:1' }],
    ['内网地址', { endpoint: 'http://10.0.0.5:1', token: 't' }],
  ])('fail-closed：%s → 不可用', (_name, payload) => {
    const { file } = writeCredFile(payload as Record<string, unknown>);
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(svc.status().available).toBe(false);
  });

  it('fail-closed：老化文件（>1h）→ 不可用', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:1',
      token: 't',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(svc.status().available).toBe(false);
  });

  it('fail-closed：pid 已死 → 不可用（desktop 崩了没删文件的兜底）', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:1',
      token: 't',
      pid: 999999,
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(svc.status().available).toBe(false);
  });

  it('存量 0644 文件读取时被强制收紧为 0600', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:1',
      token: 't',
    });
    chmodSync(file, 0o644);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(svc.status().available).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('observe 成功：拿到 binding(webContentsId) + 标题 + 正文摘要', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
      panelId: 'panel-1',
      sessionId: 'sess-1',
      webContentsId: 77,
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      const result = await svc.observe(ACTOR);
      expect(result.binding.webContentsId).toBe(77);
      expect(result.binding.panelId).toBe('panel-1');
      expect(result.title).toBe('测试页');
      expect(result.textSample).toBe('hello');
      // 凭据不出现在返回值里
      expect(JSON.stringify(result)).not.toContain('tok-1');
      // 请求确实带了 actor
      expect(stub.seen.some((s) => s.route === '/observe' && s.body?.actor?.ownerId === 'u1')).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it('observe 错 token → PanelBridgeError(UNAUTHORIZED, 401)', async () => {
    const stub = await startStubBridge('tok-real');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-wrong',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      await expect(svc.observe(ACTOR)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      });
    } finally {
      await stub.close();
    }
  });

  it('缺 actor → 本地直接拒（不发网络请求）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      await expect(svc.observe({ ownerId: 'u1' } as never)).rejects.toMatchObject({
        code: 'ACTOR_REQUIRED',
      });
      await expect(svc.observe(null as never)).rejects.toBeInstanceOf(PanelBridgeError);
      expect(stub.seen.filter((s) => s.route === '/observe').length).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it('面板未开（无凭据）时 observe → PANEL_UNAVAILABLE 503', async () => {
    useCredFile(null);
    process.env.KAYPAL_DESKTOP_USER_DATA_DIR = join(tmpdir(), '不存在的目录-xyz');
    const svc = new AgentPanelBridgeService();
    await expect(svc.observe(ACTOR)).rejects.toMatchObject({
      code: 'PANEL_UNAVAILABLE',
      status: 503,
    });
  });

  it('桥进程不在（端口没人听）→ NETWORK_ERROR，不静默成功', async () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:1',
      token: 'tok-1',
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    await expect(svc.observe(ACTOR)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    expect(await svc.health()).toBe(false);
  });

  it('health：通 → true；凭据不存在 → false', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      expect(await svc.health()).toBe(true);
    } finally {
      await stub.close();
    }
    // 桥关掉后：文件还在，但探活失败
    const svc2 = new AgentPanelBridgeService();
    expect(svc2.status().available).toBe(true);
    expect(await svc2.health()).toBe(false);
  });

  it('requestAction 只拿确认单（actionId），不执行不自批', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn' },
        summary: { label: '打开发布页' },
      });
      expect(ticket.actionId).toBe('act-1');
      expect(ticket.binding.webContentsId).toBe(77);
      expect(ticket.binding.method).toBe('Page.navigate');
      // 桩服务没有 /execute 路由，说明本服务确实只签单不执行
      expect(stub.seen.some((s) => s.route === '/action-request')).toBe(true);
      expect(stub.seen.some((s) => s.route === '/execute')).toBe(false);
    } finally {
      await stub.close();
    }
  });

  it('requestAction 缺 method → METHOD_REQUIRED 400', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      await expect(
        svc.requestAction(ACTOR, { method: '' }),
      ).rejects.toMatchObject({ code: 'METHOD_REQUIRED', status: 400 });
    } finally {
      await stub.close();
    }
  });

  it('缓存：1s 内复用（改文件不立即生效），clearCache 后立即生效', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:1111',
      token: 't1',
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(svc.status().endpoint).toBe('http://127.0.0.1:1111');

    writeFileSync(
      file,
      JSON.stringify({
        protocol: PROTOCOL,
        endpoint: 'http://127.0.0.1:2222',
        token: 't2',
        startedAt: new Date().toISOString(),
        pid: process.pid,
      }),
    );
    // 缓存未过期 → 仍是旧值
    expect(svc.status().endpoint).toBe('http://127.0.0.1:1111');
    svc.clearCache();
    expect(svc.status().endpoint).toBe('http://127.0.0.1:2222');
  });

  it('凭据文件内容不会被写进 status 返回值（token 不外泄）', () => {
    const { file } = writeCredFile({
      endpoint: 'http://127.0.0.1:54321',
      token: 'super-secret-token',
    });
    useCredFile(file);
    const svc = new AgentPanelBridgeService();
    expect(JSON.stringify(svc.status())).not.toContain('super-secret-token');
    expect(readFileSync(file, 'utf8')).toContain('super-secret-token');
  });

  it('execute：带已批准确认单 → 执行成功并回真实 URL + webContentsId', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      const out = await svc.execute(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
        actionId: 'act-1',
      });
      expect(out.executed).toBe(true);
      expect(out.binding.webContentsId).toBe(77);
      expect(out.binding.url).toBe('https://kaypal.cn/landed');
      expect(out.result).toBeNull();
      const call = stub.seen.find((s) => s.route === '/execute');
      expect(call?.body?.actionId).toBe('act-1');
    } finally {
      await stub.close();
    }
  });

  it('execute：写动作缺确认单 → 桥拒绝 POLICY_DENIED 403（不静默执行）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      await expect(
        svc.execute(ACTOR, { method: 'Page.navigate', params: {} }),
      ).rejects.toMatchObject({ code: 'POLICY_DENIED', status: 403 });
    } finally {
      await stub.close();
    }
  });

  it('execute / actionState：缺 actor 本地拒、缺 method 本地拒（不发请求）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      await expect(
        svc.execute({ ownerId: '', tenantId: 't1' }, { method: 'Page.navigate' }),
      ).rejects.toMatchObject({ code: 'ACTOR_REQUIRED', status: 400 });
      await expect(svc.execute(ACTOR, { method: '' })).rejects.toMatchObject({
        code: 'METHOD_REQUIRED',
        status: 400,
      });
      await expect(svc.actionState(ACTOR, '')).rejects.toMatchObject({
        code: 'METHOD_REQUIRED',
        status: 400,
      });
      expect(stub.seen.some((s) => s.route === '/execute')).toBe(false);
    } finally {
      await stub.close();
    }
  });

  it('actionState：pending / approved / none 三态（后端执行写动作的合法前置）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      expect((await svc.actionState(ACTOR, 'act-1')).state).toBe('pending');
      const approved = await svc.actionState(ACTOR, 'approved-1');
      expect(approved.state).toBe('approved');
      expect(approved.approvedAt).toBeGreaterThan(0);
      expect((await svc.actionState(ACTOR, 'ghost')).state).toBe('none');
    } finally {
      await stub.close();
    }
  });

  it('pendingActions：返回待批列表（不含 token）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      const items = await svc.pendingActions(ACTOR);
      expect(items.length).toBe(1);
      expect(items[0].actionId).toBe('act-1');
      expect(JSON.stringify(items)).not.toContain('tok-1');
    } finally {
      await stub.close();
    }
  });
});
