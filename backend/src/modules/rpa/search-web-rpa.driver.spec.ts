import { SearchWebRpaDriver } from './search-web-rpa.driver';
import type { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';

/**
 * C 阶段：SearchWebRpaDriver 读评论动作（只读安全）。
 * capabilities 声明 read-comments supported（runtimeReady 时）；
 * reply-comment/send-direct-message 保持 unsupported（真实触达高风险，诚实声明）。
 */
describe('SearchWebRpaDriver read-comments（C 阶段）', () => {
  function makeRunner(overrides: Record<string, unknown> = {}) {
    return {
      searchByKeyword: jest.fn(),
      listAccountWorks: jest.fn(),
      probeAccount: jest.fn(),
      acquireEngineSession: jest.fn().mockResolvedValue('kuaishou-ks-1'),
      searchRecommended: jest.fn(),
      readComments: jest.fn().mockResolvedValue(
        overrides.readComments ?? [
          {
            platform: 'kuaishou',
            accountId: 'browser-session',
            sourceContent: {
              externalContentId: 'v1',
              url: 'https://www.kuaishou.com/video/v1',
              contentType: 'video',
              title: '装修案例',
              rawHash: 'h1',
            },
            interactionEvents: [
              {
                externalEventId: 'c1',
                type: 'comment',
                text: '这个价格怎么算的？',
                sourceUrl: 'https://www.kuaishou.com/video/v1',
                occurredAt: new Date().toISOString(),
              },
            ],
          },
        ],
      ),
    } as unknown as DiscoveryBrowserRunner;
  }

  function makeDriver(runner: unknown) {
    return new SearchWebRpaDriver(
      'kuaishou',
      '快手RPA',
      runner as DiscoveryBrowserRunner,
    );
  }

  it('capabilities 声明 read-comments/reply-comment 支持（runtimeReady 时），send 保持 unsupported', async () => {
    const driver = makeDriver(makeRunner());
    const caps = await driver.capabilities();
    const readComments = caps.actions.find((a) => a.action === 'read-comments');
    const reply = caps.actions.find((a) => a.action === 'reply-comment');
    const send = caps.actions.find((a) => a.action === 'send-direct-message');
    expect(readComments?.supported).toBe(true);
    expect(reply?.supported).toBe(true);
    expect(send?.supported).toBe(false);
    expect(send?.unavailableReasonCode).toBe('unsupported');
  });

  it('reply-comment：缺目标评论或话术 → parse_failed', async () => {
    const runner = makeRunner();
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'reply-comment',
      action: 'reply-comment',
      input: { replyText: '你好' },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('parse_failed');
  });

  it('reply-comment：dryRun=true 成功返回（不发送）', async () => {
    const runner = makeRunner();
    (runner.replyComment as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      sent: false,
      message: '回复话术已填入，dry-run 未发送（等待人工确认）',
    });
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'reply-comment',
      action: 'reply-comment',
      input: {
        targetText: '怎么收费',
        replyText: '可以交流一下',
        sourceUrl: 'https://www.kuaishou.com/short-video/1',
        dryRun: true,
      },
    });

    expect(result.status).toBe('success');
    expect(runner.replyComment).toHaveBeenCalledWith(
      expect.objectContaining({
        targetText: '怎么收费',
        replyText: '可以交流一下',
        dryRun: true,
      }),
    );
  });

  it('capabilities 在浏览器会话未就绪时 read-comments 也 unsupported（no_browser_session）', async () => {
    const driver = new SearchWebRpaDriver(
      'kuaishou',
      '快手RPA',
      undefined as unknown as DiscoveryBrowserRunner,
    );
    const caps = await driver.capabilities();
    const readComments = caps.actions.find((a) => a.action === 'read-comments');
    expect(readComments?.supported).toBe(false);
    expect(readComments?.unavailableReasonCode).toBe('no_browser_session');
  });

  it('read-comments 成功 → items 携带评论文本与来源内容', async () => {
    const runner = makeRunner();
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: { contentUrl: 'https://www.kuaishou.com/video/v1', limit: 20 },
    });

    expect(result.status).toBe('success');
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0].text).toBe('这个价格怎么算的？');
    expect(result.items?.[0].url).toBe('https://www.kuaishou.com/video/v1');
    expect(runner.readComments).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'kuaishou',
        contentUrl: 'https://www.kuaishou.com/video/v1',
      }),
    );
  });

  it('缺 contentUrl → parse_failed（不伪装空结果）', async () => {
    const driver = makeDriver(makeRunner());
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: {},
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('parse_failed');
  });

  it('评论区无评论 → parse_failed（页面未找到 ≠ 空结果）', async () => {
    const driver = makeDriver(makeRunner({ readComments: [] }));
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: { contentUrl: 'https://www.kuaishou.com/video/v1' },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('parse_failed');
  });

  it('runner.readComments 抛错 → 驱动层按错误分类返回 failed', async () => {
    const runner = makeRunner();
    (runner.readComments as jest.Mock).mockRejectedValue(
      new Error('captcha required'),
    );
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: { contentUrl: 'https://www.kuaishou.com/video/v1' },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('captcha_required');
  });
  it('capabilities 带 accountId → 调用 runner.probeAccount 并返回账号级状态', async () => {
    const runner = makeRunner();
    (runner.probeAccount as jest.Mock) = jest.fn().mockResolvedValue({
      browserReady: true,
      loggedIn: true,
      pageInteractive: true,
      captchaRequired: false,
      riskControl: false,
      reasonCode: null,
    });
    const driver = makeDriver(runner);
    const caps = await driver.capabilities({ accountId: 'xhs-1' });
    expect(runner.probeAccount).toHaveBeenCalledWith('kuaishou', 'xhs-1');
    expect(caps.accountProbe).toMatchObject({
      accountId: 'xhs-1',
      loggedIn: true,
      captchaRequired: false,
      riskControl: false,
    });
  });

  it('capabilities 不带 accountId → 无 accountProbe（兼容旧调用）', async () => {
    const runner = makeRunner();
    const driver = makeDriver(runner);
    const caps = await driver.capabilities();
    expect(caps.accountProbe).toBeUndefined();
    expect(runner.probeAccount).not.toHaveBeenCalled();
  });

  it('read-comments 候选缺真实内容 ID/URL → parse_failed（P0-1 禁止 randomUUID 伪造平台 ID）', async () => {
    const runner = makeRunner({
      readComments: [
        {
          platform: 'kuaishou',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: '',
            url: '',
            contentType: 'video',
          },
          interactionEvents: [
            {
              externalEventId: 'c1',
              type: 'comment',
              text: '评论无真实内容',
              sourceUrl: '',
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: { contentUrl: 'https://www.kuaishou.com/video/v1' },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('parse_failed');
    expect(result.message).toContain('缺少真实内容 ID/URL');
    // 禁止 randomUUID 伪造：无任何 items
    expect(result.items ?? []).toHaveLength(0);
  });

  it('read-comments 部分候选缺 ID → 整体 parse_failed 待人工（不混入成功）', async () => {
    const runner = makeRunner({
      readComments: [
        {
          platform: 'kuaishou',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: 'v1',
            url: 'https://www.kuaishou.com/video/v1',
            contentType: 'video',
            rawHash: 'h1',
          },
          interactionEvents: [
            {
              externalEventId: 'c1',
              type: 'comment',
              text: '真实评论',
              sourceUrl: 'https://www.kuaishou.com/video/v1',
              occurredAt: new Date().toISOString(),
            },
          ],
        },
        {
          platform: 'kuaishou',
          accountId: 'browser-session',
          sourceContent: { externalContentId: '', url: '', contentType: 'video' },
          interactionEvents: [
            {
              externalEventId: 'c2',
              type: 'comment',
              text: '缺真实 ID',
              sourceUrl: '',
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'read-comments',
      action: 'read-comments',
      input: { contentUrl: 'https://www.kuaishou.com/video/v1' },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('parse_failed');
    expect(result.message).toContain('整体判失败待人工核对');
  });

  it('discover-keyword 返回 recommendedFallback → search_not_rendered（P0-2 不降级推荐流冒充关键词）', async () => {
    const runner = makeRunner();
    (runner.searchByKeyword as jest.Mock).mockResolvedValue([
      {
        platform: 'kuaishou',
        accountId: 'browser-session',
        sourceContent: {
          externalContentId: 'r1',
          url: 'https://www.kuaishou.com/short-video/r1',
          contentType: 'video',
          rawHash: 'h1',
        },
        recommendedFallback: true,
      },
    ]);
    const driver = makeDriver(runner);
    const session = await driver.openSession({
      userId: 'user-1',
      accountId: 'ks-1',
      runId: 'run-1',
    });

    const result = await driver.execute(session, {
      name: 'discover-keyword',
      action: 'discover-keyword',
      input: { keyword: '装修', limit: 20 },
    });

    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('search_not_rendered');
    expect(result.message).toContain('不降级推荐流冒充关键词结果');
  });
});

describe('SearchWebRpaDriver 会话关闭归属确认（前端审计第 6 项复核）', () => {
  function makeCloseRunner() {
    return {
      closeSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as DiscoveryBrowserRunner;
  }

  function makeCloseDriver(runner: unknown) {
    return new SearchWebRpaDriver(
      'kuaishou',
      '快手RPA',
      runner as DiscoveryBrowserRunner,
    );
  }

  it('engineSessionKey 与当前 key 不一致（会话被替换）→ 抛 close_failed 不误杀', async () => {
    const runner = makeCloseRunner();
    const driver = makeCloseDriver(runner);
    await expect(
      driver.closeSession({
        sessionId: 's1',
        platform: 'kuaishou',
        accountId: 'ks-1',
        engineSessionKey: 'kuaishou-ks-other', // 被替换的会话
        pageAvailable: true,
      }),
    ).rejects.toThrow('close_failed');
    expect(runner.closeSession).not.toHaveBeenCalled();
  });

  it('engineSessionKey 匹配 → 正常关闭', async () => {
    const runner = makeCloseRunner();
    const driver = makeCloseDriver(runner);
    await driver.closeSession({
      sessionId: 's1',
      platform: 'kuaishou',
      accountId: 'ks-1',
      engineSessionKey: 'kuaishou-ks-1',
      pageAvailable: true,
    });
    expect(runner.closeSession).toHaveBeenCalledWith('kuaishou', 'ks-1');
  });

  it('engineSessionKey 缺失（旧调用）→ 回退按 key 关闭（兼容）', async () => {
    const runner = makeCloseRunner();
    const driver = makeCloseDriver(runner);
    await driver.closeSession({
      sessionId: 's1',
      platform: 'kuaishou',
      accountId: 'ks-1',
      pageAvailable: true,
    });
    expect(runner.closeSession).toHaveBeenCalledWith('kuaishou', 'ks-1');
  });
});

describe('SearchWebRpaDriver 回复证据透传（全面审查 P0-1 复核）', () => {
  it('reply-comment 成功 → evidenceUrl 透传（finalize 证据门禁可过）', async () => {
    const runner = {
      replyComment: jest.fn().mockResolvedValue({
        ok: true,
        sent: true,
        message: '已发送',
        evidenceUrl: '/api/local-engine/browser/evidence/shot-1.png',
      }),
      acquireEngineSession: jest.fn().mockResolvedValue('kuaishou-ks-1'),
      closeSession: jest.fn(),
    } as unknown as DiscoveryBrowserRunner;
    const driver = new SearchWebRpaDriver(
      'kuaishou',
      '快手RPA',
      runner as never,
    );
    const session = {
      sessionId: 's1',
      platform: 'kuaishou' as const,
      accountId: 'ks-1',
      pageAvailable: true,
      engineSessionKey: 'kuaishou-ks-1',
    };

    const result = await (driver as any).runStep(session, 'reply-comment', {
      sourceUrl: 'https://www.kuaishou.com/short-video/1',
      targetText: '怎么收费',
      replyText: '可以交流',
      dryRun: false,
      userId: 'u1',
    });

    expect(result.status).toBe('success');
    // P0 复核：证据 URL 透传（原 evidenceUrl: undefined → finalize 门禁必降级）
    expect(result.evidenceUrl).toBe(
      '/api/local-engine/browser/evidence/shot-1.png',
    );
  });
});
