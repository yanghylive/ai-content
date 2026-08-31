import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PlaywrightMcpService } from './playwright-mcp.service';
import type { McpRuntimeService } from './mcp-runtime.service';
import { McpController } from './mcp.controller';

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    ip: '192.168.1.10',
    socket: { remoteAddress: '192.168.1.10' },
    headers: {},
    body: {},
    ...overrides,
  } as never;
}

function makeController(config: ConfigService) {
  const playwrightMcp = {} as unknown as PlaywrightMcpService;
  const mcpRuntime = {} as unknown as McpRuntimeService;
  const controller = new McpController(playwrightMcp, mcpRuntime, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return controller as any;
}

describe('McpController.checkAuth', () => {
  it('本机 loopback 直连返回 loopback（免 token）', () => {
    const controller = makeController(makeConfig({ KAYPAL_MCP_TOKEN: 'tok' }));
    expect(controller.checkAuth(makeReq({ ip: '127.0.0.1' }))).toBe('loopback');
    expect(controller.checkAuth(makeReq({ ip: '::1' }))).toBe('loopback');
    expect(controller.checkAuth(makeReq({ ip: '::ffff:127.0.0.1' }))).toBe(
      'loopback',
    );
  });

  it('主 token 匹配返回 full', () => {
    const controller = makeController(makeConfig({ KAYPAL_MCP_TOKEN: 'tok' }));
    expect(
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'tok' } }),
      ),
    ).toBe('full');
  });

  it('只读 token 匹配返回 readonly', () => {
    const controller = makeController(
      makeConfig({
        KAYPAL_MCP_TOKEN: 'tok',
        KAYPAL_MCP_READONLY_TOKEN: 'ro',
      }),
    );
    expect(
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'ro' } }),
      ),
    ).toBe('readonly');
  });

  it('token 不匹配抛 401', () => {
    const controller = makeController(makeConfig({ KAYPAL_MCP_TOKEN: 'tok' }));
    expect(() =>
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'wrong' } }),
      ),
    ).toThrow(HttpException);
    try {
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'wrong' } }),
      );
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }
  });

  it('token 未配置抛 503（而非误放行）', () => {
    const controller = makeController(makeConfig({ KAYPAL_MCP_TOKEN: '' }));
    try {
      controller.checkAuth(makeReq({}));
      throw new Error('应抛异常');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  });

  it('过渡期旧 token（未过期）返回 full', () => {
    const controller = makeController(
      makeConfig({
        KAYPAL_MCP_TOKEN: 'new',
        KAYPAL_MCP_PREVIOUS_TOKEN: 'old',
        KAYPAL_MCP_PREVIOUS_TOKEN_EXPIRES_AT: new Date(
          Date.now() + 3600_000,
        ).toISOString(),
      }),
    );
    expect(
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'old' } }),
      ),
    ).toBe('full');
  });

  it('过渡期旧 token 已过期抛 401', () => {
    const controller = makeController(
      makeConfig({
        KAYPAL_MCP_TOKEN: 'new',
        KAYPAL_MCP_PREVIOUS_TOKEN: 'old',
        KAYPAL_MCP_PREVIOUS_TOKEN_EXPIRES_AT: new Date(
          Date.now() - 3600_000,
        ).toISOString(),
      }),
    );
    try {
      controller.checkAuth(
        makeReq({ headers: { 'x-kaypal-mcp-token': 'old' } }),
      );
      throw new Error('应抛异常');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    }
  });
});

describe('McpController.checkRateLimit', () => {
  it('loopback 不限流', () => {
    const controller = makeController(makeConfig({}));
    for (let i = 0; i < 500; i++) {
      expect(() =>
        controller.checkRateLimit(makeReq({ ip: '127.0.0.1' })),
      ).not.toThrow();
    }
  });

  it('远程客户端窗口内超限抛 429', () => {
    const controller = makeController(makeConfig({}));
    // 300 次内不抛
    for (let i = 0; i < 300; i++) {
      expect(() =>
        controller.checkRateLimit(makeReq({ ip: '10.0.0.5' })),
      ).not.toThrow();
    }
    // 第 301 次触发 429
    try {
      controller.checkRateLimit(makeReq({ ip: '10.0.0.5' }));
      throw new Error('应抛异常');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});

describe('McpController.checkCapability', () => {
  it('只读 token 调敏感工具抛 403', () => {
    const controller = makeController(makeConfig({}));
    const req = makeReq({
      body: { method: 'tools/call', params: { name: 'browser_click' } },
    });
    try {
      controller.checkCapability('readonly', req);
      throw new Error('应抛异常');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  it('只读 token 调只读工具放行', () => {
    const controller = makeController(makeConfig({}));
    expect(() =>
      controller.checkCapability('readonly', makeReq({
        body: { method: 'tools/call', params: { name: 'browser_snapshot' } },
      })),
    ).not.toThrow();
  });

  it('只读 token 调非 tools/call 放行', () => {
    const controller = makeController(makeConfig({}));
    expect(() =>
      controller.checkCapability('readonly', makeReq({
        body: { method: 'tools/list', params: {} },
      })),
    ).not.toThrow();
  });

  it('full / loopback 调敏感工具放行', () => {
    const controller = makeController(makeConfig({}));
    const req = makeReq({
      body: { method: 'tools/call', params: { name: 'browser_click' } },
    });
    expect(() => controller.checkCapability('full', req)).not.toThrow();
    expect(() => controller.checkCapability('loopback', req)).not.toThrow();
  });
});

describe('McpController public status', () => {
  it('redacts local process and filesystem metadata', async () => {
    const playwrightMcp = {
      getAutomationStatus: jest.fn().mockResolvedValue({
        online: true,
        pid: 1234,
        profileDir: '/private/profile',
        endpoint: '/api/mcp/playwright',
        message: 'playwright-mcp sidecar running (pid=1234, profile=shared)',
      }),
    } as unknown as PlaywrightMcpService;
    const mcpRuntime = {
      getStatus: jest.fn().mockReturnValue({
        available: false,
        artifact_root: '/private/evidence',
      }),
    } as unknown as McpRuntimeService;
    const controller = new McpController(
      playwrightMcp,
      mcpRuntime,
      makeConfig({}),
    );
    const result = await controller.getStatus(
      makeReq({ ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } }),
    );
    expect(result.data.playwright).toEqual(
      expect.objectContaining({ online: true, endpoint: '/api/mcp/playwright' }),
    );
    expect(result.data.playwright).not.toHaveProperty('pid');
    expect(result.data.playwright).not.toHaveProperty('profileDir');
    expect(result.data.playwright.message).not.toMatch(/pid=1234|profile=shared/);
    expect(result.data.runtime).not.toHaveProperty('artifact_root');
  });
});

describe('McpController.handlePlaywrightMcp 错误响应', () => {
  function makePlaywrightMock() {
    return { handleRequest: jest.fn().mockResolvedValue(undefined) } as unknown;
  }

  function makeRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as never;
  }

  it('token 不匹配返回 401 + JSON-RPC error', async () => {
    const controller = makeController(makeConfig({ KAYPAL_MCP_TOKEN: 'tok' }));
    const res = makeRes();
    await controller.handlePlaywrightMcp(
      makeReq({ headers: { 'x-kaypal-mcp-token': 'bad' } }),
      res,
    );
    expect((res as never as { status: jest.Mock }).status).toHaveBeenCalledWith(
      401,
    );
    expect((res as never as { json: jest.Mock }).json).toHaveBeenCalledWith(
      expect.objectContaining({ jsonrpc: '2.0', id: null }),
    );
  });

  it('鉴权通过则透传 handleRequest', async () => {
    const config = makeConfig({ KAYPAL_MCP_TOKEN: 'tok' });
    const playwrightMcp = { handleRequest: jest.fn().mockResolvedValue(undefined) } as unknown as PlaywrightMcpService;
    const mcpRuntime = {} as unknown as McpRuntimeService;
    const controller = new McpController(playwrightMcp, mcpRuntime, config);
    const res = makeRes();
    await controller.handlePlaywrightMcp(
      makeReq({ headers: { 'x-kaypal-mcp-token': 'tok' } }),
      res,
    );
    expect(playwrightMcp.handleRequest).toHaveBeenCalled();
  });
});
