import {
  LocalRuntimeEngineClient,
  type LocalRuntimeEngineHealth,
} from '../../local-runtime-engine.client';
import { WechatChannelCommentReplyService } from './comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './direct-message-reply.service';
import {
  type ExecutorContext,
  type ExecutorTask,
} from '../../executor.interface';

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'wechat-channel-comment-reply',
    platform: 'wechat-channel',
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
        },
      );
    }),
  } as unknown as LocalRuntimeEngineClient;
}

describe('WechatChannelCommentReplyService', () => {
  it('匹配 wechat-channel × wechat-channel-comment-reply', () => {
    const service = new WechatChannelCommentReplyService(makeEngineMock());
    expect(service.canHandle(makeTask())).toBe(true);
  });

  it('不匹配 douyin 平台', () => {
    const service = new WechatChannelCommentReplyService(makeEngineMock());
    expect(
      service.canHandle(
        makeTask({ platform: 'douyin', type: 'douyin-comment-reply' }),
      ),
    ).toBe(false);
  });

  it('auto-send 调 send 端点 → engine 返 sent → ok=true', async () => {
    const engine = makeEngineMock();
    const service = new WechatChannelCommentReplyService(engine);

    const result = await service.execute(makeTask(), baseCtx);

    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(engine.postJson).toHaveBeenCalledWith(
      '/interaction/wechat-channel/comments/send',
      expect.objectContaining({
        accountId: 1,
        targetText: '原评论',
        replyText: '我们的回复',
      }),
      expect.any(Number),
    );
  });

  it('engine 返 comment_missing → target_not_found', async () => {
    const engine = makeEngineMock({
      postJsonResult: { status: 'comment_missing', message: '已被删' },
    });
    const service = new WechatChannelCommentReplyService(engine);
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('target_not_found');
  });

  it('engine 返 editor_missing → runtime_unavailable', async () => {
    const engine = makeEngineMock({
      postJsonResult: { status: 'editor_missing', message: '编辑器未就绪' },
    });
    const service = new WechatChannelCommentReplyService(engine);
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('runtime_unavailable');
  });

  it('sendMode=draft-only → 调 draft 端点', async () => {
    const engine = makeEngineMock({
      postJsonResult: { status: 'draft_filled', message: '草稿已填入' },
    });
    const service = new WechatChannelCommentReplyService(engine);
    const result = await service.execute(
      makeTask(),
      { ...baseCtx, sendMode: 'draft-only' },
    );

    expect(result.ok).toBe(true);
    expect(engine.postJson).toHaveBeenCalledWith(
      '/interaction/wechat-channel/comments/draft',
      expect.any(Object),
      expect.any(Number),
    );
  });
});

describe('WechatChannelDirectMessageReplyService', () => {
  function makeDmEngineMock(overrides: {
    postJsonResult?: unknown;
    postJsonThrows?: Error;
  } = {}) {
    return makeEngineMock(overrides);
  }

  it('匹配 wechat-channel × wechat-channel-direct-message-reply', () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeDmEngineMock(),
    );
    expect(
      service.canHandle(
        makeTask({ type: 'wechat-channel-direct-message-reply' }),
      ),
    ).toBe(true);
  });

  it('auto-send 调 send 端点 → engine 返 sent → ok=true', async () => {
    const engine = makeDmEngineMock();
    const service = new WechatChannelDirectMessageReplyService(engine);

    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(engine.postJson).toHaveBeenCalledWith(
      '/interaction/wechat-channel/messages/send',
      expect.objectContaining({ accountId: 1 }),
      expect.any(Number),
    );
  });

  it('engine 抛错 → runtime_unavailable', async () => {
    const engine = makeDmEngineMock({
      postJsonThrows: new Error('engine offline'),
    });
    const service = new WechatChannelDirectMessageReplyService(engine);
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('runtime_unavailable');
  });

  it('engine 返 message_missing → target_not_found', async () => {
    const engine = makeDmEngineMock({
      postJsonResult: { status: 'message_missing', message: '已过期' },
    });
    const service = new WechatChannelDirectMessageReplyService(engine);
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('target_not_found');
  });
});
