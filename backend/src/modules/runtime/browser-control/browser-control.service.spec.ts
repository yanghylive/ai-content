import { BrowserControlService } from './browser-control.service';
import {
  LocalRuntimeEngineClient,
  type LocalRuntimeEngineHealth,
  type LocalRuntimePreflightResult,
} from '../local-runtime-engine.client';

function makeEngineMock(
  overrides: {
    preflightResult?: Partial<LocalRuntimePreflightResult>;
    healthReachable?: boolean;
    sessions?: Array<{
      platform: string;
      accountId: string | number;
      status: string;
      profileDir?: string;
      debuggingPort?: number;
    }>;
  } = {},
): LocalRuntimeEngineClient {
  const preflightResult: LocalRuntimePreflightResult = {
    ok: true,
    platform: 'douyin',
    accountId: 1,
    browserReady: true,
    profileReady: true,
    loginRequired: false,
    blockers: [],
    message: 'preflight ok',
    nextAction: 'go',
    ...overrides.preflightResult,
  };
  const healthReachable = overrides.healthReachable ?? true;

  return {
    getEngineUrl: jest
      .fn()
      .mockReturnValue('internal://ai-content/local-interaction'),
    getHealth: jest.fn().mockImplementation(() => {
      if (healthReachable) {
        const result: LocalRuntimeEngineHealth = {
          online: true,
          status: 'ok',
          service: 'local-runtime',
          version: '1.0.0',
          engineUrl: 'internal://ai-content/local-interaction',
          checkedAt: new Date().toISOString(),
        };
        return Promise.resolve(result);
      }
      return Promise.reject(new Error('engine down'));
    }),
    preflightCheck: jest.fn().mockResolvedValue(preflightResult),
    listCdpSessions: jest.fn().mockReturnValue(overrides.sessions ?? []),
  } as unknown as LocalRuntimeEngineClient;
}

describe('BrowserControlService', () => {
  describe('preflight', () => {
    it('preflight 通过 → ok=true + checkedAt 填好', async () => {
      const engine = makeEngineMock();
      const service = new BrowserControlService(engine);

      const result = await service.preflight('douyin', 1);

      expect(result.ok).toBe(true);
      expect(result.platform).toBe('douyin');
      expect(result.accountId).toBe('1');
      expect(result.checkedAt).toBeTruthy();
      expect(engine.preflightCheck).toHaveBeenCalledWith({
        platform: 'douyin',
        accountId: 1,
      });
    });

    it('preflight 失败 → ok=false + blockers 透传', async () => {
      const engine = makeEngineMock({
        preflightResult: {
          ok: false,
          platform: 'douyin',
          accountId: 1,
          browserReady: false,
          profileReady: false,
          loginRequired: false,
          blockers: ['CDP 浏览器未就绪', 'profile 目录不存在'],
          message: '预检未通过',
        },
      });
      const service = new BrowserControlService(engine);

      const result = await service.preflight('douyin', 1);

      expect(result.ok).toBe(false);
      expect(result.blockers).toHaveLength(2);
      expect(result.message).toBe('预检未通过');
    });

    it('preflight 引擎异常 → ok=false + blockers 含错误信息', async () => {
      const engine = makeEngineMock();
      (engine.preflightCheck as jest.Mock).mockResolvedValueOnce({
        ok: false,
        platform: 'wechat-channel',
        accountId: 99,
        browserReady: false,
        profileReady: false,
        loginRequired: false,
        blockers: ['引擎不可访问：fetch failed'],
        message: '预检失败：引擎不可访问：fetch failed',
      });
      const service = new BrowserControlService(engine);

      const result = await service.preflight('wechat-channel', 99);

      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain('引擎不可访问');
    });
  });

  describe('getStatus', () => {
    it('引擎可达 + 有 session → engineOnline=true + session 填好', async () => {
      const engine = makeEngineMock({
        sessions: [
          {
            platform: 'douyin',
            accountId: 1,
            status: 'ready',
            profileDir: '/tmp/dy',
            debuggingPort: 9222,
          },
        ],
      });
      const service = new BrowserControlService(engine);

      const result = await service.getStatus('douyin', 1);

      expect(result.engineOnline).toBe(true);
      expect(result.session).not.toBeNull();
      expect(result.session?.status).toBe('ready');
      expect(result.message).toContain('ready');
    });

    it('引擎可达但无 session → engineOnline=true + session=null', async () => {
      const engine = makeEngineMock({ sessions: [] });
      const service = new BrowserControlService(engine);

      const result = await service.getStatus('douyin', 1);

      expect(result.engineOnline).toBe(true);
      expect(result.session).toBeNull();
      expect(result.message).toContain('未启动');
    });

    it('引擎不可达 → engineOnline=false + 不抛', async () => {
      const engine = makeEngineMock({ healthReachable: false });
      const service = new BrowserControlService(engine);

      const result = await service.getStatus('douyin', 1);

      expect(result.engineOnline).toBe(false);
      expect(result.session).toBeNull();
      expect(result.message).toContain('不可达');
    });

    it('listCdpSessions 抛错 → 优雅降级 session=null', async () => {
      const engine = makeEngineMock({ healthReachable: true });
      // listCdpSessions 是同步方法：同步抛错（mockRejectedValueOnce 会产生无人 await 的 rejected promise 导致进程崩溃）
      (engine.listCdpSessions as jest.Mock).mockImplementationOnce(() => {
        throw new Error('cdp query failed');
      });
      const service = new BrowserControlService(engine);

      const result = await service.getStatus('douyin', 1);

      expect(result.engineOnline).toBe(true);
      expect(result.session).toBeNull();
    });
  });
});
