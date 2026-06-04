import {
  LocalRuntimeEngineClient,
  type LocalRuntimeEngineHealth,
} from '../../local-runtime-engine.client';
import { DouyinCommentReplyService } from './comment-reply.service';
import { DouyinDirectMessageReplyService } from './direct-message-reply.service';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../../executor.interface';

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'douyin-comment-reply',
    platform: 'douyin',
    accountId: 1,
    payload: { targetText: '原评论', replyText: '我们的回复' },
    ...overrides,
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeEngineMock(overrides: {
  postJsonResult?: unknown;
  postJsonThrows?: Error;
} = {}) {
  return {
    getEngineUrl: jest.fn().mockReturnValue(''),
    getHealth: jest.fn().mockResolvedValue({
      online: true,
      status: 'ok',
      version: 'test',
    } as LocalRuntimeEngineHealth),
    postJson: jest.fn().mockImplementation(() => {
      if (overrides.postJsonThrows) {
        return Promise.reject(overrides.postJsonThrows);
      }
      return Promise.resolve(
        overrides.postJsonResult ?? {
          status: 'sent',
          message: 'test sent',
          readbackText: '我们的回复',
          evidence: {
            type: 'screenshot',
            label: 'test screenshot',
            path: '/tmp/test.png',
            capturedAt: new Date().toISOString(),
          },
        },
      );
    }),
  } as unknown as LocalRuntimeEngineClient;
}

describe('DouyinCommentReplyService', () => {
  describe('canHandle', () => {
    it('匹配 douyin × douyin-comment-reply', () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      expect(service.canHandle(makeTask())).toBe(true);
    });

    it('不匹配 wechat-channel 平台', () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      expect(
        service.canHandle(makeTask({ platform: 'wechat-channel' })),
      ).toBe(false);
    });

    it('不匹配 wechat-desktop 平台', () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      expect(
        service.canHandle(makeTask({ platform: 'wechat-desktop' })),
      ).toBe(false);
    });

    it('不匹配 douyin-direct-message-reply 类型', () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      expect(
        service.canHandle(
          makeTask({ type: 'douyin-direct-message-reply' }),
        ),
      ).toBe(false);
    });
  });

  describe('execute - auto-send 路径', () => {
    it('engine 返 sent → ok=true, reasonCode=success, evidence 含 screenshot', async () => {
      const engine = makeEngineMock();
      const service = new DouyinCommentReplyService(engine);

      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('success');
      expect(result.reasonCode).toBe('success');
      expect(result.evidence[0].type).toBe('screenshot');
      expect(result.evidence[0].path).toBe('/tmp/test.png');
      // 调的是 send 端点
      expect(engine.postJson).toHaveBeenCalledWith(
        '/interaction/douyin/comments/send',
        expect.objectContaining({
          accountId: 1,
          targetText: '原评论',
          replyText: '我们的回复',
        }),
        expect.any(Number),
      );
    });

    it('engine 返 send_failed → ok=false, reasonCode=send_failed', async () => {
      const engine = makeEngineMock({
        postJsonResult: { status: 'send_failed', message: '引擎内部错误' },
      });
      const service = new DouyinCommentReplyService(engine);
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('send_failed');
    });

    it('engine 抛错 → ok=false, reasonCode=runtime_unavailable', async () => {
      const engine = makeEngineMock({
        postJsonThrows: new Error('engine 500'),
      });
      const service = new DouyinCommentReplyService(engine);
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('runtime_unavailable');
      expect(result.technicalMessage).toContain('engine 500');
    });
  });

  describe('execute - draft-only 路径', () => {
    it('sendMode=draft-only → 调 draft 端点 + 返 success', async () => {
      const engine = makeEngineMock({
        postJsonResult: { status: 'draft_filled', message: '草稿已填入' },
      });
      const service = new DouyinCommentReplyService(engine);

      const result = await service.execute(makeTask(), {
        ...baseCtx,
        sendMode: 'draft-only',
      });

      expect(result.ok).toBe(true);
      expect(result.technicalMessage).toContain('draft-only');
      expect(engine.postJson).toHaveBeenCalledWith(
        '/interaction/douyin/comments/draft',
        expect.any(Object),
        expect.any(Number),
      );
    });
  });

  describe('execute - 校验', () => {
    it('缺 accountId → account_not_logged_in', async () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      const result = await service.execute(
        makeTask({ accountId: undefined }),
        baseCtx,
      );

      expect(result.reasonCode).toBe('account_not_logged_in');
    });

    it('缺 replyText → target_not_found', async () => {
      const service = new DouyinCommentReplyService(makeEngineMock());
      const result = await service.execute(
        makeTask({ payload: { targetText: '原评论' } }),
        baseCtx,
      );

      expect(result.reasonCode).toBe('target_not_found');
    });

    it('engine 返 comment_missing → target_not_found', async () => {
      const engine = makeEngineMock({
        postJsonResult: { status: 'comment_missing', message: '评论已被删' },
      });
      const service = new DouyinCommentReplyService(engine);
      const result = await service.execute(makeTask(), baseCtx);

      expect(result.reasonCode).toBe('target_not_found');
    });
  });
});

describe('DouyinDirectMessageReplyService', () => {
  function makeDmEngineMock(overrides: {
    postJsonResult?: unknown;
    postJsonThrows?: Error;
  } = {}) {
    return makeEngineMock(overrides);
  }

  it('匹配 douyin × douyin-direct-message-reply', () => {
    const service = new DouyinDirectMessageReplyService(makeDmEngineMock());
    expect(
      service.canHandle(
        makeTask({ type: 'douyin-direct-message-reply' }),
      ),
    ).toBe(true);
  });

  it('auto-send 调 send 端点 → engine 返 sent → ok=true', async () => {
    const engine = makeDmEngineMock();
    const service = new DouyinDirectMessageReplyService(engine);

    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(engine.postJson).toHaveBeenCalledWith(
      '/interaction/douyin/messages/send',
      expect.objectContaining({
        accountId: 1,
        targetText: '原评论',
        replyText: '我们的回复',
      }),
      expect.any(Number),
    );
  });

  it('engine 返 message_missing → target_not_found', async () => {
    const engine = makeDmEngineMock({
      postJsonResult: { status: 'message_missing', message: '私信已过期' },
    });
    const service = new DouyinDirectMessageReplyService(engine);
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('target_not_found');
  });

  it('engine 抛错 → runtime_unavailable', async () => {
    const engine = makeDmEngineMock({
      postJsonThrows: new Error('socket hangup'),
    });
    const service = new DouyinDirectMessageReplyService(engine);
    const result = await service.execute(
      makeTask({ type: 'douyin-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('runtime_unavailable');
  });
});
