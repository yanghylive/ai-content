import { Test } from '@nestjs/testing';
import { XiaohongshuInteractionExecutor } from './xiaohongshu-interaction.executor';
import { LocalBrowserEngine } from './local-browser-engine.service';

describe('XiaohongshuInteractionExecutor', () => {
  const browserMock = {
    getOrCreateSession: jest.fn(),
    captureEvidence: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        XiaohongshuInteractionExecutor,
        { provide: LocalBrowserEngine, useValue: browserMock },
      ],
    }).compile();
  });

  function makePage(url: string) {
    return {
      url: jest.fn().mockReturnValue(url),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn(),
    } as never;
  }

  it('readComments 在通知页抓取评论（含 index/nickname）', async () => {
    const page = makePage('https://www.xiaohongshu.com/notification');
    browserMock.getOrCreateSession.mockResolvedValue({
      key: 'xiaohongshu-3',
      page,
    });
    const mocked = page as never as {
      evaluate: jest.Mock;
    };
    mocked.evaluate.mockImplementation(async (fn: (max: number) => unknown) => {
      // 模拟 evaluate 在浏览器环境执行（用 mock 数据替代 DOM 操作）
      return [
        {
          commentId: 'c1',
          nickname: '用户A',
          content: '这个怎么买呀？',
          index: 0,
        },
        {
          commentId: 'c2',
          nickname: '用户B',
          content: '哈哈哈学到了',
          index: 1,
        },
      ];
    });

    const executor = new XiaohongshuInteractionExecutor(browserMock as never);
    const result = await executor.readComments({ accountId: 3, limit: 10 });

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].nickname).toBe('用户A');
    expect(result.comments[0].index).toBe(0);
    expect(browserMock.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'xiaohongshu',
      accountId: 3,
    });
  });

  it('readComments 非通知页先导航', async () => {
    const page = makePage('https://www.xiaohongshu.com/explore');
    const pageMock = page as never as { goto: jest.Mock; url: jest.Mock };
    browserMock.getOrCreateSession.mockResolvedValue({ key: 'k', page });
    const mocked = page as never as { evaluate: jest.Mock };
    mocked.evaluate.mockResolvedValue([]);

    const executor = new XiaohongshuInteractionExecutor(browserMock as never);
    await executor.readComments({ accountId: 1 });

    expect(pageMock.url).toHaveBeenCalled();
    expect(pageMock.goto).toHaveBeenCalledWith(
      'https://www.xiaohongshu.com/notification',
      expect.anything(),
    );
  });

  it('replyComment 成功返回 sent（含回读文本 + 截图证据，P0-1 修复）', async () => {
    const page = makePage('https://www.xiaohongshu.com/notification');
    browserMock.getOrCreateSession.mockResolvedValue({ key: 'k', page });
    const mocked = page as never as { evaluate: jest.Mock };
    mocked.evaluate.mockResolvedValue({
      ok: true,
      cleared: true,
      message: 'sent',
    });
    browserMock.captureEvidence.mockResolvedValue({
      path: '/tmp/xhs.png',
      url: '/api/local-engine/browser/evidence/xhs.png',
    });

    const executor = new XiaohongshuInteractionExecutor(browserMock as never);
    const result = await executor.replyComment({
      accountId: 1,
      commentIndex: 2,
      content: '私信你啦～',
    });

    expect(result.status).toBe('sent');
    expect(result.readbackText).toBe('私信你啦～');
    expect(result.evidenceUrl).toBe(
      '/api/local-engine/browser/evidence/xhs.png',
    );
    // evaluate 收到 index 和 content
    expect(mocked.evaluate.mock.calls[0][1]).toEqual({
      index: 2,
      content: '私信你啦～',
    });
  });

  it('replyComment 发送后输入框未清空 → 判 failed（不假成功）', async () => {
    const page = makePage('https://www.xiaohongshu.com/notification');
    browserMock.getOrCreateSession.mockResolvedValue({ key: 'k', page });
    const mocked = page as never as { evaluate: jest.Mock };
    mocked.evaluate.mockResolvedValue({
      ok: true,
      cleared: false,
      message: '发送后输入框未清空（疑似未生效）',
    });

    const executor = new XiaohongshuInteractionExecutor(browserMock as never);
    const result = await executor.replyComment({
      accountId: 1,
      commentIndex: 2,
      content: '私信你啦～',
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('未清空');
  });

  it('replyComment 失败返回 failed', async () => {
    const page = makePage('https://www.xiaohongshu.com/notification');
    browserMock.getOrCreateSession.mockResolvedValue({ key: 'k', page });
    const mocked = page as never as { evaluate: jest.Mock };
    mocked.evaluate.mockResolvedValue({
      ok: false,
      message: '该通知没有回复入口',
    });

    const executor = new XiaohongshuInteractionExecutor(browserMock as never);
    const result = await executor.replyComment({
      accountId: 1,
      commentIndex: 5,
      content: '你好',
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('回复入口');
  });
});
