import { Test } from '@nestjs/testing';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from '../local-engine/xiaohongshu-interaction.executor';
import { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import {
  DouyinInteractionAdapter,
  InteractionAdapterRegistrar,
  KuaishouInteractionAdapter,
  WechatChannelInteractionAdapter,
  XiaohongshuInteractionAdapter,
} from './builtin-adapters';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

describe('内置互动适配器', () => {
  let registry: InteractionAdapterRegistry;

  const executorMock = { dispatch: jest.fn() };
  const xhsMock = { readComments: jest.fn(), replyComment: jest.fn() };
  const runnerMock = { readComments: jest.fn(), replyComment: jest.fn() };
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
        { provide: DiscoveryBrowserRunner, useValue: runnerMock },
        DouyinInteractionAdapter,
        WechatChannelInteractionAdapter,
        XiaohongshuInteractionAdapter,
        KuaishouInteractionAdapter,
        InteractionAdapterRegistrar,
      ],
    }).compile();
    await moduleRef.init();
    registry = moduleRef.get(InteractionAdapterRegistry);
  });

  it('启动时注册抖音/视频号/小红书/快手四个 adapter', () => {
    expect(registry.listPlatforms().sort()).toEqual([
      'douyin',
      'kuaishou',
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

  it('抖音 send 透传证据 URL（evidenceUrl，P0-6 证据链）', async () => {
    executorMock.dispatch.mockResolvedValue({
      status: 'sent',
      message: 'ok',
      evidenceUrl: 'http://127.0.0.1:3011/evidence/xxx.png',
      readbackText: '{"reply":"私信我"}',
    });
    const adapter = registry.get('douyin');
    const result = await adapter.send?.({
      platform: 'douyin',
      taskType: 'comment-reply',
      accountId: 1,
      targetText: '怎么买',
      sourceText: '怎么买',
      replyText: '私信我',
    });
    expect(result?.evidenceUrl).toBe('http://127.0.0.1:3011/evidence/xxx.png');
    expect(result?.readbackText).toBe('{"reply":"私信我"}');
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

  it('小红书 send 透传回读文本与截图证据（不再假成功，P0-1 修复）', async () => {
    xhsMock.replyComment.mockResolvedValue({
      status: 'sent',
      message: '评论回复已发送',
      readbackText: '私信你',
      evidenceUrl: 'http://127.0.0.1:3011/evidence/xhs.png',
    });
    const adapter = registry.get('xiaohongshu');
    const result = await adapter.send?.({
      platform: 'xiaohongshu',
      taskType: 'comment-reply',
      accountId: 3,
      targetText: '多少钱',
      commentRef: '0',
      replyText: '私信你',
    });
    expect(result?.status).toBe('sent');
    expect(result?.readbackText).toBe('私信你');
    expect(result?.evidenceUrl).toBe('http://127.0.0.1:3011/evidence/xhs.png');
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

  it('快手 read 委托 runner.readComments，映射为 InteractionItem', async () => {
    runnerMock.readComments.mockResolvedValue([
      {
        platform: 'kuaishou',
        accountId: '9',
        sourceContent: {
          externalContentId: 'vid-1',
          url: 'https://kuaishou.com/v/1',
          contentType: 'video',
          title: '快手作品',
          rawHash: 'h1',
        },
        interactionEvents: [
          {
            externalEventId: 'evt-1',
            type: 'comment',
            authorExternalId: 'author-1',
            text: '怎么买？',
            sourceUrl: 'https://kuaishou.com/v/1',
            occurredAt: '2026-09-05T00:00:00Z',
          },
        ],
        identityHint: { nickname: '买家甲', externalUserId: 'author-1' },
      },
    ]);
    const adapter = registry.get('kuaishou');
    const result = await adapter.read?.({
      platform: 'kuaishou',
      taskType: 'comment-reply',
      accountId: 9,
      contentUrl: 'https://kuaishou.com/v/1',
      keyword: '副业',
    });
    expect(runnerMock.readComments).toHaveBeenCalledTimes(1);
    expect(runnerMock.readComments.mock.calls[0][0]).toMatchObject({
      platform: 'kuaishou',
      contentUrl: 'https://kuaishou.com/v/1',
      keyword: '副业',
    });
    expect(result?.items).toEqual([
      {
        text: '怎么买？',
        authorName: '买家甲',
        authorId: 'author-1',
        ref: 'evt-1',
        videoUrl: 'https://kuaishou.com/v/1',
      },
    ]);
    expect(result?.title).toBe('快手作品');
  });

  it('快手 send 委托 runner.replyComment，sent=true 映射为 sent + 证据透传', async () => {
    runnerMock.replyComment.mockResolvedValue({
      ok: true,
      sent: true,
      message: '评论回复已发送',
      evidenceUrl: 'http://127.0.0.1:3011/evidence/ks.png',
    });
    const adapter = registry.get('kuaishou');
    const result = await adapter.send?.({
      platform: 'kuaishou',
      taskType: 'comment-reply',
      accountId: 9,
      targetText: '怎么买？',
      contentUrl: 'https://kuaishou.com/v/1',
      keyword: '副业',
      replyText: '私信你',
    });
    expect(runnerMock.replyComment).toHaveBeenCalledTimes(1);
    expect(runnerMock.replyComment.mock.calls[0][0]).toMatchObject({
      platform: 'kuaishou',
      contentUrl: 'https://kuaishou.com/v/1',
      targetText: '怎么买？',
      replyText: '私信你',
    });
    expect(result?.status).toBe('sent');
    expect(result?.evidenceUrl).toBe('http://127.0.0.1:3011/evidence/ks.png');
  });

  it('快手 supportsReadback 已从 false 提升为 true（接 runner 后真实支持）', () => {
    expect(registry.getCapability('kuaishou')?.supportsReadback).toBe(true);
  });
});
