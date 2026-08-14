import { Test } from '@nestjs/testing';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from '../local-engine/xiaohongshu-interaction.executor';
import {
  DouyinInteractionAdapter,
  InteractionAdapterRegistrar,
  WechatChannelInteractionAdapter,
  XiaohongshuInteractionAdapter,
} from './builtin-adapters';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

describe('内置互动适配器', () => {
  let registry: InteractionAdapterRegistry;

  const executorMock = { dispatch: jest.fn() };
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const autoUploadMock = {
    readDouyinComments: jest.fn(),
    readDouyinMessages: jest.fn(),
    readWechatChannelComments: jest.fn(),
    readWechatChannelMessages: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InteractionAdapterRegistry,
        { provide: AutoUploadService, useValue: autoUploadMock },
        { provide: PlatformInteractionExecutor, useValue: executorMock },
        { provide: XiaohongshuInteractionExecutor, useValue: xhsMock },
        DouyinInteractionAdapter,
        WechatChannelInteractionAdapter,
        XiaohongshuInteractionAdapter,
        InteractionAdapterRegistrar,
      ],
    }).compile();
    await moduleRef.init();
    registry = moduleRef.get(InteractionAdapterRegistry);
  });

  it('启动时注册抖音/视频号/小红书三个 adapter', () => {
    expect(registry.listPlatforms().sort()).toEqual([
      'douyin',
      'wechat-channel',
      'xiaohongshu',
    ]);
  });

  it('能力声明如实反映各平台支持的任务', () => {
    expect(registry.getCapability('douyin')?.supportedTasks).toEqual([
      'comment-reply',
      'direct-message-reply',
    ]);
    expect(registry.getCapability('xiaohongshu')?.supportedTasks).toEqual([
      'comment-reply',
    ]);
    expect(registry.getCapability('wechat-channel')?.supportsReadback).toBe(true);
  });

  it('抖音 send 委托 dispatch，status=sent 映射为 sent', async () => {
    executorMock.dispatch.mockResolvedValue({ status: 'sent', message: 'ok' });
    const adapter = registry.get('douyin');
    const result = await adapter.send?.({
      platform: 'douyin',
      taskType: 'comment-reply',
      accountId: 1,
      targetText: '怎么买',
      sourceText: '怎么买',
      replyText: '私信我',
    });
    expect(executorMock.dispatch).toHaveBeenCalledTimes(1);
    expect(executorMock.dispatch.mock.calls[0][0]).toMatchObject({
      taskType: 'comment-reply',
      action: 'send',
      replyText: '私信我',
    });
    expect(result?.status).toBe('sent');
  });

  it('小红书 send 委托 replyComment，commentRef 映射为 commentIndex', async () => {
    xhsMock.replyComment.mockResolvedValue({ status: 'sent', message: 'ok' });
    const adapter = registry.get('xiaohongshu');
    const result = await adapter.send?.({
      platform: 'xiaohongshu',
      taskType: 'comment-reply',
      accountId: 3,
      targetText: '多少钱',
      commentRef: '2',
      replyText: '私信你',
    });
    expect(xhsMock.replyComment).toHaveBeenCalledTimes(1);
    expect(xhsMock.replyComment.mock.calls[0][0]).toMatchObject({
      commentIndex: 2,
      content: '私信你',
    });
    expect(result?.status).toBe('sent');
  });

  it('抖音 read 按 taskType 分派评论/私信读取，统一为 InteractionItem', async () => {
    autoUploadMock.readDouyinComments.mockResolvedValue({
      comments: [{ text: ' 怎么买？ ' }, { text: '' }],
    });
    const adapter = registry.get('douyin');
    const result = await adapter.read?.({
      platform: 'douyin',
      taskType: 'comment-reply',
      accountId: 1,
    });
    expect(autoUploadMock.readDouyinComments).toHaveBeenCalledTimes(1);
    expect(result?.items).toEqual([{ text: '怎么买？' }]);
  });

  it('重复注册同一平台抛错', () => {
    const dup = new DouyinInteractionAdapter(
      autoUploadMock as unknown as AutoUploadService,
      executorMock as unknown as PlatformInteractionExecutor,
    );
    expect(() => registry.register(dup)).toThrow(/重复注册/);
  });
});
