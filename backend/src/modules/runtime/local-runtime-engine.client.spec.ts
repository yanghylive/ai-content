import { ConfigService } from '@nestjs/config';
import {
  LocalRuntimeEngineClient,
  type LocalRuntimePreflightInput,
} from './local-runtime-engine.client';

function makeConfigService(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => overrides[key]),
  } as unknown as ConfigService;
}

describe('LocalRuntimeEngineClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getEngineUrl', () => {
    it('无配置时返空 (5409 已下线, 需显式设 AUTO_UPLOAD_ENGINE_URL)', () => {
      const client = new LocalRuntimeEngineClient(makeConfigService());
      expect(client.getEngineUrl()).toBe('');
    });

    it('读 AUTO_UPLOAD_ENGINE_URL 配置', () => {
      const client = new LocalRuntimeEngineClient(
        makeConfigService({ AUTO_UPLOAD_ENGINE_URL: 'http://127.0.0.1:6500/' }),
      );
      expect(client.getEngineUrl()).toBe('http://127.0.0.1:6500');
    });

    it('末尾单个斜杠会被剥掉', () => {
      const client = new LocalRuntimeEngineClient(
        makeConfigService({ AUTO_UPLOAD_ENGINE_URL: 'http://h:6500/' }),
      );
      expect(client.getEngineUrl()).toBe('http://h:6500');
    });
  });

  describe('getHealth', () => {
    it('200 + 完整字段 → 返 online=true', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: 'ok',
            service: 'local-runtime',
            version: '1.0.0',
          }),
      } as unknown as Response);

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.getHealth();

      expect(result.online).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.version).toBe('1.0.0');
      expect(result.engineUrl).toBe('http://127.0.0.1:5409'); // 测试用旧 URL, 行为不依赖 5409 是否启
    });

    it('500 → 抛 ServiceUnavailableException', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      } as unknown as Response);

      const client = new LocalRuntimeEngineClient(makeConfigService());
      await expect(client.getHealth()).rejects.toThrow(
        /Engine health failed: 500/,
      );
    });

    it('网络异常 → 抛 ServiceUnavailableException 含 err 信息', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5409'));

      const client = new LocalRuntimeEngineClient(makeConfigService());
      await expect(client.getHealth()).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('preflightCheck', () => {
    it('正常响应 → 解析为结构化结果', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            platform: 'douyin',
            accountId: 1,
            browserReady: true,
            profileReady: true,
            loginRequired: false,
            blockers: [],
            message: 'ok',
          }),
      } as unknown as Response);

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.preflightCheck({
        platform: 'douyin',
        accountId: 1,
      } as LocalRuntimePreflightInput);

      expect(result.ok).toBe(true);
      expect(result.platform).toBe('douyin');
      expect(result.accountId).toBe(1);
      expect(result.blockers).toEqual([]);
    });

    it('HTTP 非 200 → 返 ok=false + blockers 含状态码', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      } as unknown as Response);

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.preflightCheck({
        platform: 'douyin',
        accountId: 1,
      });

      expect(result.ok).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers[0]).toContain('503');
    });

    it('网络异常 → 返 ok=false 不抛', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.preflightCheck({
        platform: 'wechat-channel',
        accountId: 42,
      });

      expect(result.ok).toBe(false);
      expect(result.blockers[0]).toContain('引擎不可访问');
      expect(result.nextAction).toContain('5409');
    });
  });

  describe('listCdpSessions', () => {
    it('正常返 sessions 数组', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sessions: [
              { platform: 'douyin', accountId: 1, status: 'ready' },
            ],
          }),
      } as unknown as Response);

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.listCdpSessions();

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe('douyin');
    });

    it('网络异常 → 返空数组不抛', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('net down'));

      const client = new LocalRuntimeEngineClient(makeConfigService());
      const result = await client.listCdpSessions();

      expect(result).toEqual([]);
    });
  });
});
