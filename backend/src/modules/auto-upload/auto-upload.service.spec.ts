import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutoUploadService } from './auto-upload.service';
import type { AutoUploadPublishPayload } from './auto-upload.client';

describe('AutoUploadService', () => {
  let tempDir: string;
  let client: {
    getHealth: jest.Mock;
    listAccounts: jest.Mock;
    listTasks: jest.Mock;
    publishBatch: jest.Mock;
  };
  let service: AutoUploadService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auto-upload-service-'));
    client = {
      getHealth: jest.fn().mockResolvedValue({
        online: true,
        status: 'ok',
        service: 'auto-upload',
        version: 'test',
        engineUrl: 'http://127.0.0.1:5409',
        checkedAt: '2026-05-30T00:00:00.000Z',
      }),
      listAccounts: jest.fn(),
      listTasks: jest.fn(),
      publishBatch: jest.fn(),
    };
    service = new AutoUploadService(client as any, {} as any);
    jest
      .spyOn(service as any, 'publishPayloadStorePath')
      .mockReturnValue(join(tempDir, 'auto-upload-publish-payloads.json'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('records publish payloads and restores the original payload when retrying', async () => {
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
        results: [{ type: 5, ok: true }],
      })
      .mockResolvedValueOnce({
        taskIds: [202],
        results: [{ type: 5, ok: true }],
      });
    client.listTasks.mockResolvedValue([
      {
        id: 101,
        title: '任务表标题',
        platform_type: 5,
        platform: 'B站',
        account_file: '/accounts/bili.json',
        file_list: ['/materials/fallback.mp4'],
        tags: ['fallback'],
        dry_run: true,
        status: 'failed',
        message: '账号恢复后重试',
        result: null,
        created_at: '2026-05-30T00:00:00.000Z',
        updated_at: '2026-05-30T00:00:00.000Z',
      },
    ]);

    await service.publishBatch([originalPayload], {
      confirmation: {
        confirmed: true,
        confirmedAction: 'publish',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });
    const retry = await service.retryPublishTask(101, {
      confirmation: {
        confirmed: true,
        confirmedAction: 'retry-publish',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });

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
  });

  it('falls back to reconstructed payload when no original publish payload exists', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listTasks.mockResolvedValue([
      {
        id: 7,
        title: '失败任务',
        platform_type: 3,
        platform: '抖音',
        account_file: '/accounts/douyin.json',
        file_list: [materialPath],
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
    client.publishBatch.mockResolvedValue({
      taskIds: [8],
      results: [{ type: 3, ok: true }],
    });

    const retry = await service.retryPublishTask(7, {
      confirmation: {
        confirmed: true,
        confirmedAction: 'retry-publish',
        confirmedRiskLevel: 'high',
      },
    });

    expect(retry.payloadSource).toBe('reconstructed');
    expect(retry.riskAudit?.action).toBe('retry-publish');
    expect(client.publishBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 3,
        title: '失败任务',
        fileList: [materialPath],
        accountList: ['/accounts/douyin.json'],
      }),
    ]);
  });

  it('blocks publish retry when the recovered payload account is expired', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.listTasks.mockResolvedValue([
      {
        id: 7,
        title: '失败任务',
        platform_type: 3,
        platform: '抖音',
        account_file: '/accounts/douyin.json',
        file_list: [materialPath],
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
        status: 0,
        statusLabel: '登录失效',
      },
    ]);

    await expect(
      service.retryPublishTask(7, {
        confirmation: {
          confirmed: true,
          confirmedAction: 'retry-publish',
          confirmedRiskLevel: 'high',
        },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('登录态失效或不可用'),
      }),
    });
    expect(client.publishBatch).not.toHaveBeenCalled();
  });

  it('blocks publish retry delete and resume actions without backend risk confirmation', async () => {
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

    await expect(
      service.publishBatch([
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
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        riskAudit: expect.objectContaining({
          action: 'publish',
          riskLevel: 'high',
        }),
      }),
    });
    await expect(service.deleteAccount(1)).rejects.toMatchObject({
      response: expect.objectContaining({
        riskAudit: expect.objectContaining({
          action: 'platform-account-delete',
        }),
      }),
    });
    expect(client.publishBatch).not.toHaveBeenCalled();
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
      {
        confirmation: {
          confirmed: true,
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
          operator: '测试用户',
        },
      },
    );

    expect(result.summary.success).toBe(0);
    expect(result.summary.pendingManual).toBe(1);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'pending_manual',
        publishTaskId: '44',
        failureReason: '任务创建成功',
        nextAction: expect.stringContaining('不能视为商用发布成功'),
      }),
    );
  });

  it('counts publish success only when the engine returns platform evidence', async () => {
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
      {
        confirmation: {
          confirmed: true,
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
          operator: '测试用户',
        },
      },
    );

    expect(result.summary.success).toBe(1);
    expect(result.summary.pendingManual).toBe(0);
    expect(result.platforms[0]).toEqual(
      expect.objectContaining({
        status: 'success',
        publishTaskId: '45',
        publishUrl: 'https://www.douyin.com/video/45',
        evidence: expect.objectContaining({
          source: 'platform-api',
          publishUrl: 'https://www.douyin.com/video/45',
        }),
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
          account: '/accounts/missing-bili.json',
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

  it('blocks publish before account lookup when 5409 health is unavailable', async () => {
    const materialPath = join(tempDir, 'video.mp4');
    await writeFile(materialPath, 'video');
    client.getHealth.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5409'),
    );
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
          platform: '本地发布服务',
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
    client.listAccounts.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5409'),
    );
    client.listTasks.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5409'),
    );

    const health = await service.getAccountHealth();

    expect(health.totalAccounts).toBe(0);
    expect(health.issues[0]).toEqual(
      expect.objectContaining({
        platform: '本地发布服务',
        status: 'missing',
        nextAction: '请先启动 本地发布服务，再刷新校验账号状态。',
      }),
    );
  });
});
