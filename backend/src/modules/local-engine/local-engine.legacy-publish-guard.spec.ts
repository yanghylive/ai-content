import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService legacy publish resume guard', () => {
  it('keeps the draft waiting for a server publish ticket without submitting it', async () => {
    const service = Object.create(LocalEngineService.prototype) as any;
    service.autoUploadService = {
      preflightPublishBatch: jest.fn().mockResolvedValue({
        ok: true,
        summary: '发布前检查通过',
        issues: [],
      }),
      publishBatch: jest.fn(),
    };
    service.pushAgentEvent = jest.fn(
      (session, level, title, message, evidence) => {
        session.events.push({ level, title, message, evidence });
      },
    );
    service.resolveAgentSessionStatusLabel = jest.fn((status) =>
      status === 'waiting_for_confirmation' ? '等待确认' : String(status),
    );
    service.persistAgentSession = jest.fn().mockResolvedValue(undefined);
    const session = {
      id: 'agent-session-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      title: '发布草稿',
      instruction: '发布门店视频',
      status: 'running',
      statusLabel: '执行中',
      executionScope: 'browser',
      source: 'publishing',
      createdAt: '2026-07-12T20:00:00.000Z',
      updatedAt: '2026-07-12T20:00:00.000Z',
      riskLevel: 'high',
      confirmations: [],
      events: [],
    };
    const action = {
      kind: 'auto-upload-publish',
      label: '发布门店视频',
      payloads: [
        {
          type: 3,
          title: '门店视频',
          contentKind: 'video',
          tags: [],
          fileList: ['video.mp4'],
          accountList: ['douyin.json'],
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
    };
    const confirmation = {
      id: 'legacy-agent-confirmation',
      operator: '测试用户',
      actionLabel: '确认发布',
      decidedAt: '2026-07-12T20:01:00.000Z',
    };

    await service.runAutoUploadPublishResume(session, action, confirmation);

    expect(service.autoUploadService.preflightPublishBatch).toHaveBeenCalled();
    expect(service.autoUploadService.publishBatch).not.toHaveBeenCalled();
    expect(session.status).toBe('waiting_for_confirmation');
    expect(session.completedAt).toBeUndefined();
    expect(session.nextAction).toContain('服务端一次性确认');
    expect(session.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warning',
          title: '旧发布续跑入口已阻断',
          message: expect.stringContaining('未向任何平台提交'),
        }),
      ]),
    );
  });
});
