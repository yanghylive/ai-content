import {
  LocalRuntimeEngineClient,
  type LocalRuntimeEngineHealth,
} from '../../local-runtime-engine.client';
import { WechatChannelCommentReplyService } from './comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './direct-message-reply.service';
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
    type: 'wechat-channel-comment-reply',
    platform: 'wechat-channel',
    accountId: '4',
    payload: { targetText: '原评论', replyText: '我们的回复' },
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

describe('WechatChannelCommentReplyService', () => {
  it('匹配 wechat-channel x wechat-channel-comment-reply', () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock(),
    );
    expect(service.canHandle(makeTask())).toBe(true);
  });

  it('不匹配 douyin 平台', () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock(),
    );
    expect(
      service.canHandle(
        makeTask({ platform: 'douyin', type: 'douyin-comment-reply' }),
      ),
    ).toBe(false);
  });

  it('auto-send 返 sent 且回读匹配 -> ok=true', async () => {
    const executor = makeExecutorMock();
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      executor,
    );

    const result = await service.execute(makeTask(), baseCtx);

    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe('success');
    expect(executor.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'wechat-channel',
        taskType: 'comment-reply',
        action: 'send',
        accountId: '4',
      }),
    );
  });

  it('auto-send 返 sent 但没有回读 -> ok=false，不能假成功', async () => {
    const service = new WechatChannelCommentReplyService(
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

  it('auto-send 只返 replyVisible 但没有回读文本 -> ok=false，不能假成功', async () => {
    const service = new WechatChannelCommentReplyService(
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

  it('executor 返 failed -> send_failed', async () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'failed', message: '已被删' },
      }),
    );
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('send_failed');
  });

  it('executor 返 editor_missing -> runtime_unavailable', async () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'editor_missing', message: '编辑器未就绪' },
      }),
    );
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('runtime_unavailable');
  });

  it('executor 返 account_not_logged_in -> account_not_logged_in', async () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: {
          status: 'account_not_logged_in',
          message: '视频号账号未登录，不能读取或回复。',
        },
      }),
    );
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('account_not_logged_in');
  });

  it('executor 返 comment_missing -> target_not_found', async () => {
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'comment_missing', message: '评论已被删' },
      }),
    );
    const result = await service.execute(makeTask(), baseCtx);

    expect(result.reasonCode).toBe('target_not_found');
  });

  it('sendMode=draft-only -> 调 draft', async () => {
    const executor = makeExecutorMock({
      dispatchResult: { status: 'draft_filled', message: '草稿已填入' },
    });
    const service = new WechatChannelCommentReplyService(
      makeEngineMock(),
      executor,
    );
    const result = await service.execute(makeTask(), {
      ...baseCtx,
      sendMode: 'draft-only',
    });

    expect(result.ok).toBe(true);
    expect(executor.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'draft' }),
    );
  });
});

describe('WechatChannelDirectMessageReplyService', () => {
  it('匹配 wechat-channel x wechat-channel-direct-message-reply', () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock(),
    );
    expect(
      service.canHandle(
        makeTask({ type: 'wechat-channel-direct-message-reply' }),
      ),
    ).toBe(true);
  });

  it('auto-send 返 sent 且回读匹配 -> ok=true', async () => {
    const executor = makeExecutorMock();
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      executor,
    );

    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(executor.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'wechat-channel',
        taskType: 'direct-message-reply',
        action: 'send',
        accountId: '4',
      }),
    );
  });

  it('auto-send 返 sent 但没有回读 -> ok=false，不能假成功', async () => {
    const service = new WechatChannelDirectMessageReplyService(
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
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('readback_failed');
  });

  it('auto-send 只返 replyVisible 但没有回读文本 -> ok=false，不能假成功', async () => {
    const service = new WechatChannelDirectMessageReplyService(
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
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('readback_failed');
  });

  it('executor 抛错 -> runtime_unavailable', async () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({ dispatchThrows: new Error('engine offline') }),
    );
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('runtime_unavailable');
  });

  it('executor 返 failed -> send_failed', async () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'failed', message: '已过期' },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('send_failed');
  });

  it('executor 返 account_not_logged_in -> account_not_logged_in', async () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: {
          status: 'account_not_logged_in',
          message: '视频号账号未登录，不能读取或回复。',
        },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('account_not_logged_in');
  });

  it('executor 返 message_missing -> target_not_found', async () => {
    const service = new WechatChannelDirectMessageReplyService(
      makeEngineMock(),
      makeExecutorMock({
        dispatchResult: { status: 'message_missing', message: '私信已过期' },
      }),
    );
    const result = await service.execute(
      makeTask({ type: 'wechat-channel-direct-message-reply' }),
      baseCtx,
    );

    expect(result.reasonCode).toBe('target_not_found');
  });
});
