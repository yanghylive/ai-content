import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService runtime status', () => {
  function makeService() {
    return new LocalEngineService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('retries frontend HTTP probes before marking the runtime offline', async () => {
    const service = makeService() as LocalEngineService & {
      inspectRuntimeService: (
        service: Record<string, unknown>,
        sessions: Set<string>,
      ) => Promise<Record<string, unknown>>;
      checkTcpPort: jest.Mock;
    };
    service.checkTcpPort = jest.fn().mockResolvedValue({
      open: true,
      message: '端口 3010 可连接',
      pid: null,
    });

    const fetchMock = jest
      .spyOn(globalThis, 'fetch' as never)
      .mockRejectedValueOnce(
        new Error('The operation was aborted due to timeout'),
      )
      .mockRejectedValueOnce(
        new Error('The operation was aborted due to timeout'),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    try {
      const runtime = await service.inspectRuntimeService(
        {
          key: 'frontend',
          name: '主系统前端',
          url: 'http://localhost:3010/login',
          port: 3010,
          screenSession: 'ai-content-frontend',
          logPath: '/tmp/frontend.log',
        },
        new Set(['ai-content-frontend']),
      );

      expect(runtime.online).toBe(true);
      expect(runtime.message).toContain('在线');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
