import {
  LocalRuntimeEngineClient,
  type LocalRuntimeEngineHealth,
} from '../../local-runtime-engine.client';
import { DouyinCommentReplyService } from './comment-reply.service';
import { DouyinDirectMessageReplyService } from './direct-message-reply.service';
import {
  type PlatformDispatchResult,
  type PlatformInteractionExecutor,
} from '../../../local-engine/platform-interaction-executor.service';
import {
  type ExecutorContext,
  type ExecutorTask,
} from '../../executor.interface';

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'douyin-comment-reply',
    platform: 'douyin',
    accountId: '1',
    payload: {
      targetName: '评论用户',
      targetText: '原评论',
      sourceText: '原评论',
      sourceUrl: 'https://www.douyin.com/video/1',
      profileUrl: 'https://www.douyin.com/user/lead-1',
      commentTime: '今天',
      videoTitle: '热门视频',
      videoUrl: 'https://www.douyin.com/video/1',
      engagementScore: 9800,
      replyText: '我们的回复',
    },
    ...overrides,
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeEngineMock() {
  return {
    getEngineUrl: jest
      .fn()
      .mockReturnValue('internal://ai-content/local-interaction'),
    getHealth: jest.fn().mockResolvedValue({
      online: true,
      status: 'ok',
      version: 'test',
    } as LocalRuntimeEngineHealth),
  } as unknown as LocalRuntimeEngineClient;
}

function makeExecutorMock(
  overrides: {
    dispatchResult?: Partial<PlatformDispatchResult>;
    dispatchThrows?: Error;
  } = {},
) {
  return {
    dispatch: jest.fn().mockImplementation(() => {
      if (overrides.dispatchThrows) {
        return Promise.reject(overrides.dispatchThrows);
      }
      return Promise.resolve({
        status: 'sent',
        message: 'test sent',
        readbackText: '我们的回复',
        replyVisible: true,
        evidencePath: '/tmp/test.png',
        ...overrides.dispatchResult,
      } satisfies PlatformDispatchResult);
    }),
  } as unknown as jest.Mocked<PlatformInteractionExecutor>;
}

describe('DouyinCommentReplyService', () => {
  describe('canHandle', () => {
    it('匹配 douyin x douyin-comment-reply', () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      expect(service.canHandle(makeTask())).toBe(true);
    });

    it('不匹配 wechat-channel 平台', () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      expect(service.canHandle(makeTask({ platform: 'wechat-channel' }))).toBe(
        false,
      );
    });

    it('不匹配 wechat-desktop 平台', () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      expect(service.canHandle(makeTask({ platform: 'wechat-desktop' }))).toBe(
        false,
      );
    });

    it('不匹配 douyin-direct-message-reply 类型', () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      expect(
        service.canHandle(makeTask({ type: 'douyin-direct-message-reply' })),
      ).toBe(false);
    });
  });

  describe('execute - auto-send 路径', () => {
    it('executor 返 sent 且回读匹配 -> ok=true', async () => {
      const engine = makeEngineMock();
      const executor = makeExecutorMock();
      const service = new DouyinCommentReplyService(engine, executor);

      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      expect(result.reasonCode).toBe('success');
      expect(result.evidence[0].type).toBe('screenshot');
      expect(result.evidence[0].path).toBe('/tmp/test.png');
      expect(executor.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'douyin',
          taskType: 'comment-reply',
          action: 'send',
          accountId: '1',
          targetName: '评论用户',
          targetText: '原评论',
          sourceText: '原评论',
          sourceUrl: 'https://www.douyin.com/video/1',
          profileUrl: 'https://www.douyin.com/user/lead-1',
          commentTime: '今天',
          videoTitle: '热门视频',
          videoUrl: 'https://www.douyin.com/video/1',
          engagementScore: 9800,
          replyText: '我们的回复',
        }),
      );
    });

    it('executor 返 sent 但没有回读 -> ok=false，不能假成功', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({
          dispatchResult: {
            status: 'sent',
            readbackText: '',
            replyVisible: false,
          },
        }),
      );

      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('readback_failed');
      expect(result.userMessage).toContain('未通过回读确认');
    });

    it('executor 只返 replyVisible 但没有回读文本 -> ok=false，不能假成功', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({
          dispatchResult: {
            status: 'sent',
            readbackText: '',
            replyVisible: true,
          },
        }),
      );

      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('readback_failed');
    });

    it('executor 返 failed -> ok=false, reasonCode=send_failed', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({
          dispatchResult: { status: 'failed', message: '引擎内部错误' },
        }),
      );
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('send_failed');
    });

    it('executor 返 account_not_logged_in -> account_not_logged_in', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({
          dispatchResult: {
            status: 'account_not_logged_in',
            message: '抖音账号未登录，不能读取或回复。',
          },
        }),
      );
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('account_not_logged_in');
      expect(result.userMessage).toContain('未登录');
    });

    it('executor 抛错 -> ok=false, reasonCode=runtime_unavailable', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({ dispatchThrows: new Error('engine 500') }),
      );
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('runtime_unavailable');
      expect(result.technicalMessage).toContain('engine 500');
    });
  });

  describe('execute - draft-only 路径', () => {
    it('sendMode=draft-only -> 调 draft + 返 success，不要求发送回读', async () => {
      const executor = makeExecutorMock({
        dispatchResult: { status: 'draft_filled', message: '草稿已填入' },
      });
      const service = new DouyinCommentReplyService(makeEngineMock(), executor);

      const result = await service.execute(makeTask(), {
        ...baseCtx,
        sendMode: 'draft-only',
      });

      expect(result.ok).toBe(true);
      expect(result.technicalMessage).toContain('draft-only');
      expect(executor.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'draft' }),
      );
    });
  });

  describe('execute - 校验', () => {
    it('缺 accountId -> account_not_logged_in', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      const result = await service.execute(
        makeTask({ accountId: undefined }),
        baseCtx,
      );

      expect(result.reasonCode).toBe('account_not_logged_in');
    });

    it('缺 replyText -> target_not_found', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock(),
      );
      const result = await service.execute(
        makeTask({ payload: { targetText: '原评论' } }),
        baseCtx,
      );

      expect(result.reasonCode).toBe('target_not_found');
    });

    it('executor 返 comment_missing -> target_not_found', async () => {
      const service = new DouyinCommentReplyService(
        makeEngineMock(),
        makeExecutorMock({
          dispatchResult: { status: 'comment_missing', message: '评论已被删' },
        }),
      );
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.reasonCode).toBe('target_not_found');
    });
  });
});

describe('DouyinDirectMessageReplyService', () => {
  it('匹配 douyin x douyin-direct-message-reply', () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock(),
    );
    expect(
      service.canHandle(makeTask({ type: 'douyin-direct-message-reply' })),
    ).toBe(true);
  });

  it('auto-send 返 sent 且回读匹配 -> ok=true', async () => {
    const executor = makeExecutorMock();
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      executor,
    );

    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(executor.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        taskType: 'direct-message-reply',
        action: 'send',
        accountId: '1',
        targetName: '评论用户',
        targetText: '原评论',
        sourceText: '原评论',
        sourceUrl: 'https://www.douyin.com/video/1',
        profileUrl: 'https://www.douyin.com/user/lead-1',
        commentTime: '今天',
        videoTitle: '热门视频',
        videoUrl: 'https://www.douyin.com/video/1',
        engagementScore: 9800,
        replyText: '我们的回复',
      }),
    );
  });

  it('auto-send 返 sent 但没有回读 -> ok=false，不能假成功', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: {
          status: 'sent',
          readbackText: '',
          replyVisible: false,
        },
      }),
    );

    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('readback_failed');
  });

  it('auto-send 只返 replyVisible 但没有回读文本 -> ok=false，不能假成功', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: {
          status: 'sent',
          readbackText: '',
          replyVisible: true,
        },
      }),
    );

    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('readback_failed');
  });

  it('executor 返 failed -> send_failed', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'failed', message: '私信已过期' },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('send_failed');
  });

  it('executor 返 account_not_logged_in -> account_not_logged_in', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: {
          status: 'account_not_logged_in',
          message: '抖音账号未登录，不能读取或回复。',
        },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('account_not_logged_in');
  });

  it('executor 返 message_missing -> target_not_found', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'message_missing', message: '私信已过期' },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('target_not_found');
  });

  it('executor 抛错 -> runtime_unavailable', async () => {
    const service = new DouyinDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({ dispatchThrows: new Error('socket hangup') }),
    );
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('runtime_unavailable');
  });
});
