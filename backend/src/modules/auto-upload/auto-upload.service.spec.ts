import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutoUploadService } from './auto-upload.service';
import type { AutoUploadPublishPayload } from './auto-upload.client';

function articleIdentity(id: string, title: string, body: string) {
  return {
    articleId: id,
    body,
    sourceIdentity: {
      sourceType: 'article' as const,
      sourceId: id,
      title,
      contentType: 'article',
      contentFormat: 'markdown',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  };
}

describe('AutoUploadService', () => {
  let tempDir: string;
  let client: {
    getHealth: jest.Mock;
    getCdpSessions: jest.Mock;
    listAccounts: jest.Mock;
    openAccounts: jest.Mock;
    listTasks: jest.Mock;
    publishBatch: jest.Mock;
    deleteAccount: jest.Mock;
    deleteMaterial: jest.Mock;
    cleanupInteractionEvidence: jest.Mock;
  };
  let systemLogsService: { record: jest.Mock };
  let riskPolicyService: {
    issueHighRiskApproval: jest.Mock;
    consumeHighRiskApproval: jest.Mock;
  };
  let runtimeRows: Array<Record<string, any>>;
  let prisma: {
    tenantMember: { findFirst: jest.Mock };
    article?: { findFirst: jest.Mock };
    runtimeExecution: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: AutoUploadService;
  const publishApproval = () => ({
    confirmationId: 'publish-confirmation-1',
    context: {
      accountId: 'user-1',
      accountName: '测试用户',
      deviceId: 'session-1',
    },
  });
  const retryApproval = () => ({
    confirmationId: 'retry-publish-confirmation-1',
    context: publishApproval().context,
  });
  const resumeApproval = () => ({
    confirmationId: 'resume-blocked-publish-confirmation-1',
    context: publishApproval().context,
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auto-upload-service-'));
    client = {
      getHealth: jest.fn().mockResolvedValue({
        online: true,
        status: 'ok',
        service: 'auto-upload',
        version: 'test',
        engineUrl: 'internal://ai-content/local-interaction',
        checkedAt: '2026-05-30T00:00:00.000Z',
      }),
      getCdpSessions: jest.fn().mockResolvedValue({
        available: true,
        checkedAt: '2026-06-08T00:00:00.000Z',
        sessions: [],
      }),
      listAccounts: jest.fn(),
      openAccounts: jest.fn(),
      listTasks: jest.fn(),
      publishBatch: jest.fn(),
      deleteAccount: jest.fn().mockResolvedValue({ deleted: true }),
      deleteMaterial: jest.fn().mockResolvedValue({ deleted: true }),
      cleanupInteractionEvidence: jest.fn().mockResolvedValue({ deleted: 3 }),
    };
    systemLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    riskPolicyService = {
      issueHighRiskApproval: jest.fn().mockImplementation(async (input) => ({
        confirmationId: `${input.action}-confirmation-1`,
        expiresAt: '2026-07-12T21:00:00.000Z',
        singleUse: true,
      })),
      consumeHighRiskApproval: jest.fn().mockImplementation(async (input) => {
        if (input.confirmationId !== `${input.action}-confirmation-1`) {
          throw new Error('高风险确认不存在、已使用或不匹配');
        }
        return {
          confirmed: true,
          confirmationId: input.confirmationId,
          confirmedAction: input.action,
          confirmedRiskLevel: 'high',
          operator: '测试用户',
          confirmedAt: '2026-07-12T20:00:00.000Z',
        };
      }),
    };
    runtimeRows = [];
    let rowSequence = 0;
    const matchesWhere = (
      row: Record<string, any>,
      where: Record<string, any> = {},
    ) => Object.entries(where).every(([key, value]) => row[key] === value);
    prisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
      },
      runtimeExecution: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          return runtimeRows.find((row) => matchesWhere(row, where)) || null;
        }),
        findMany: jest.fn().mockImplementation(async ({ where, take }) => {
          return runtimeRows
            .filter((row) => matchesWhere(row, where))
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime(),
            )
            .slice(0, take);
        }),
        create: jest.fn().mockImplementation(async ({ data }) => {
          const row = {
            id: `runtime-publish-${++rowSequence}`,
            ...data,
            createdAt: data.createdAt || new Date(),
          };
          runtimeRows.push(row);
          return row;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const row = runtimeRows.find((item) => item.id === where.id);
          if (!row) throw new Error('runtime publish record not found');
          Object.assign(row, data);
          return row;
        }),
        delete: jest.fn().mockImplementation(async ({ where }) => {
          const index = runtimeRows.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('runtime publish record not found');
          return runtimeRows.splice(index, 1)[0];
        }),
      },
    };
    const authContext = {
      hasContext: () => true,
      get: () => ({ user: { id: 'user-1' } }),
      resolveTenantId: async () => 'tenant-1',
    } as any;
    service = new AutoUploadService(
      client as any,
      prisma as any,
      systemLogsService as any,
      undefined,
      undefined,
      authContext,
      riskPolicyService as any,
    );
    jest
      .spyOn(service as any, 'publishPayloadStorePath')
      .mockReturnValue(join(tempDir, 'auto-upload-publish-payloads.json'));
    jest
      .spyOn(service as any, 'publishBatchResultStorePath')
      .mockReturnValue(join(tempDir, 'auto-upload-batch-results.json'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  const createFailedPublishRecord = async (suffix: string) => {
    const materialPath = join(tempDir, `${suffix}.mp4`);
    const accountPath = join(tempDir, `${suffix}-account.json`);
    await writeFile(materialPath, `video-${suffix}`);
    await writeFile(accountPath, `account-${suffix}`);
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: `失败发布-${suffix}`,
      contentKind: 'video',
      ...articleIdentity(
        `article-${suffix}`,
        `失败发布-${suffix}`,
        `正文-${suffix}`,
      ),
      tags: ['门店'],
      fileList: [materialPath],
      accountList: [accountPath],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: accountPath,
        userName: `douyin-${suffix}`,
        profileName: `门店抖音-${suffix}`,
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValueOnce({
      taskIds: [100],
      results: [{ type: 3, ok: false, message: '账号登录失效' }],
    });
    const firstRun = await service.publishBatch([payload], publishApproval());
    return { firstRun, payload, materialPath, accountPath };
  };

  it('uses current 3011 browser session status before historical runtime failures', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-06-08T00:00:00.000Z',
      sessions: [
        {
          platform: 'douyin',
          accountId: 1,
          status: 'ready',
        },
      ],
    });
    const prisma = {
      runtimeExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            platform: 'douyin',
            ok: false,
            reasonCode: 'account_not_logged_in',
            userMessage: '之前未登录',
            createdAt: new Date('2026-06-07T23:00:00.000Z'),
          },
        ]),
      },
    };
    service = new AutoUploadService(
      client as any,
      prisma as any,
      systemLogsService as any,
    );

    const accounts = await service.listAccounts();

    expect(accounts[0]).toEqual(
      expect.objectContaining({
        sessionStatus: 'logged_in',
        lastDispatchOk: true,
        lastDispatchReason: 'browser_session_ready',
      }),
    );
  });

  it('uses a current ready browser session to replace stale expired account state', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 4,
        type: 2,
        platform: '视频号',
        filePath: '/accounts/wechat-channel.json',
        userName: 'wechat-channel-user',
        profileName: '视频号',
        status: 0,
        statusLabel: '需要重新登录',
      },
    ]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-06-21T00:23:56.000Z',
      sessions: [
        {
          platform: 'wechat-channel',
          accountId: 4,
          status: 'ready',
          currentUrl: 'https://channels.weixin.qq.com/',
        },
      ],
    });
    const prisma = {
      runtimeExecution: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new AutoUploadService(
      client as any,
      prisma as any,
      systemLogsService as any,
    );

    const accounts = await service.listAccounts({
      validate: true,
      force: true,
    });

    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 1,
        statusLabel: '已登录',
        sessionStatus: 'logged_in',
        lastDispatchOk: true,
        lastDispatchReason: 'browser_session_ready',
      }),
    );
  });

  it('keeps current session status isolated between same-platform accounts', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin-a.json',
        userName: 'douyin-a',
        status: 1,
        statusLabel: '已登录',
      },
      {
        id: 2,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin-b.json',
        userName: 'douyin-b',
        status: 1,
        statusLabel: '已登录',
      },
    ]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-08-02T00:00:00.000Z',
      sessions: [
        { platform: 'douyin', accountId: 1, status: 'ready' },
        { platform: 'douyin', accountId: 2, status: 'needs_login' },
      ],
    });

    const accounts = await service.listAccounts();

    expect(accounts).toEqual([
      expect.objectContaining({ id: 1, sessionStatus: 'logged_in', status: 1 }),
      expect.objectContaining({
        id: 2,
        sessionStatus: 'needs_login',
        status: 0,
      }),
    ]);
  });

  it('deduplicates restored rows that share one platform account id', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 3,
        stableId: 'restored-old-3',
        type: 3,
        platform: '抖音',
        platformKey: 'douyin',
        filePath: '/accounts/douyin-3.json',
        userName: '大壮',
        status: 0,
        statusLabel: '需要重新登录',
      },
      {
        id: 3,
        stableId: 'restored-current-3',
        type: 3,
        platform: '抖音',
        platformKey: 'douyin',
        filePath: '/accounts/douyin-3.json',
        userName: '大壮',
        status: 1,
        statusLabel: '已登录',
      },
    ]);

    const accounts = await service.listAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toEqual(
      expect.objectContaining({ id: 3, stableId: 'restored-current-3' }),
    );
  });

  it('does not report relogin ready when the opened platform page is still a login page', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 4,
        type: 2,
        platform: '视频号',
        filePath: '/accounts/wechat-channel.json',
        userName: 'wechat-channel-user',
        profileName: '视频号',
        status: 1,
        statusLabel: '已配置',
      },
    ]);
    client.openAccounts = jest.fn().mockResolvedValue({
      opened: 1,
      openedIds: [4],
      openedAccounts: [
        {
          id: 'publish-account-wechat-channel',
          platform: 'wechat-channel',
          accountId: 4,
          status: 'needs_login',
          currentUrl: 'https://channels.weixin.qq.com/login.html',
          lastError: '平台页面要求重新登录',
        },
      ],
      skipped: [],
    });
    client.listTasks.mockResolvedValue([]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-06-08T00:00:00.000Z',
      sessions: [
        {
          platform: 'wechat-channel',
          accountId: 4,
          status: 'needs_login',
          currentUrl: 'https://channels.weixin.qq.com/login.html',
        },
      ],
    });

    const result = await service.prepareAccountRelogin(4);

    expect(result.account).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
        status: 'expired',
        statusLabel: '需要登录',
      }),
    );
    expect(result.nextAction).toContain('完成扫码或登录');
  });

  it('prefers the freshly opened login-page result over stale ready CDP session during relogin', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 4,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '抖音',
        status: 1,
        statusLabel: '已登录',
      },
    ]);
    client.openAccounts = jest.fn().mockResolvedValue({
      opened: 1,
      openedIds: [4],
      openedAccounts: [
        {
          id: 'publish-account-douyin',
          platform: 'douyin',
          accountId: 4,
          status: 'needs_login',
          currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
          lastError: '平台页面要求重新登录',
        },
      ],
      skipped: [],
    });
    client.listTasks.mockResolvedValue([]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-06-20T00:00:00.000Z',
      sessions: [
        {
          platform: 'douyin',
          accountId: 4,
          status: 'ready',
          currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        },
      ],
    });

    const result = await service.prepareAccountRelogin(4, {
      platform: 'douyin',
    });

    expect(result.account).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '抖音',
        status: 'expired',
        statusLabel: '需要登录',
      }),
    );
    expect(result.nextAction).toContain('平台页面要求重新登录');
  });

  it('opens the requested platform when engine account ids overlap', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 4,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '抖音',
        status: 0,
        statusLabel: '需要登录',
      },
      {
        id: 4,
        type: 2,
        platform: '视频号',
        filePath: '/accounts/wechat-channel.json',
        userName: 'wechat-channel-user',
        profileName: '视频号',
        status: 0,
        statusLabel: '需要登录',
      },
    ]);
    client.openAccounts = jest.fn().mockResolvedValue({
      opened: 1,
      openedIds: [4],
      skipped: [],
    });
    client.listTasks.mockResolvedValue([]);
    client.getCdpSessions.mockResolvedValue({
      available: true,
      checkedAt: '2026-06-08T00:00:00.000Z',
      sessions: [
        {
          platform: 'wechat-channel',
          accountId: 4,
          status: 'needs_login',
          currentUrl: 'https://channels.weixin.qq.com/login.html',
        },
      ],
    });

    const result = await service.prepareAccountRelogin(4, {
      platform: 'wechat-channel',
    });

    expect(client.openAccounts).toHaveBeenCalledWith([4], {
      platform: 'wechat-channel',
    });
    expect(result.account).toEqual(
      expect.objectContaining({
        id: 4,
        platform: '视频号',
      }),
    );
  });

  it('stores payloads on a durable publish record and restores them when retrying', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    const coverPath = join(tempDir, 'default.jpg');
    const wideCoverPath = join(tempDir, 'wide.jpg');
    await writeFile(materialPath, 'video');
    await writeFile(coverPath, 'cover');
    await writeFile(wideCoverPath, 'cover');
    const originalPayload: AutoUploadPublishPayload = {
      type: 5,
      title: '原始 B 站视频',
      contentKind: 'video',
      tags: ['到店', '护理'],
      fileList: [materialPath],
      accountList: ['/accounts/bili.json'],
      enableTimer: 1,
      videosPerDay: 2,
      dailyTimes: ['10:00', '16:00'],
      startDays: 1,
      timeJitterMinutes: 5,
      scheduleTime: '2026-05-31 10:00',
      debugDryRun: true,
      debugDryRunHoldBrowser: true,
      category: 0,
      coverPath,
      coverPaths: { '16:9': wideCoverPath },
      biliTitle: 'B站专用标题',
      biliDesc: 'B站简介',
      biliType: '自制',
      biliPartition: '生活',
    };

    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 5,
        platform: 'B站',
        filePath: '/accounts/bili.json',
        userName: 'bili-user',
        profileName: '门店 B站',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch
      .mockResolvedValueOnce({
        taskIds: [101],
        results: [{ type: 5, ok: false, message: '平台发布失败' }],
      })
      .mockResolvedValueOnce({
        taskIds: [202],
        results: [
          {
            type: 5,
            ok: true,
            publishUrl: 'https://member.bilibili.com/platform/content/202',
            evidence: {
              source: 'readback',
              readbackOk: true,
              readback: { matched: true },
            },
          },
        ],
      });

    const firstRun = await service.publishBatch(
      [originalPayload],
      publishApproval(),
    );
    const retry = await service.retryPublishTask(
      firstRun.publishRecordId,
      retryApproval(),
    );

    expect(retry.payloadSource).toBe('recorded');
    expect(retry.riskAudit).toEqual(
      expect.objectContaining({
        action: 'retry-publish',
        riskLevel: 'high',
        status: 'allowed',
        confirmationRecord: expect.objectContaining({
          operator: '测试用户',
          confirmedAction: 'retry-publish',
        }),
      }),
    );
    expect(retry.restoredFields).toEqual(
      expect.arrayContaining([
        '封面设置',
        'B站参数',
        '定时发布',
        '固定发布时间',
      ]),
    );
    expect(client.publishBatch).toHaveBeenLastCalledWith([
      expect.objectContaining({
        title: '原始 B 站视频',
        fileList: [materialPath],
        accountList: ['/accounts/bili.json'],
        coverPath,
        coverPaths: { '16:9': wideCoverPath },
        biliPartition: '生活',
        scheduleTime: '2026-05-31 10:00',
      }),
    ]);
    expect(firstRun.publishRecordId).toBeGreaterThan(0);
    expect(runtimeRows).toHaveLength(2);
    expect(runtimeRows.every((row) => Number(row.relatedId) > 0)).toBe(true);
  });

  it('does not retry a legacy record whose original payload is incomplete', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    await writeFile(
      join(tempDir, 'auto-upload-batch-results.json'),
      JSON.stringify({
        7: {
          platforms: [
            {
              platform: '抖音',
              accountId: '/accounts/douyin.json',
              status: 'failed',
              failureReason: '重试',
            },
          ],
          summary: {
            total: 1,
            success: 0,
            failed: 1,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          recordedAt: '2026-05-30T00:00:00.000Z',
        },
      }),
      'utf8',
    );
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [8],
      results: [{ type: 3, ok: false, message: '仍然失败' }],
    });

    await expect(
      service.retryPublishTask(7, retryApproval()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('素材'),
      }),
    });
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('blocks publish retry when the recovered payload account is expired', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    await writeFile(
      join(tempDir, 'auto-upload-batch-results.json'),
      JSON.stringify({
        7: {
          platforms: [
            {
              platform: '抖音',
              accountId: '/accounts/douyin.json',
              status: 'failed',
            },
          ],
          summary: {
            total: 1,
            success: 0,
            failed: 1,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          payloads: [
            {
              type: 3,
              title: '失败任务',
              contentKind: 'video',
              tags: ['门店'],
              fileList: [materialPath],
              accountList: ['/accounts/douyin.json'],
            },
          ],
          recordedAt: '2026-05-30T00:00:00.000Z',
        },
      }),
      'utf8',
    );
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 0,
        statusLabel: '登录失效',
      },
    ]);

    await expect(
      service.retryPublishTask(7, retryApproval()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('登录态失效或不可用'),
      }),
    });
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('blocks publish and delete actions without backend risk confirmation', async () => {
    client.listTasks.mockResolvedValue([
      {
        id: 7,
        title: '失败任务',
        platform_type: 3,
        platform: '抖音',
        account_file: '/accounts/douyin.json',
        file_list: ['/materials/video.mp4'],
        tags: ['门店'],
        dry_run: false,
        status: 'failed',
        message: '重试',
        result: null,
        created_at: '2026-05-30T00:00:00.000Z',
        updated_at: '2026-05-30T00:00:00.000Z',
      },
    ]);
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);

    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '门店视频',
      contentKind: 'video',
      tags: [],
      fileList: ['/materials/video.mp4'],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };

    await expect(service.publishBatch([payload])).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('一次性确认'),
      }),
    });
    await expect(service.deleteAccount(1)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('后端风控要求人工确认'),
      }),
    });
    expect(client.publishBatch).not.toHaveBeenCalled();
    expect(client.deleteAccount).not.toHaveBeenCalled();
  });

  it('prioritizes the backend risk gate before stale article validation on real publish', async () => {
    const articleFindFirst = jest.fn().mockResolvedValue({
      id: 'article-stale',
      title: '最新文章',
      content: '最新正文',
      finalHtml: null,
      contentType: 'article',
      contentFormat: 'markdown',
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    prisma.article = { findFirst: articleFindFirst };
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '旧文章发布',
      contentKind: 'article',
      tags: [],
      ...articleIdentity('article-stale', '旧文章', '旧正文'),
      fileList: [],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };

    await expect(service.publishBatch([payload])).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('一次性确认'),
      }),
    });
    expect(articleFindFirst).not.toHaveBeenCalled();
    expect(client.listAccounts).not.toHaveBeenCalled();
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('issues a server confirmation bound to the scoped publish batch', async () => {
    const materialPath = join(tempDir, 'confirmation-video.mp4');
    await writeFile(materialPath, 'video-v1');
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '签票批次',
      contentKind: 'video',
      tags: ['门店'],
      fileList: [materialPath],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };

    const result = await service.createPublishConfirmation(
      [payload],
      publishApproval().context,
    );

    expect(result).toEqual(
      expect.objectContaining({ confirmationId: 'publish-confirmation-1' }),
    );
    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'publish',
        riskLevel: 'high',
        target: expect.stringMatching(/^auto-upload-publish:[a-f0-9]{64}$/),
      }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        operator: '测试用户',
      },
    );
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('rejects a client self-reported confirmation without a server ticket', async () => {
    const materialPath = join(tempDir, 'forged-confirmation.mp4');
    await writeFile(materialPath, 'video');
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '伪造确认',
      contentKind: 'video',
      tags: [],
      fileList: [materialPath],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };

    await expect(
      service.publishBatch([payload], {
        context: publishApproval().context,
        confirmation: {
          confirmed: true,
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
        },
      } as any),
    ).rejects.toThrow('高风险确认不存在、已使用或不匹配');
    expect(client.listAccounts).not.toHaveBeenCalled();
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('invalidates a server ticket when the batch or material changes', async () => {
    const materialPath = join(tempDir, 'mutable-video.mp4');
    await writeFile(materialPath, 'video-v1');
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '原始标题',
      contentKind: 'video',
      tags: [],
      fileList: [materialPath],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };
    await service.createPublishConfirmation(
      [payload],
      publishApproval().context,
    );
    const issuedTarget = riskPolicyService.issueHighRiskApproval.mock
      .calls[0][0].target as string;
    riskPolicyService.consumeHighRiskApproval.mockImplementationOnce(
      async (input) => {
        if (input.target !== issuedTarget) {
          throw new Error('高风险确认不存在、已使用或不匹配');
        }
        return { confirmed: true };
      },
    );
    await writeFile(materialPath, 'video-v2');

    await expect(
      service.publishBatch(
        [{ ...payload, title: '签票后修改的标题' }],
        publishApproval(),
      ),
    ).rejects.toThrow('高风险确认不存在、已使用或不匹配');
    expect(client.listAccounts).not.toHaveBeenCalled();
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('cannot reuse a publish ticket for a second platform submission', async () => {
    const materialPath = join(tempDir, 'single-use-video.mp4');
    await writeFile(materialPath, 'video');
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '单次发布',
      contentKind: 'video',
      tags: [],
      fileList: [materialPath],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [501],
      results: [
        {
          type: 3,
          ok: true,
          publishUrl: 'https://www.douyin.com/video/501',
          evidence: {
            source: 'readback',
            readbackOk: true,
            readback: { matched: true },
          },
        },
      ],
    });
    riskPolicyService.consumeHighRiskApproval
      .mockResolvedValueOnce({
        confirmed: true,
        confirmationId: 'publish-confirmation-1',
        confirmedAction: 'publish',
        confirmedRiskLevel: 'high',
      })
      .mockRejectedValueOnce(new Error('高风险确认已被使用，请重新确认'));

    await service.publishBatch([payload], publishApproval());
    await expect(
      service.publishBatch([payload], publishApproval()),
    ).rejects.toThrow('高风险确认已被使用');
    expect(client.publishBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects retry when the material changes immediately after ticket consumption', async () => {
    const { firstRun, materialPath } =
      await createFailedPublishRecord('retry-consume-race');
    riskPolicyService.consumeHighRiskApproval.mockImplementationOnce(
      async (input) => {
        await writeFile(materialPath, 'changed-after-confirmation');
        return {
          confirmed: true,
          confirmationId: input.confirmationId,
          confirmedAction: input.action,
          confirmedRiskLevel: 'high',
          operator: '测试用户',
          confirmedAt: '2026-07-12T20:00:00.000Z',
        };
      },
    );

    await expect(
      service.retryPublishTask(firstRun.publishRecordId!, retryApproval()),
    ).rejects.toThrow('确认后发生变化');
    expect(client.publishBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects blocked-task recovery when material changes after ticket consumption', async () => {
    const { firstRun, materialPath, accountPath } =
      await createFailedPublishRecord('resume-consume-race');
    client.listTasks.mockResolvedValue([
      {
        id: firstRun.publishRecordId!,
        title: '账号阻断发布',
        platform_type: 3,
        platform: '抖音',
        account_file: accountPath,
        file_list: [materialPath],
        tags: ['门店'],
        dry_run: false,
        status: 'failed',
        message: '账号登录失效',
        result: null,
        created_at: '2026-07-12T19:00:00.000Z',
        updated_at: '2026-07-12T19:00:00.000Z',
      },
    ]);
    riskPolicyService.consumeHighRiskApproval.mockImplementationOnce(
      async (input) => {
        await writeFile(materialPath, 'changed-after-resume-confirmation');
        return {
          confirmed: true,
          confirmationId: input.confirmationId,
          confirmedAction: input.action,
          confirmedRiskLevel: 'high',
          operator: '测试用户',
          confirmedAt: '2026-07-12T20:00:00.000Z',
        };
      },
    );

    await expect(
      service.resumeAccountBlockedTasks(1, resumeApproval()),
    ).rejects.toThrow('确认后发生变化');
    expect(client.publishBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a publish ticket when the current tenant changes', async () => {
    const materialPath = join(tempDir, 'cross-tenant-video.mp4');
    await writeFile(materialPath, 'video');
    const payload: AutoUploadPublishPayload = {
      type: 3,
      title: '跨租户阻断',
      contentKind: 'video',
      tags: [],
      fileList: [materialPath],
      accountList: ['/accounts/douyin.json'],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
      category: 0,
    };
    await service.createPublishConfirmation(
      [payload],
      publishApproval().context,
    );
    prisma.tenantMember.findFirst.mockResolvedValue({ tenantId: 'tenant-2' });
    riskPolicyService.consumeHighRiskApproval.mockImplementationOnce(
      async (_input, actor) => {
        if (actor.tenantId !== 'tenant-1' || actor.userId !== 'user-1') {
          throw new Error('高风险确认不存在、已使用或不匹配');
        }
        return { confirmed: true };
      },
    );

    await expect(
      service.publishBatch([payload], {
        confirmationId: 'publish-confirmation-1',
        context: {
          accountId: 'user-2',
          accountName: '其他用户',
          deviceId: 'session-2',
        },
      }),
    ).rejects.toThrow('高风险确认不存在、已使用或不匹配');
    expect(client.listAccounts).not.toHaveBeenCalled();
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('does not require or consume a real publish ticket for dry-run payloads', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    const result = await service.publishBatch([
      {
        type: 3,
        title: '仅检查',
        contentKind: 'video',
        tags: [],
        fileList: ['/missing/dry-run-video.mp4'],
        accountList: ['/accounts/douyin.json'],
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: true,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(result.riskAudit).toEqual(
      expect.objectContaining({ status: 'allowed', riskLevel: 'low' }),
    );
    expect(riskPolicyService.consumeHighRiskApproval).not.toHaveBeenCalled();
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('blocks direct interaction evidence cleanup without backend risk confirmation', async () => {
    await expect(service.cleanupInteractionEvidence(0)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('后端风控要求人工确认'),
      }),
    });
    expect(client.cleanupInteractionEvidence).not.toHaveBeenCalled();
    expect(systemLogsService.record).not.toHaveBeenCalled();
  });

  it('allows interaction evidence cleanup after backend risk confirmation and writes audit evidence', async () => {
    const result = await service.cleanupInteractionEvidence(7, {
      confirmation: {
        confirmed: true,
        confirmedAction: 'local-file-delete',
        confirmedRiskLevel: 'high',
      },
    });

    expect(result.riskAudit).toEqual(
      expect.objectContaining({
        action: 'local-file-delete',
        riskLevel: 'high',
        status: 'allowed',
      }),
    );
    expect(client.cleanupInteractionEvidence).toHaveBeenCalledWith(7);
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('风险审计已确认：清理互动证据'),
      'warning',
    );
  });

  it('allows publish and delete actions after backend risk confirmation', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);

    const publishResult = await service.publishBatch(
      [
        {
          type: 3,
          title: '门店视频',
          contentKind: 'video',
          tags: [],
          fileList: ['/materials/video.mp4'],
          accountList: ['/accounts/douyin.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: false,
          debugDryRunHoldBrowser: false,
          category: 0,
        },
      ],
      publishApproval(),
    );
    expect(publishResult.riskAudit).toEqual(
      expect.objectContaining({
        action: 'publish',
        riskLevel: 'high',
        status: 'allowed',
      }),
    );
    expect(publishResult.summary.materialError).toBe(1);
    const deleteResult = await service.deleteAccount(1, {
      confirmation: {
        confirmed: true,
        confirmedAction: 'platform-account-delete',
        confirmedRiskLevel: 'high',
      },
    });
    expect(deleteResult.riskAudit).toEqual(
      expect.objectContaining({
        action: 'platform-account-delete',
        status: 'allowed',
      }),
    );
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('风险审计已确认：真实发布'),
      'warning',
    );
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('风险审计已确认：删除平台账号'),
      'warning',
    );
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('blocks deleting publish records without backend risk confirmation', async () => {
    await expect(service.deletePublishTask(777)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('后端风控要求人工确认'),
      }),
    });
    expect(systemLogsService.record).not.toHaveBeenCalled();
  });

  it('imports legacy history, deletes the durable record, and leaves the legacy file intact', async () => {
    const storePath = join(tempDir, 'auto-upload-batch-results.json');
    await writeFile(
      storePath,
      JSON.stringify({
        777: {
          platforms: [
            {
              platform: '抖音',
              accountId: '/accounts/douyin.json',
              status: 'failed',
              failureReason: '平台回读失败',
              publishTaskId: '777',
            },
          ],
          summary: {
            total: 1,
            success: 0,
            failed: 1,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          recordedAt: '2026-06-01T00:00:00.000Z',
        },
      }),
      'utf8',
    );

    const result = await service.deletePublishTask(777, {
      confirmation: {
        confirmed: true,
        confirmedAction: 'local-file-delete',
        confirmedRiskLevel: 'high',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 777,
        deletedRecordKey: '777',
        message: '发布记录已删除',
      }),
    );
    const records = JSON.parse(await readFile(storePath, 'utf8'));
    expect(records['777']).toBeDefined();
    expect(runtimeRows).toHaveLength(0);
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('风险审计已确认：删除发布记录'),
      'warning',
    );
  });

  it('uses the same aggregate failure count for stored task status and message', async () => {
    client.listTasks.mockResolvedValue([]);
    await writeFile(
      join(tempDir, 'auto-upload-batch-results.json'),
      JSON.stringify({
        901: {
          platforms: [
            { platform: '抖音', accountId: 'douyin-1', status: 'failed' },
            {
              platform: '视频号',
              accountId: 'wechat-1',
              status: 'account_expired',
            },
            {
              platform: '小红书',
              accountId: 'xiaohongshu-1',
              status: 'material_error',
            },
            {
              platform: '快手',
              accountId: 'kuaishou-1',
              status: 'login_required',
            },
            { platform: 'B站', accountId: 'bilibili-1', status: 'blocked' },
            {
              platform: '知乎',
              accountId: 'zhihu-1',
              status: 'not_integrated',
            },
            {
              platform: '公众号',
              accountId: 'wechat-mp-1',
              status: 'pending_manual',
            },
          ],
          summary: {
            total: 7,
            success: 0,
            failed: 1,
            accountExpired: 1,
            materialError: 1,
            loginRequired: 1,
            pendingManual: 1,
            blocked: 1,
            notIntegrated: 1,
          },
          recordedAt: '2026-07-10T00:00:00.000Z',
        },
      }),
      'utf8',
    );

    const tasks = await service.listTasks(10);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: 901,
        status: 'failed',
        message: '发布结果：成功 0/7，失败 6，待回执 1',
      }),
    );
  });

  it('imports a negative legacy key as a positive durable record id', async () => {
    await writeFile(
      join(tempDir, 'auto-upload-batch-results.json'),
      JSON.stringify({
        '-903': {
          platforms: [
            {
              platform: '抖音',
              accountId: 'douyin-903',
              status: 'failed',
              failureReason: '平台回读失败',
            },
          ],
          summary: {
            total: 1,
            success: 0,
            failed: 1,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          payloads: [
            {
              type: 3,
              title: '门店发布记录',
              tags: [],
              fileList: [],
              accountList: ['douyin-903'],
            },
          ],
          recordedAt: '2026-07-10T00:00:00.000Z',
        },
      }),
      'utf8',
    );

    const tasks = await service.listTasks(10);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({ id: 903, status: 'failed' }),
    );
    expect(tasks.every((task) => task.id > 0)).toBe(true);
    expect(runtimeRows[0]).toEqual(
      expect.objectContaining({
        relatedId: '903',
        technicalMessage: 'legacy:auto-upload-batch:-903',
      }),
    );
  });

  it('keeps only publish-domain records and waits for platform confirmation without readback', async () => {
    client.listTasks.mockResolvedValue([
      {
        id: 301,
        title: '客户跟进',
        platform_type: 0,
        platform: '客户互动',
        account_file: 'customer-1',
        file_list: [],
        tags: ['CUSTOMER_FOLLOW_UP'],
        dry_run: false,
        status: 'completed',
        message: '已完成',
        result: { source: 'interaction_tasks' },
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 302,
        title: '门店视频发布',
        platform_type: 3,
        platform: '抖音',
        account_file: 'douyin-1',
        file_list: ['store-video.mp4'],
        tags: [],
        dry_run: false,
        status: 'queued',
        message: null,
        result: { source: 'platform-publish' },
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
      },
    ]);
    await writeFile(
      join(tempDir, 'auto-upload-batch-results.json'),
      JSON.stringify({
        901: {
          platforms: [
            {
              platform: '抖音',
              accountId: 'douyin-1',
              status: 'success',
              publishTaskId: '901',
            },
          ],
          summary: {
            total: 1,
            success: 1,
            failed: 0,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          payloads: [{ title: '门店发布', tags: [], fileList: [] }],
          recordedAt: '2026-07-10T00:00:00.000Z',
        },
        902: {
          platforms: [
            {
              platform: '抖音',
              accountId: 'douyin-2',
              status: 'success',
              publishUrl: 'https://example.com/publish/902',
            },
          ],
          summary: {
            total: 1,
            success: 1,
            failed: 0,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
          payloads: [
            {
              title: 'commercial-acceptance-publish-902',
              tags: [],
              fileList: [],
            },
          ],
          recordedAt: '2026-07-10T00:00:00.000Z',
        },
        904: {
          source: 'interaction_tasks',
          platforms: [
            {
              platform: '客户互动',
              accountId: 'customer-904',
              status: 'failed',
            },
          ],
          summary: {
            total: 1,
            success: 0,
            failed: 1,
            accountExpired: 0,
            materialError: 0,
            loginRequired: 0,
            pendingManual: 0,
            blocked: 0,
            notIntegrated: 0,
          },
        },
      }),
      'utf8',
    );

    const tasks = await service.listTasks(10);
    const result = await service.getPublishBatchResults(901);

    expect(tasks.map((task) => task.id)).toEqual([901]);
    expect(tasks.map((task) => task.id)).not.toEqual(
      expect.arrayContaining([301, 302, 902, 904]),
    );
    expect(client.listTasks).not.toHaveBeenCalled();
    expect(runtimeRows).toHaveLength(1);
    expect(tasks.find((task) => task.id === 901)).toEqual(
      expect.objectContaining({ status: 'waiting_for_send_confirmation' }),
    );
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'pending_manual',
        failureReason: '等待平台确认',
      }),
    );
  });

  it('does not count queued publish tasks as commercial success without platform evidence', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [44],
      results: [{ type: 3, ok: true, message: '任务创建成功' }],
    });

    const result = await service.publishBatch(
      [
        {
          type: 3,
          title: '门店视频',
          contentKind: 'video',
          tags: [],
          fileList: [materialPath],
          accountList: ['/accounts/douyin.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: false,
          debugDryRunHoldBrowser: false,
          category: 0,
        },
      ],
      publishApproval(),
    );

    expect(result.summary.success).toBe(0);
    expect(result.summary.pendingManual).toBe(1);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'pending_manual',
        publishTaskId: '44',
        failureReason: '任务创建成功',
        nextAction: expect.stringContaining('不会标记为发布成功'),
      }),
    );
  });

  it('does not submit to a platform when the durable record cannot be created', async () => {
    const materialPath = join(tempDir, 'durability-gate.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    prisma.runtimeExecution.create.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      service.publishBatch(
        [
          {
            type: 3,
            title: '持久化门禁',
            contentKind: 'video',
            tags: [],
            fileList: [materialPath],
            accountList: ['/accounts/douyin.json'],
            enableTimer: 0,
            videosPerDay: 1,
            dailyTimes: ['10:00'],
            startDays: 0,
            timeJitterMinutes: 0,
            debugDryRun: false,
            debugDryRunHoldBrowser: false,
            category: 0,
          },
        ],
        publishApproval(),
      ),
    ).rejects.toThrow('database unavailable');
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('persists result identifiers and evidence but keeps the run waiting without matched readback', async () => {
    const materialPath = join(tempDir, 'waiting-video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [46],
      results: [
        {
          type: 3,
          ok: true,
          publishUrl: 'https://www.douyin.com/video/46',
          externalId: 'douyin-video-46',
          evidence: {
            source: 'runtime',
            readbackOk: false,
            readback: { matched: false },
          },
        },
      ],
    });

    const result = await service.publishBatch(
      [
        {
          type: 3,
          title: '等待回读的视频',
          contentKind: 'video',
          tags: [],
          fileList: [materialPath],
          accountList: ['/accounts/douyin.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: false,
          debugDryRunHoldBrowser: false,
          category: 0,
        },
      ],
      publishApproval(),
    );
    const tasks = await service.listTasks(10);

    expect(result.summary.success).toBe(0);
    expect(result.summary.pendingManual).toBe(1);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'pending_manual',
        publishTaskId: '46',
        publishUrl: 'https://www.douyin.com/video/46',
        externalId: 'douyin-video-46',
        evidence: expect.objectContaining({
          raw: expect.objectContaining({ readbackOk: false }),
        }),
      }),
    );
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        id: result.publishRecordId,
        status: 'waiting_for_send_confirmation',
      }),
    );
    expect(runtimeRows[0].readbackJson).toEqual(
      expect.objectContaining({ verified: false }),
    );
    await expect(service.retryPublishTask(46, retryApproval())).rejects.toThrow(
      '发布任务不存在',
    );
    expect(client.publishBatch).toHaveBeenCalledTimes(1);
  });

  it('counts publish success only when the engine returns matched platform readback', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [45],
      results: [
        {
          type: 3,
          ok: true,
          message: '发布成功',
          publishUrl: 'https://www.douyin.com/video/45',
          evidence: {
            source: 'readback',
            readbackOk: true,
            readback: { matched: true },
          },
        },
      ],
    });

    const result = await service.publishBatch(
      [
        {
          type: 3,
          title: '门店视频',
          contentKind: 'video',
          tags: [],
          fileList: [materialPath],
          accountList: ['/accounts/douyin.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: false,
          debugDryRunHoldBrowser: false,
          category: 0,
        },
      ],
      publishApproval(),
    );

    expect(result.summary.success).toBe(1);
    expect(result.summary.pendingManual).toBe(0);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'success',
        publishTaskId: '45',
        publishUrl: 'https://www.douyin.com/video/45',
        evidence: expect.objectContaining({
          source: 'readback',
          publishUrl: 'https://www.douyin.com/video/45',
        }),
      }),
    );
    const publishLog = systemLogsService.record.mock.calls.find(
      ([content]) =>
        typeof content === 'string' &&
        content.includes('风险审计已确认：真实发布'),
    )?.[0] as string | undefined;
    expect(publishLog).toContain('details=');
    const encodedDetails = publishLog?.match(/details=([^）)]+)/)?.[1];
    expect(encodedDetails).toBeTruthy();
    const details = JSON.parse(
      Buffer.from(encodedDetails || '', 'base64url').toString('utf8'),
    );
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'audit-confirmation',
          operator: '测试用户',
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
        }),
        expect.objectContaining({
          type: 'publish-payload',
          platform: '抖音',
          title: '门店视频',
          contentKind: 'video',
          materialCount: 1,
          coverCount: 0,
          tagCount: 0,
          scheduleSummary: '立即发布',
          dryRun: false,
        }),
        expect.objectContaining({
          type: 'publish-preflight',
          ok: true,
          issueCount: 0,
          payloadCount: 1,
          accountCount: 1,
          materialCount: 1,
        }),
        expect.objectContaining({
          type: 'publish-platform',
          platform: '抖音',
          status: 'success',
          statusLabel: '已发布',
          publishTaskId: '45',
          publishUrl: 'https://www.douyin.com/video/45',
          evidenceSource: 'readback',
        }),
      ]),
    );
  });

  it('keeps platform policy refusal as blocked instead of failed', async () => {
    const materialPath = join(tempDir, 'xhs.png');
    await writeFile(materialPath, 'image');
    client.listAccounts.mockResolvedValue([
      {
        id: 2,
        type: 1,
        platform: '小红书',
        filePath: '/accounts/xhs.json',
        userName: 'xhs-user',
        profileName: '门店小红书',
        status: 1,
        statusLabel: '正常',
      },
    ]);
    client.publishBatch.mockResolvedValue({
      taskIds: [],
      results: [
        {
          type: 1,
          ok: false,
          message: '小红书「风控测试」被平台拒绝发布：因违反社区规范禁止发笔记',
          evidence: {
            reasonCode: 'permission_missing',
            status: 'blocked',
            technicalMessage:
              'url=https://creator.xiaohongshu.com/publish/publish',
          },
        },
      ],
    });

    const result = await service.publishBatch(
      [
        {
          type: 1,
          title: '风控测试',
          contentKind: 'article',
          ...articleIdentity('article-risk', '风控测试', '完整正文'),
          tags: [],
          fileList: [materialPath],
          accountList: ['/accounts/xhs.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: false,
          debugDryRunHoldBrowser: false,
          category: 0,
        },
      ],
      publishApproval(),
    );

    expect(result.summary.failed).toBe(0);
    expect(result.summary.blocked).toBe(1);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'blocked',
        nextAction: expect.stringContaining('平台账号权限'),
      }),
    );
  });

  it('blocks publish payloads with skipAccountCheck when no account is selected', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 3,
        title: '门店视频',
        contentKind: 'video',
        tags: [],
        fileList: [materialPath],
        accountList: [],
        skipAccountCheck: true,
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(preflight.ok).toBe(false);
    expect(preflight.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'account_missing',
          message: '抖音 未选择发布账号。',
          nextAction: '请先在发布中心选择已登录账号。',
        }),
      ]),
    );
  });

  it('blocks publish payloads with skipAccountCheck when the selected account is expired', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 0,
        statusLabel: '登录失效',
      },
    ]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 3,
        title: '门店视频',
        contentKind: 'video',
        tags: [],
        fileList: [materialPath],
        accountList: ['/accounts/douyin.json'],
        skipAccountCheck: true,
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(client.listAccounts).toHaveBeenCalledWith({
      validate: true,
      force: true,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'account_expired',
          accountFile: '/accounts/douyin.json',
          nextAction: expect.stringContaining('重新登录 抖音'),
        }),
      ]),
    );
  });

  it('validates only selected account ids when publish payload carries accountIds', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 2,
        type: 1,
        platform: '小红书',
        filePath: 'xhs.json',
        userName: 'xhs-user',
        profileName: '门店小红书',
        status: 1,
        statusLabel: '已登录',
      },
    ]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 1,
        accountIds: [2],
        title: '门店视频',
        contentKind: 'video',
        tags: [],
        fileList: [materialPath],
        accountList: ['xhs.json'],
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(client.listAccounts).toHaveBeenCalledWith({
      validate: true,
      force: true,
      ids: [2],
    });
    expect(preflight.ok).toBe(true);
  });

  it('reports platform account material and stage details for commercial preflight gaps', async () => {
    const imagePath = join(tempDir, 'cover.jpg');
    const videoPath = join(tempDir, 'clip.mp4');
    const badCoverPath = join(tempDir, 'cover-video.mp4');
    await writeFile(imagePath, 'image');
    await writeFile(videoPath, 'video');
    await writeFile(badCoverPath, 'video');
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 1,
        statusLabel: '正常',
      },
    ]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 3,
        title: '门店图文',
        contentKind: 'article',
        ...articleIdentity('article-preflight', '门店图文', '完整正文'),
        tags: [],
        fileList: [videoPath],
        accountList: ['/accounts/douyin.json'],
        coverPath: badCoverPath,
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
      {
        type: 5,
        title: '门店视频',
        contentKind: 'video',
        tags: [],
        fileList: [imagePath],
        accountList: ['/accounts/missing-bili.json'],
        enableTimer: 1,
        videosPerDay: 0,
        dailyTimes: [],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(preflight.ok).toBe(false);
    expect(preflight.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'material_type_mismatch',
          platform: '抖音',
          account: '门店抖音',
          filePath: videoPath,
          stage: '图文/视频素材检查',
          expected: '图片素材',
          actual: '视频文件',
        }),
        expect.objectContaining({
          code: 'cover_type_mismatch',
          scope: 'cover',
          filePath: badCoverPath,
          stage: '封面检查',
        }),
        expect.objectContaining({
          code: 'account_missing',
          platform: 'B站',
          account: '未识别账号',
          stage: '账号检查',
        }),
        expect.objectContaining({
          code: 'video_parameter_missing',
          platform: 'B站',
          field: 'videosPerDay',
          stage: '视频参数检查',
        }),
        expect.objectContaining({
          code: 'schedule_invalid',
          platform: 'B站',
          field: 'dailyTimes',
          stage: '视频排期检查',
        }),
        expect.objectContaining({
          code: 'bili_partition_missing',
          platform: 'B站',
          stage: 'B站参数检查',
        }),
      ]),
    );
    expect(preflight.summary).toContain('平台：抖音');
    expect(preflight.summary).toContain('阶段：图文/视频素材检查');
  });

  it('blocks bilibili image-text publish in preflight because only video is supported', async () => {
    const imagePath = join(tempDir, 'bili-image.png');
    await writeFile(imagePath, 'image');
    client.listAccounts.mockResolvedValue([
      {
        id: 5,
        type: 5,
        platform: 'B站',
        filePath: '/accounts/bili.json',
        userName: 'bili-user',
        profileName: '门店 B站',
        status: 1,
        statusLabel: '正常',
      },
    ]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 5,
        title: 'B站图文',
        contentKind: 'article',
        ...articleIdentity('article-bili', 'B站图文', '完整正文'),
        tags: [],
        fileList: [imagePath],
        accountList: ['/accounts/bili.json'],
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(preflight.ok).toBe(false);
    expect(preflight.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'platform_not_supported',
          platform: 'B站',
          stage: '平台能力检查',
          message: 'B站图文发布未接入；当前仅支持 B站视频投稿。',
        }),
      ]),
    );
  });

  it('blocks publish before account lookup when 3011 runtime health is unavailable', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.getHealth.mockRejectedValue(new Error('3011 Runtime offline'));
    client.listAccounts.mockResolvedValue([]);

    const preflight = await service.preflightPublishBatch([
      {
        type: 3,
        title: '门店视频',
        contentKind: 'video',
        tags: [],
        fileList: [materialPath],
        accountList: ['/accounts/douyin.json'],
        enableTimer: 0,
        videosPerDay: 1,
        dailyTimes: ['10:00'],
        startDays: 0,
        timeJitterMinutes: 0,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
        category: 0,
      },
    ]);

    expect(preflight.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'engine_unavailable',
          platform: '本机发布服务',
          stage: '发布服务在线检查',
        }),
      ]),
    );
  });

  it('reports expired accounts and account-blocked tasks', async () => {
    client.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: '/accounts/douyin.json',
        userName: 'douyin-user',
        profileName: '门店抖音',
        status: 0,
        statusLabel: '登录失效',
      },
    ]);
    client.listTasks.mockResolvedValue([
      {
        id: 15,
        title: '待恢复发布',
        platform_type: 3,
        platform: '抖音',
        account_file: '/accounts/douyin.json',
        file_list: ['/materials/video.mp4'],
        tags: [],
        dry_run: false,
        status: 'failed',
        message: '账号登录态失效，请重新登录',
        result: null,
        created_at: '2026-05-30T00:00:00.000Z',
        updated_at: '2026-05-30T00:00:00.000Z',
      },
    ]);

    const health = await service.getAccountHealth();

    expect(health.expiredAccounts).toBe(1);
    expect(health.issues[0]).toEqual(
      expect.objectContaining({
        accountId: 1,
        platform: '抖音',
        status: 'expired',
      }),
    );
    expect(health.waitingTasks).toEqual([
      expect.objectContaining({
        id: 15,
        canResume: false,
        nextAction: '请先重登该账号，恢复登录态后再重试。',
      }),
    ]);
  });

  it('returns a readable health issue instead of throwing when the local engine is offline', async () => {
    client.listAccounts.mockRejectedValue(new Error('3011 Runtime offline'));
    client.listTasks.mockRejectedValue(new Error('3011 Runtime offline'));

    const health = await service.getAccountHealth();

    expect(health.totalAccounts).toBe(0);
    expect(health.issues[0]).toEqual(
      expect.objectContaining({
        platform: '本机发布服务',
        status: 'missing',
        nextAction: '请确认本机发布服务可用，再刷新账号状态。',
      }),
    );
  });
});
