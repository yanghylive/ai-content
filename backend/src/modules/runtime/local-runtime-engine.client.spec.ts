import { ServiceUnavailableException } from '@nestjs/common';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import type { LocalInteractionEngineClient } from '../local-engine/local-interaction-engine.client';

function makeInProcessMock(overrides: Partial<LocalInteractionEngineClient> = {}) {
  return {
    getEngineUrl: jest
      .fn()
      .mockReturnValue('internal://ai-content/local-interaction'),
    getHealth: jest.fn().mockResolvedValue({
      online: true,
      status: 'ok',
      service: 'ai-content-local-interaction',
      version: 'test',
      engineUrl: 'internal://ai-content/local-interaction',
      checkedAt: '2026-06-04T00:00:00.000Z',
    }),
    preflightCheck: jest.fn().mockResolvedValue({
      ok: true,
      platform: 'douyin',
      accountId: 1,
      browserReady: true,
      profileReady: true,
      loginRequired: false,
      blockers: [],
      message: '可以开始执行互动任务',
      nextAction: '可以开始执行互动任务',
    }),
    listCdpSessions: jest.fn().mockResolvedValue([
      {
        index: 0,
        browser: 'in-process Chrome',
        status: 'active',
      },
    ]),
    ...overrides,
  } as unknown as jest.Mocked<LocalInteractionEngineClient>;
}

describe('LocalRuntimeEngineClient', () => {
  it('returns the in-process runtime URL from LocalInteractionEngineClient', () => {
    const inProcess = makeInProcessMock();
    const client = new LocalRuntimeEngineClient(inProcess);

    expect(client.getEngineUrl()).toBe('internal://ai-content/local-interaction');
    expect(inProcess.getEngineUrl).toHaveBeenCalledTimes(1);
  });

  it('delegates health checks to the 3011 in-process runtime', async () => {
    const inProcess = makeInProcessMock();
    const client = new LocalRuntimeEngineClient(inProcess);

    const result = await client.getHealth();

    expect(result).toMatchObject({
      online: true,
      status: 'ok',
      service: 'ai-content-local-interaction',
      engineUrl: 'internal://ai-content/local-interaction',
    });
    expect(inProcess.getHealth).toHaveBeenCalledTimes(1);
  });

  it('wraps health errors with a readable 3011 runtime failure', async () => {
    const inProcess = makeInProcessMock({
      getHealth: jest.fn().mockRejectedValue(new Error('browser profile locked')),
    } as Partial<LocalInteractionEngineClient>);
    const client = new LocalRuntimeEngineClient(inProcess);

    await expect(client.getHealth()).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(client.getHealth()).rejects.toThrow(
      /本地 in-process 互动引擎未就绪：browser profile locked/,
    );
  });

  it('delegates platform preflight checks without HTTP fallback', async () => {
    const inProcess = makeInProcessMock();
    const client = new LocalRuntimeEngineClient(inProcess);

    const result = await client.preflightCheck({
      platform: 'douyin',
      accountId: 'account-1',
    });

    expect(result.ok).toBe(true);
    expect(inProcess.preflightCheck).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 'account-1',
    });
  });

  it('delegates CDP session listing to the in-process runtime', async () => {
    const inProcess = makeInProcessMock();
    const client = new LocalRuntimeEngineClient(inProcess);

    const result = await client.listCdpSessions();

    expect(result).toEqual([
      {
        index: 0,
        browser: 'in-process Chrome',
        status: 'active',
      },
    ]);
    expect(inProcess.listCdpSessions).toHaveBeenCalledTimes(1);
  });

  it('rejects legacy postJson calls instead of reviving the old HTTP engine', async () => {
    const inProcess = makeInProcessMock();
    const client = new LocalRuntimeEngineClient(inProcess);

    await expect(client.postJson('/interaction/douyin/comments/send', {})).rejects.toThrow(
      /postJson 已废弃：5409 引擎已下线/,
    );
  });
});
