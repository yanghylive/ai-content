import { NotFoundException } from '@nestjs/common';
import type {
  AutoUploadAccount,
  AutoUploadPublishBatchResult,
} from '../auto-upload/auto-upload.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformAdapterRegistry } from '../platform-registry/platform-adapter.registry';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { LOCAL_BRIDGE_ACTIONS } from './local-bridge.contract';
import { LocalBridgeError } from './local-bridge.errors';
import { LocalBridgeService } from './local-bridge.service';
import { BilibiliPublishAdapter } from '../runtime/platforms/publishing/bilibili-publish.adapter';
import { DouyinPublishAdapter } from '../runtime/platforms/publishing/douyin-publish.adapter';
import { KuaishouPublishAdapter } from '../runtime/platforms/publishing/kuaishou-publish.adapter';
import { WechatChannelPublishAdapter } from '../runtime/platforms/publishing/wechat-channel-publish.adapter';
import { XiaohongshuPublishAdapter } from '../runtime/platforms/publishing/xiaohongshu-publish.adapter';

describe('LocalBridgeService', () => {
  const autoUploadService = {
    getHealth: jest.fn(),
    listAccounts: jest.fn(),
    publishBatch: jest.fn(),
    getPublishBatchResults: jest.fn(),
    deletePublishTask: jest.fn(),
  };
  const coordinator = {
    executeDurablePublish: jest.fn(),
    claimOrLoad: jest.fn(),
  };
  const publishRecordStore = {
    resolveOwnerScope: jest.fn(),
    findClaimByIdempotencyKey: jest.fn(),
    createClaim: jest.fn(),
    claimNextQueued: jest.fn(),
  };
  let service: LocalBridgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    const registry = new PlatformAdapterRegistry();
    for (const adapter of [
      new XiaohongshuPublishAdapter({
        cleanTags: (t) => t,
        fillFirstEditable: () => Promise.resolve(),
        waitGenericVideoUploaded: () => Promise.resolve(),
      }),
      new WechatChannelPublishAdapter(),
      new DouyinPublishAdapter({
        gotoBestEffort: () => Promise.resolve(),
        waitGenericPublishButton: () =>
          Promise.resolve({ click: () => Promise.resolve() }),
      }),
      new KuaishouPublishAdapter(),
      new BilibiliPublishAdapter(),
    ]) {
      registry.register(adapter);
    }
    service = new LocalBridgeService(
      autoUploadService as unknown as AutoUploadService,
      registry,
      coordinator as never,
      publishRecordStore as never,
      new AuthRequestContextService(),
    );
  });

  it('maps AutoUpload health to read-only bridge status', async () => {
    autoUploadService.getHealth.mockResolvedValue({
      online: true,
      status: 'ok',
      service: 'local browser runtime',
      version: '0.1.0',
      engineUrl: 'internal://local-browser-engine',
      checkedAt: '2026-08-01T00:00:00.000Z',
    });

    await expect(service.getStatus()).resolves.toEqual({
      online: true,
      status: 'ok',
      service: 'jiuzhang-local-bridge',
      version: '0.1.0',
      protocolVersion: 1,
      actions: Object.values(LOCAL_BRIDGE_ACTIONS),
      checkedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(autoUploadService.getHealth).toHaveBeenCalledTimes(1);
  });

  it('returns an offline health snapshot as a successful envelope', async () => {
    autoUploadService.getHealth.mockResolvedValue({
      online: false,
      status: 'missing',
      service: 'local browser runtime',
      version: '0.1.0',
      engineUrl: 'internal://local-browser-engine',
      checkedAt: '2026-08-01T00:01:00.000Z',
    });

    await expect(
      service.respond('trace-offline', LOCAL_BRIDGE_ACTIONS.CHECK_STATUS, () =>
        service.getStatus(),
      ),
    ).resolves.toMatchObject({
      traceId: 'trace-offline',
      ok: true,
      code: 200,
      data: { online: false, status: 'missing' },
    });
  });

  it('returns a stable engine error when the health check fails', async () => {
    autoUploadService.getHealth.mockRejectedValue(
      new Error('connection failed'),
    );

    await expect(service.getStatus()).rejects.toMatchObject({
      errorCode: 'ENGINE_UNAVAILABLE',
      code: 503,
    });
  });

  it('returns a success envelope with the requested trace id', async () => {
    await expect(
      service.respond('trace-1', LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES, () => [
        'capability',
      ]),
    ).resolves.toMatchObject({
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES,
      ok: true,
      code: 200,
      data: ['capability'],
      message: 'ok',
    });
  });

  it('returns a stable error envelope with a server trace id for invalid trace ids', async () => {
    const response = await service.respond(
      '',
      LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
      () => 'unused',
    );

    expect(response).toMatchObject({
      action: LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
      ok: false,
      code: 400,
      errorCode: 'INVALID_REQUEST',
      data: null,
    });
    expect(response.traceId).toMatch(
      /^srv-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('preserves a custom LocalBridgeError in the error envelope', async () => {
    await expect(
      service.respond(
        'trace-custom',
        LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS,
        () => {
          throw new LocalBridgeError(
            'UNAUTHORIZED_ORIGIN',
            '当前来源未获授权',
            403,
          );
        },
      ),
    ).resolves.toMatchObject({
      traceId: 'trace-custom',
      ok: false,
      code: 403,
      errorCode: 'UNAUTHORIZED_ORIGIN',
      message: '当前来源未获授权',
      data: null,
    });
  });

  it('maps unexpected runtime failures to a stable error envelope', async () => {
    await expect(
      service.respond('trace-2', LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS, () => {
        throw new Error('sensitive failure');
      }),
    ).resolves.toMatchObject({
      traceId: 'trace-2',
      ok: false,
      code: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Local Bridge 请求处理失败',
      data: null,
    });
  });

  it('returns capability snapshots for the five supported platforms', () => {
    const first = service.listCapabilities();
    const second = service.listCapabilities();

    expect(first.map((item) => item.platform)).toEqual([
      'xiaohongshu',
      'wechat-channel',
      'douyin',
      'kuaishou',
      'bilibili',
    ]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first.every((item) => item.riskLevel === 'high')).toBe(true);
    expect(
      first.every(
        (item) =>
          !item.supportsSchedule &&
          !item.supportsCover &&
          !item.supportsReadback,
      ),
    ).toBe(true);
  });

  it('lists sanitized accounts without validating or refreshing local sessions', async () => {
    const account: AutoUploadAccount = {
      id: 12,
      stableId: 'account-stable-id',
      accountName: '创作者账号',
      type: 3,
      platform: '抖音',
      filePath: '/private/cookies.json',
      userName: 'creator',
      avatarUrl: 'https://example.test/avatar.png',
      status: 1,
      statusCode: 'ok',
      statusLabel: '已登录',
      sessionStatus: 'logged_in',
      lastDispatchAt: '2026-07-31T12:00:00.000Z',
    };
    autoUploadService.listAccounts.mockResolvedValue([account]);

    const result = await service.listAccounts();

    expect(autoUploadService.listAccounts).toHaveBeenCalledWith({
      validate: false,
      force: false,
    });
    expect(result).toEqual([
      {
        id: 'account-stable-id',
        platform: 'douyin',
        displayName: '抖音',
        accountName: '创作者账号',
        status: 'ready',
        statusLabel: '已登录',
        avatarUrl: 'https://example.test/avatar.png',
        lastCheckedAt: '2026-07-31T12:00:00.000Z',
      },
    ]);
    expect(result[0]).not.toHaveProperty('filePath');
    expect(result[0]).not.toHaveProperty('token');
    expect(result[0]).not.toHaveProperty('cookie');
  });

  it('creates a durable task via coordinator and returns a stable task id', async () => {
    publishRecordStore.resolveOwnerScope.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    coordinator.executeDurablePublish.mockResolvedValue({
      kind: 'created',
      record: { publicId: 42, idempotencyKey: 'publish-1' },
    });

    const result = await service.executePublish({
      confirmationId: 'confirmation-1',
      idempotencyKey: 'publish-1',
      payloads: [
        {
          type: 3,
          title: '标题',
          tags: ['标签'],
          fileList: ['/tmp/video.mp4'],
          accountList: ['account-1'],
        },
      ],
    });

    expect(result).toMatchObject({
      accepted: true,
      taskId: 42,
      status: 'waiting',
      idempotencyKey: 'publish-1',
    });
    expect(coordinator.executeDurablePublish).toHaveBeenCalledTimes(1);
    expect(autoUploadService.publishBatch).not.toHaveBeenCalled();
  });

  it('rejects execute DTOs with inherited fields', async () => {
    const inherited = Object.create({
      confirmationId: 'confirmation-1',
      idempotencyKey: 'publish-1',
      payloads: [],
    }) as Record<string, unknown>;

    await expect(
      service.executePublish(inherited as never),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST',
      code: 400,
    });
    expect(autoUploadService.publishBatch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unknown top-level fields',
      {
        confirmationId: 'confirmation-1',
        idempotencyKey: 'publish-1',
        payloads: [],
        unexpected: true,
      },
    ],
    [
      'missing confirmation',
      {
        confirmationId: '',
        idempotencyKey: 'publish-1',
        payloads: [
          {
            type: 3,
            title: '标题',
            tags: [],
            fileList: [],
            accountList: [],
          },
        ],
      },
    ],
    [
      'unknown payload fields',
      {
        confirmationId: 'confirmation-1',
        idempotencyKey: 'publish-1',
        payloads: [
          {
            type: 3,
            title: '标题',
            tags: [],
            fileList: [],
            accountList: [],
            unexpected: true,
          },
        ],
      },
    ],
  ])('rejects %s with a stable invalid request error', async (_case, body) => {
    await expect(service.executePublish(body as never)).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST',
      code: 400,
    });
    expect(autoUploadService.publishBatch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'completed',
      {
        platforms: [{ platform: 'douyin', accountId: '1', status: 'success' }],
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
      },
    ],
    [
      'failed',
      {
        platforms: [{ platform: 'douyin', accountId: '1', status: 'failed' }],
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
    ],
    [
      'waiting',
      {
        platforms: [
          { platform: 'douyin', accountId: '1', status: 'pending_manual' },
        ],
        summary: {
          total: 1,
          success: 0,
          failed: 0,
          accountExpired: 0,
          materialError: 0,
          loginRequired: 0,
          pendingManual: 1,
          blocked: 0,
          notIntegrated: 0,
        },
      },
    ],
  ] as const)(
    'derives %s task status from persisted publish results',
    async (expectedStatus, result) => {
      autoUploadService.getPublishBatchResults.mockResolvedValue(result);

      await expect(service.getTaskStatus('42')).resolves.toEqual({
        taskId: 42,
        status: expectedStatus,
        result,
      });
      expect(autoUploadService.getPublishBatchResults).toHaveBeenCalledWith(42);
    },
  );

  it('maps missing publish tasks to TASK_NOT_FOUND', async () => {
    autoUploadService.getPublishBatchResults.mockRejectedValue(
      new NotFoundException('missing'),
    );

    await expect(service.getTaskStatus('42')).rejects.toMatchObject({
      errorCode: 'TASK_NOT_FOUND',
      code: 404,
    });
  });

  it.each(['0', '-1', '1.5', '9007199254740992', 'not-a-number'])(
    'rejects invalid task id %s before querying results',
    async (taskId) => {
      await expect(service.getTaskStatus(taskId)).rejects.toMatchObject({
        errorCode: 'INVALID_REQUEST',
        code: 400,
      });
      expect(autoUploadService.getPublishBatchResults).not.toHaveBeenCalled();
    },
  );

  it('rejects cancellation without deleting the publish task', async () => {
    await expect(
      service.cancelTask('42', { reason: '用户取消' }),
    ).rejects.toMatchObject({
      errorCode: 'CANCELLATION_UNSUPPORTED',
      code: 409,
    });
    expect(autoUploadService.deletePublishTask).not.toHaveBeenCalled();
  });

  it('validates cancellation before returning unsupported', async () => {
    await expect(
      service.cancelTask('42', { unexpected: true } as never),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_REQUEST',
      code: 400,
    });
    expect(autoUploadService.deletePublishTask).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 0, sessionStatus: 'unknown' }, 'needs_login'],
    [{ status: 1, sessionStatus: 'needs_login' }, 'needs_login'],
    [{ status: 1, sessionStatus: 'error' }, 'error'],
    [{ status: 1, sessionStatus: 'logged_in' }, 'ready'],
  ] as const)(
    'maps account session state %o to %s',
    async (state, expected) => {
      autoUploadService.listAccounts.mockResolvedValue([
        {
          id: 7,
          type: 1,
          platform: '小红书',
          filePath: '/private/account.json',
          userName: 'creator',
          statusLabel: '状态',
          ...state,
        } satisfies AutoUploadAccount,
      ]);

      await expect(service.listAccounts()).resolves.toEqual([
        expect.objectContaining({ status: expected }),
      ]);
    },
  );
});
