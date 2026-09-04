import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, statSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import {
  AgentPanelBridgeService,
  PanelBridgeError,
  isPanelConfirmation,
  describePanelMethod,
  clearPanelModeRegistryCache,
  panelModeRegistryPath,
  readPanelModeRegistry,
} from './agent-panel-bridge.service';

const PROTOCOL = 'kaypal-browser-bridge';
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const ACTOR = { ownerId: 'u1', tenantId: 't1' };

/** 起一个符合桥协议的最小桩服务（token + nonce + 时钟偏差 + 三条路由） */
function startStubBridge(
  token: string,
  opts?: {
    slowScreenshotMs?: number;
    actionStates?: Record<string, string>;
    /** TraeWork 控制权：模拟桌面侧系统控制自动批准的桥响应 */
    autoApprovedRequest?: boolean;
  },
) {
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
            ...(opts?.autoApprovedRequest ? { autoApproved: true } : {}),
          },
        });
      }
      if (route === '/execute' && req.method === 'POST') {
        // round16 P1 防回归：Page.captureScreenshot 是免单只读（真桥直接执行），
        // 可选慢响应模拟大 payload base64 回传（超时放宽用例）
        if (body.method === 'Page.captureScreenshot') {
          const reply = () =>
            send(200, {
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
                actionId: body.actionId ?? null,
                result: { screenshotBase64: 'iVBORw0KGgo-stub' },
              },
            });
          if (opts?.slowScreenshotMs) {
            setTimeout(reply, opts.slowScreenshotMs).unref?.();
            return;
          }
          return reply();
        }
        // 写动作缺确认单 → 服务端拒绝（桥不自我批准）
        if (!body.actionId) {
          return send(403, { success: false, error: { code: 'POLICY_DENIED' } });
        }
        // 2026-09-04：403 细分 reason 透传用例（token 过期 → TOKEN_EXPIRED + reason）
        if (body.actionId === 'expired-1') {
          return send(403, {
            success: false,
            error: {
              code: 'TOKEN_EXPIRED',
              reason: 'capability token 已过期（fail-closed）',
            },
          });
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
          opts?.actionStates?.[String(body.actionId)] ??
          (body.actionId === 'approved-1'
            ? 'approved'
            : body.actionId === 'act-1'
              ? 'pending'
              : 'none');
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

  it('round16 P1 防回归：Page.captureScreenshot 慢响应（4s>旧3s超时）不超时、免单直执行', async () => {
    const stub = await startStubBridge('tok-slow', { slowScreenshotMs: 4000 });
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-slow',
      panelId: 'panel-1',
      sessionId: 'sess-1',
      webContentsId: 77,
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      // 旧代码 REQUEST_TIMEOUT_MS=3000 必超时（TIMEOUT）；放宽后 10s 内完成
      const result = await svc.execute(ACTOR, {
        method: 'Page.captureScreenshot',
        params: { format: 'png' },
      });
      expect(result.executed).toBe(true);
      expect((result as { result?: { screenshotBase64?: string } }).result?.screenshotBase64).toBe(
        'iVBORw0KGgo-stub',
      );
      // 免单语义：无 actionId 也执行成功（stub 不拒 403 即证明走免单分支）
      expect(stub.seen.some((s) => s.route === '/execute' && s.body?.actionId === null)).toBe(true);
    } finally {
      await stub.close();
    }
  }, 15_000);

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
      // 桥未带 autoApproved（模拟接管态/老桥）→ 缺省 false，走人工审批路径
      expect(ticket.autoApproved).toBe(false);
    } finally {
      await stub.close();
    }
  });

  it('TraeWork 控制权：requestAction 透传桥的 autoApproved（系统控制签单即批）', async () => {
    const stub = await startStubBridge('tok-1', { autoApprovedRequest: true });
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
      expect(ticket.autoApproved).toBe(true);
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

  it('execute：403 细分 reason 透传 → 失败消息含原因与重开面板提示（2026-09-04）', async () => {
    const stub = await startStubBridge('tok-1');
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
    });
    useCredFile(file);
    try {
      const svc = new AgentPanelBridgeService();
      const err = await svc
        .execute(ACTOR, { method: 'Page.navigate', params: {}, actionId: 'expired-1' })
        .catch((e: unknown) => e as PanelBridgeError);
      expect((err as PanelBridgeError).code).toBe('TOKEN_EXPIRED');
      expect(String((err as PanelBridgeError).message)).toContain('capability token 已过期');
      expect(String((err as PanelBridgeError).message)).toContain('重新打开浏览器面板');
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

/**
 * 阶段 6 决策 ②：面板确认单与后端 AgentConfirmation **合并成一套**的测试。
 *
 * 盯死四条：
 *  1. 主键 = 桥 actionId（全链路一个 id，不需要映射表）；
 *  2. 落库是审计旁路——prisma 缺失/写失败都不能阻断面板链路；
 *  3. 审批态（批准/拒绝）落得下来，事后可查"谁批的、什么时候批的"；
 *  4. 来源标记可靠（后端待批列表靠它把面板单过滤掉）。
 */
describe('AgentPanelBridgeService 与 AgentConfirmation 合并（阶段 6 决策 ②）', () => {
  const originalFile = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;

  afterEach(() => {
    if (originalFile === undefined) delete process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = originalFile;
  });

  /** 最小 prisma 桩：只实现面板落库用到的三个方法，并记录调用 */
  function makePrismaStub(opts: { failOnUpsert?: boolean } = {}) {
    const rows = new Map<string, Record<string, unknown>>();
    const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
    return {
      rows,
      calls,
      agentConfirmation: {
        upsert: async (args: Record<string, unknown>) => {
          calls.push({ op: 'upsert', args });
          if (opts.failOnUpsert) throw new Error('db down');
          const create = (args.create ?? {}) as Record<string, unknown>;
          const where = args.where as { id: string };
          rows.set(where.id, { ...(rows.get(where.id) ?? {}), ...create });
          return {};
        },
        updateMany: async (args: Record<string, unknown>) => {
          calls.push({ op: 'updateMany', args });
          const where = args.where as { id: string };
          const data = args.data as Record<string, unknown>;
          const prev = rows.get(where.id);
          if (prev) rows.set(where.id, { ...prev, ...data });
          return { count: prev ? 1 : 0 };
        },
        findUnique: async (args: Record<string, unknown>) => {
          calls.push({ op: 'findUnique', args });
          const where = args.where as { id: string };
          return rows.get(where.id) ?? null;
        },
        findMany: async (args: Record<string, unknown>) => {
          calls.push({ op: 'findMany', args });
          const where = args.where as { userId?: string; sessionId?: string; status: string };
          return Array.from(rows.values()).filter(
            (r) =>
              r.status === where.status &&
              (where.userId === undefined || r.userId === where.userId) &&
              (where.sessionId === undefined || r.sessionId === where.sessionId),
          );
        },
        update: async (args: Record<string, unknown>) => {
          calls.push({ op: 'update', args });
          const where = args.where as { id: string };
          const data = args.data as Record<string, unknown>;
          const prev = rows.get(where.id) ?? {};
          const next = { ...prev, ...data };
          rows.set(where.id, next);
          return next;
        },
      },
    };
  }

  /** 起桥 + 写凭据，返回 service 与桩 */
  async function setup(opts: { failOnUpsert?: boolean; withPrisma?: boolean; actionStates?: Record<string, string> } = {}) {
    const stub = await startStubBridge('tok-1', { actionStates: opts.actionStates });
    const { file } = writeCredFile({
      endpoint: `http://127.0.0.1:${stub.port}`,
      token: 'tok-1',
      panelId: 'panel-1',
      sessionId: 'sess-1',
    });
    useCredFile(file);
    const prisma = opts.withPrisma === false ? undefined : makePrismaStub(opts);
    const svc = new AgentPanelBridgeService(prisma as never);
    return { stub, svc, prisma: prisma as ReturnType<typeof makePrismaStub> };
  }

  it('签单落库：主键 = 桥 actionId，带 source/sessionId/method（全链路一个 id）', async () => {
    const { stub, svc, prisma } = await setup();
    try {
      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
        summary: { label: '导航', url: 'https://kaypal.cn/x' },
        sessionId: 'agent-session-7',
        leadId: 'lead-1788495284452-2c4509',
      });
      expect(ticket.actionId).toBe('act-1');
      const row = prisma.rows.get('act-1');
      expect(row).toBeTruthy();
      // 主键就是桥的 actionId —— 桌面审批 UI / 桥 / 后端 / 证据链四处同一个 id
      expect(row!.id).toBe('act-1');
      expect(row!.sessionId).toBe('agent-session-7');
      expect(row!.action).toBe('Page.navigate');
      expect(row!.targetLabel).toBe('打开网页');
      const json = row!.confirmationJson as Record<string, unknown>;
      expect(json.source).toBe('browser-panel');
      expect(json.sessionId).toBe('agent-session-7');
      expect(json.status).toBe('pending');
      // 触达审计：leadId 随签单落进 confirmationJson（线索详情按它反查触达历史）
      expect(json.leadId).toBe('lead-1788495284452-2c4509');
    } finally {
      await stub.close();
    }
  });

  it('签单对账：桌面已拒绝/已失效的旧面板单在签新单前收口落库（演示暴露的缺口）', async () => {
    const { stub, svc, prisma } = await setup({ actionStates: { 'old-rej': 'rejected', 'old-gone': 'none', 'old-wait': 'pending' } });
    try {
      // 预置三张该会话的未决面板单
      for (const id of ['old-rej', 'old-gone', 'old-wait']) {
        await svc.requestAction(ACTOR, { method: 'Page.navigate', params: { url: 'https://kaypal.cn/x' }, sessionId: 'agent-session-7' });
        // 手工改主键不可行（stub 恒返回 act-1）→ 直接种桩行
        prisma!.rows.set(id, {
          id, sessionId: 'agent-session-7', userId: ACTOR.ownerId, status: 'pending', action: 'Page.navigate',
          confirmationJson: { id, source: 'browser-panel', sessionId: 'agent-session-7', method: 'Page.navigate', status: null },
        });
      }
      // 清掉 requestAction 第一次种的 act-1，避免干扰
      prisma!.rows.delete('act-1');
      // 再签一张新单 → 触发对账
      await svc.requestAction(ACTOR, { method: 'Page.navigate', params: { url: 'https://kaypal.cn/y' }, sessionId: 'agent-session-7' });
      const rej = prisma!.rows.get('old-rej')!;
      expect(rej.status).toBe('consumed');
      expect((rej.confirmationJson as Record<string, unknown>).status).toBe('rejected');
      const gone = prisma!.rows.get('old-gone')!;
      expect(gone.status).toBe('consumed');
      expect((gone.confirmationJson as Record<string, unknown>).status).toBe('expired');
      const wait = prisma!.rows.get('old-wait')!;
      expect(wait.status).toBe('pending', '桥仍 pending 的单不动');
    } finally {
      await stub.close();
    }
  });

  it('审计旁路：落库抛错不阻断签单（拿不到库也得拿到票号）', async () => {
    const { stub, svc } = await setup({ failOnUpsert: true });
    try {
      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
        sessionId: 'agent-session-7',
      });
      expect(ticket.actionId).toBe('act-1');
    } finally {
      await stub.close();
    }
  });

  it('审计旁路：prisma 未注入 → 纯内存语义，签单照常成功', async () => {
    const { stub, svc } = await setup({ withPrisma: false });
    try {
      const ticket = await svc.requestAction(ACTOR, {
        method: 'Page.navigate',
        params: { url: 'https://kaypal.cn/x' },
      });
      expect(ticket.actionId).toBe('act-1');
      // 没注入 prisma 时 markApproved / markRejected 也不该抛
      await expect(svc.markApproved('act-1')).resolves.toBeUndefined();
      await expect(svc.markRejected('act-1')).resolves.toBeUndefined();
    } finally {
      await stub.close();
    }
  });

  it('用户在面板批准 → 审批态落库（status 列留给两阶段锁定，不动）', async () => {
    const { stub, svc, prisma } = await setup();
    try {
      await svc.requestAction(ACTOR, { method: 'Page.navigate', sessionId: 's-1' });
      await svc.markApproved('act-1');
      const row = prisma.rows.get('act-1')!;
      // 两阶段锁定的 status 列仍是 pending（真正执行时才 in_use → consumed）
      expect(row.status).toBe('pending');
      const json = row.confirmationJson as Record<string, unknown>;
      expect(json.status).toBe('approved');
      expect(typeof json.decidedAt).toBe('string');
    } finally {
      await stub.close();
    }
  });

  it('用户在面板拒绝 → 终态收口（status=consumed + json.status=rejected）', async () => {
    const { stub, svc, prisma } = await setup();
    try {
      await svc.requestAction(ACTOR, { method: 'Page.navigate', sessionId: 's-1' });
      await svc.markRejected('act-1');
      const row = prisma.rows.get('act-1')!;
      expect(row.status).toBe('consumed');
      expect((row.confirmationJson as Record<string, unknown>).status).toBe('rejected');
    } finally {
      await stub.close();
    }
  });

  it('来源标记判定：面板单认得出，后端单/脏数据不误判', async () => {
    expect(isPanelConfirmation({ source: 'browser-panel' })).toBe(true);
    expect(isPanelConfirmation({ source: 'agent-browser' })).toBe(false);
    expect(isPanelConfirmation({})).toBe(false);
    expect(isPanelConfirmation(null)).toBe(false);
    expect(isPanelConfirmation('browser-panel')).toBe(false);
    expect(isPanelConfirmation(undefined)).toBe(false);
  });

  it('CDP 方法 → 人话标签（审批卡片/待批列表给人看）', () => {
    expect(describePanelMethod('Page.navigate')).toBe('打开网页');
    expect(describePanelMethod('Input.dispatchMouseEvent')).toBe('鼠标点击');
    expect(describePanelMethod('Input.insertText')).toBe('输入文字');
    // 未登记的方法原样返回，不假装认识
    expect(describePanelMethod('Runtime.evaluate')).toBe('Runtime.evaluate');
  });
});

// ── 阶段 6 决策 ③：面板模式开关投递文件（desktop 写、3011 读）────────────────
describe('readPanelModeRegistry（面板模式开关文件）', () => {
  const MODE_PROTOCOL = 'kaypal-browser-panel-mode';
  const originalFile = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'panel-mode-'));
    process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = join(dir, 'browser-panel-mode.json');
    clearPanelModeRegistryCache();
  });

  afterEach(() => {
    if (originalFile === undefined) delete process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = originalFile;
    clearPanelModeRegistryCache();
  });

  function writeModeFile(payload: unknown): void {
    writeFileSync(process.env.KAYPAL_BROWSER_PANEL_MODE_FILE!, JSON.stringify(payload));
  }

  it('合法 on 文件 → 返回 on（路径 env 覆盖生效）', () => {
    writeModeFile({
      version: 1,
      protocol: MODE_PROTOCOL,
      mode: 'on',
      pid: process.pid, // 本测试进程活着，探活必过
      startedAt: new Date().toISOString(),
    });
    expect(panelModeRegistryPath()).toBe(process.env.KAYPAL_BROWSER_PANEL_MODE_FILE);
    expect(readPanelModeRegistry()).toBe('on');
  });

  it('合法 off 文件 → 返回 off（desktop 明确写下的关闭态）', () => {
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'off', pid: process.pid, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBe('off');
  });

  it('文件缺失 → null（默认 off，不报错）', () => {
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('protocol 不对 → null（不认陌生协议的文件）', () => {
    writeModeFile({ protocol: 'kaypal-browser-bridge', mode: 'on', pid: process.pid, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('mode 非 on/off → null（fail-closed，不猜）', () => {
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'yes', pid: process.pid, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('老化超过 7 天 → null（desktop 崩了没来得及删的兜底）', () => {
    writeModeFile({
      protocol: MODE_PROTOCOL,
      mode: 'on',
      pid: process.pid,
      startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('startedAt 缺失/非法 → null（没有时间戳按老化处理）', () => {
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'on', pid: process.pid });
    expect(readPanelModeRegistry()).toBeNull();
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'on', pid: process.pid, startedAt: 'not-a-date' });
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('pid 已死（pid=0 非法）→ null（防残留文件把开关永久顶开）', () => {
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'on', pid: 0, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('JSON 损坏 → null', () => {
    writeFileSync(process.env.KAYPAL_BROWSER_PANEL_MODE_FILE!, '{oops');
    expect(readPanelModeRegistry()).toBeNull();
  });

  it('1s 缓存生效：读到旧值，clear 后立即看到新值', () => {
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'on', pid: process.pid, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBe('on');
    // 不清缓存直接改文件 → TTL 内还是旧值
    writeModeFile({ protocol: MODE_PROTOCOL, mode: 'off', pid: process.pid, startedAt: new Date().toISOString() });
    expect(readPanelModeRegistry()).toBe('on');
    clearPanelModeRegistryCache();
    expect(readPanelModeRegistry()).toBe('off');
  });
});
