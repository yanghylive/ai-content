import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService browser account status', () => {
  function makeService(
    account: Record<string, unknown>,
    session: Record<string, unknown>,
  ) {
    const listAccounts = jest.fn().mockResolvedValue([account]);
    return new LocalEngineService(
      {} as any,
      {
        getHealth: jest.fn().mockResolvedValue({
          online: true,
          service: 'ai-content local browser runtime',
          version: '0.1.0',
        }),
        listAccounts,
        getCdpSessions: jest.fn().mockResolvedValue({
          sessions: [session],
        }),
      } as any,
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

  function makeServiceWithApi(
    account: Record<string, unknown>,
    session: Record<string, unknown>,
  ) {
    const listAccounts = jest.fn().mockResolvedValue([account]);
    const service = makeService(account, session) as LocalEngineService & {
      autoUploadService: { listAccounts: jest.Mock };
    };
    service.autoUploadService.listAccounts = listAccounts;
    return { service, listAccounts };
  }

  it('does not count a persisted profile as ready until CDP reaches a platform backend page', async () => {
    const service = makeService(
      {
        id: 1,
        platform: '抖音',
        type: 3,
        profileName: '测试抖音',
        status: 1,
        statusLabel: '已登录',
        filePath: 'douyin.json',
      },
      {
        platform: 'douyin',
        accountId: 1,
        status: 'unknown',
        activeProfile: true,
      },
    );

    const status = await service.getBrowserStatus();

    expect(status.readyAccounts).toBe(0);
    expect(status.accounts[0]).toEqual(
      expect.objectContaining({
        status: 'unverified',
        statusLabel: '待确认登录',
        nextAction: '请打开 抖音 后台，等待页面进入平台管理后台后刷新。',
      }),
    );
    expect(status.recovery.nextAction).toContain('待确认登录');
  });

  it('counts a platform account as ready after CDP confirms the platform backend page', async () => {
    const service = makeService(
      {
        id: 1,
        platform: '抖音',
        type: 3,
        profileName: '测试抖音',
        status: 1,
        statusLabel: '已登录',
        filePath: 'douyin.json',
      },
      {
        platform: 'douyin',
        accountId: 1,
        status: 'ready',
        currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        activeProfile: true,
      },
    );

    const status = await service.getBrowserStatus();

    expect(status.readyAccounts).toBe(1);
    expect(status.accounts[0]).toEqual(
      expect.objectContaining({
        status: 'ready',
        statusLabel: '已登录',
        currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
      }),
    );
  });

  it('refreshes account validation so a logged-in WeChat Channel backend page becomes ready after restart', async () => {
    const { service, listAccounts } = makeServiceWithApi(
      {
        id: 4,
        platform: '视频号',
        type: 2,
        profileName: '测试视频号',
        status: 1,
        statusLabel: '已登录',
        filePath: 'wechat-channel.json',
      },
      {
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl: 'https://channels.weixin.qq.com/platform/private_msg',
        activeProfile: true,
      },
    );

    const status = await service.getBrowserStatus();

    // 高频轮询接口不触发账号验证（validate 会打开浏览器+带到前台导致窗口乱跳），
    // 状态由 CDP 会话映射（只读）提供 —— 见 75b0a3f「窗口乱跳修复」
    expect(listAccounts).toHaveBeenCalledWith();
    expect(status.readyAccounts).toBe(1);
    expect(status.accounts[0]).toEqual(
      expect.objectContaining({
        status: 'ready',
        statusLabel: '已登录',
        currentUrl: 'https://channels.weixin.qq.com/platform/private_msg',
      }),
    );
  });

  it('keeps browser engine online when the platform account table is missing', async () => {
    const service = new LocalEngineService(
      {} as any,
      {
        getHealth: jest.fn().mockResolvedValue({
          online: true,
          service: 'ai-content local browser runtime',
          version: '0.1.0',
        }),
        listAccounts: jest
          .fn()
          .mockRejectedValue(
            new Error(
              'Invalid `prisma.publishAccount.findMany()` invocation: The table `main.publish_accounts` does not exist in the current database.',
            ),
          ),
        getCdpSessions: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const status = await service.getBrowserStatus();

    expect(status.engineOnline).toBe(true);
    expect(status.readyAccounts).toBe(0);
    expect(status.engineMessage).toContain('平台账号表正在自修复');
    expect(status.recovery.nextAction).toContain('微信桌面任务可继续');
  });
});
