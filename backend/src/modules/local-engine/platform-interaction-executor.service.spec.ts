import { PlatformInteractionExecutor } from './platform-interaction-executor.service';

describe('PlatformInteractionExecutor', () => {
  it('opens account entries through the persistent CDP session and loads cookiesFile state', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/content/manage',
        ),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
        debuggingPort: 9233,
        browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        browserReused: true,
        lastActivityAt: 'old',
      }),
      loadStorageStateCookies: jest.fn().mockResolvedValue(3),
    };
    const executor = new PlatformInteractionExecutor({} as any, browser as any);

    const result = await executor.openAccount({
      platform: 'douyin',
      accountId: 1,
      url: 'https://creator.douyin.com/creator-micro/content/manage',
      storagePath: '/cookies/douyin.json',
    });

    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'douyin',
      accountId: 1,
    });
    expect(browser.loadStorageStateCookies).toHaveBeenCalledWith({
      sessionKey: 'douyin-1',
      storagePath: '/cookies/douyin.json',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/content/manage',
      { waitUntil: 'domcontentloaded', timeout: 30000 },
    );
    expect(result).toEqual(
      expect.objectContaining({
        sessionKey: 'douyin-1',
        currentUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        profileDir: '/profiles/douyin-1',
        cdpPort: 9233,
        browserReused: true,
        runtimeMode: 'persistent-cdp-browser',
        loadedCookieCount: 3,
      }),
    );
  });

  it('opens public Douyin video comments for leads collected from video pages', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://www.douyin.com/video/123'),
      title: jest.fn().mockResolvedValue('抖音视频'),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      mouse: {
        wheel: jest.fn().mockResolvedValue(undefined),
      },
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
      }),
    };
    const executor = new PlatformInteractionExecutor(
      {} as any,
      browser as any,
      // 2026-09-05 fail-closed 后存量 dispatch 行为测试须经闸门：自动批准 mock 桥
      makeBridge() as any,
    );

    await executor.dispatch({
      platform: 'douyin',
      taskType: 'comment-reply',
      action: 'send',
      accountId: 1,
      targetText: '想了解加盟多少钱',
      sourceUrl: 'https://www.douyin.com/video/123',
      replyText: '可以发资料。',
    });

    expect(page.goto).toHaveBeenCalledWith('https://www.douyin.com/video/123', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    expect(page.goto).not.toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/interactive/comment',
      expect.anything(),
    );
  });

  it('keeps creator comment manager entry for non-public Douyin comment tasks', async () => {
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/interactive/comment',
        ),
      title: jest.fn().mockResolvedValue('抖音自动评论'),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({ comments: [] })
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({ comments: [] }),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      mouse: {
        wheel: jest.fn().mockResolvedValue(undefined),
      },
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
      }),
    };
    const executor = new PlatformInteractionExecutor(
      {} as any,
      browser as any,
      // 2026-09-05 fail-closed 后存量 dispatch 行为测试须经闸门：自动批准 mock 桥
      makeBridge() as any,
    );

    await executor.dispatch({
      platform: 'douyin',
      taskType: 'comment-reply',
      action: 'send',
      accountId: 1,
      targetText: '想了解加盟多少钱',
      sourceUrl: 'https://creator.douyin.com/creator-micro/interactive/comment',
      replyText: '可以发资料。',
    });

    expect(page.goto).toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/interactive/comment',
      { waitUntil: 'domcontentloaded', timeout: 30000 },
    );
  });

  it('matches Douyin page targets through compact text or contact name fallbacks', async () => {
    const page = {
      locator: jest.fn().mockReturnValue({
        innerText: jest
          .fn()
          .mockResolvedValue(
            '私信列表  装修小王  你们这个怎么收费 我想先了解一下',
          ),
      }),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);

    await expect(
      (executor as any).pageContainsInteractionTarget(
        page,
        '你们这个怎么收费？',
        '装修小王',
      ),
    ).resolves.toBe(true);
  });

  it('detects public Douyin comment rows whose reply button sits left of creator-manager layout', async () => {
    const evaluateResults = [
      {
        hasCommentSignal: true,
        visibleLoaders: 0,
        commentAreaText:
          '全部评论 开个餐饮预算多少够呀 真心想做 10月前·河南 19 分享 回复',
      },
      false,
      false,
      true,
      { found: true, scrolled: false },
      {
        status: 'target_found',
        targetText:
          '吸吸居 ... 开个餐饮预算多少够呀 真心想做 10月前·河南 19 分享 回复',
        replyRect: { x: 214, y: 966, width: 44, height: 20 },
        rootRect: { x: 217, y: 884, width: 917, height: 106 },
      },
      { opened: false, method: 'mouse' },
      {
        status: 'editor_found',
        rect: { x: 217, y: 1000, width: 600, height: 44 },
      },
      {
        status: 'editor_active',
        rect: { x: 217, y: 1000, width: 600, height: 44 },
      },
      { status: 'filled_by_dom' },
      {
        status: 'send_button_ready',
        message: '回复已输入，发送按钮可点击。',
        rect: { x: 860, y: 1006, width: 52, height: 28 },
      },
      {
        replyStillInEditor: false,
        bodyHasReply: true,
        bodyOnlyReplyVisible: true,
        targetRowHasReply: true,
        editorGone: true,
        identityVerificationRequired: false,
      },
    ];
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://www.douyin.com/video/123'),
      title: jest.fn().mockResolvedValue('抖音视频'),
      evaluate: jest.fn().mockImplementation(() => {
        if (evaluateResults.length === 0) return Promise.resolve(false);
        return Promise.resolve(evaluateResults.shift());
      }),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      mouse: {
        wheel: jest.fn().mockResolvedValue(undefined),
        move: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      },
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined),
        insertText: jest.fn().mockResolvedValue(undefined),
      },
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
    };
    const browser = {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
      }),
      captureEvidence: jest.fn().mockResolvedValue({
        path: '/tmp/douyin-public-comment.png',
        url: '/evidence/douyin-public-comment.png',
      }),
    };
    const executor = new PlatformInteractionExecutor(
      {} as any,
      browser as any,
      // 2026-09-05 fail-closed 后存量 dispatch 行为测试须经闸门：自动批准 mock 桥
      makeBridge() as any,
    );

    const result = await executor.dispatch({
      platform: 'douyin',
      taskType: 'comment-reply',
      action: 'send',
      accountId: 1,
      targetText: '开个餐饮预算多少够呀 真心想做',
      sourceUrl: 'https://www.douyin.com/video/123',
      replyText: '可以的，想了解餐饮预算的话，可以先看下门店模型和投入明细。',
    });

    expect(result.status).toBe('sent');
    expect(page.mouse.click).toHaveBeenCalledWith(236, 976);
  });

  it('keeps Douyin message page-text fallback out of executable message targets', async () => {
    const page = {
      context: jest.fn().mockReturnValue({}),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      title: jest.fn().mockResolvedValue('抖音私信管理'),
      getByText: jest.fn(),
      evaluate: jest.fn().mockResolvedValue([]),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
    };
    const browser = {
      captureEvidence: jest.fn().mockResolvedValue({
        path: '/tmp/douyin-dm-read.png',
        url: '/evidence/douyin-dm-read.png',
      }),
    };
    const executor = new PlatformInteractionExecutor({} as any, browser as any);
    jest
      .spyOn(executor as any, 'installDouyinImRouteCapture')
      .mockResolvedValue({ patterns: [], handler: jest.fn(), captures: [] });
    jest
      .spyOn(executor as any, 'detachDouyinImRouteCapture')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'installDouyinImWindowCapture')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'dismissDouyinOverlays')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'openDouyinMessagePage')
      .mockResolvedValue(undefined);
    jest.spyOn(executor as any, 'scanDouyinMessageTabs').mockResolvedValue({
      url: 'https://creator.douyin.com/creator-micro/data/following/chat',
      title: '抖音私信管理',
      totalCandidates: 0,
      messages: [],
      pageTextSample: '全部 朋友私信 陌生人私信 群消息 失主聒噪 06-14 你好啊',
    });
    jest
      .spyOn(executor as any, 'waitForDouyinMessagePageSettled')
      .mockResolvedValue({});

    const result = await (executor as any).readDouyinMessagesWithLocalBrowser(
      page,
      {
        key: 'douyin-1',
        profileDir: '/profiles/douyin-1',
        debuggingPort: 9233,
        browserReused: true,
      },
      {
        platform: 'douyin',
        taskType: 'direct-message-reply',
        accountId: 1,
        limit: 10,
      },
    );

    expect(result.messages).toEqual([]);
    expect(result.imCapture.textFallbackCount).toBeGreaterThan(0);
    expect(result.imCapture.textFallbackMessageCandidates[0]).toEqual(
      expect.objectContaining({
        text: '你好啊',
        source: 'page-text-fallback',
      }),
    );
  });

  it('does not scan Douyin group messages as direct-message reply targets', async () => {
    const page = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      title: jest.fn().mockResolvedValue('抖音私信管理'),
      evaluate: jest.fn().mockImplementation((fn: unknown, arg: unknown) => {
        if (typeof fn === 'function') {
          return Promise.resolve(
            (fn as (payload: unknown) => unknown)({
              script:
                '(limit) => ({ url: "https://creator.douyin.com/creator-micro/data/following/chat", title: "抖音私信管理", totalCandidates: 0, messages: [], pageTextSample: "全部 朋友私信 陌生人私信 群消息 老李会员资料共享群 04:40 你收到一条新类型消息，请打开抖音app查看", limit })',
              scanLimit: 10,
            }),
          );
        }
        return Promise.resolve(arg);
      }),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    jest
      .spyOn(executor as any, 'waitForDouyinMessagePageSettled')
      .mockResolvedValue({});
    const clickSpy = jest
      .spyOn(executor as any, 'clickDouyinMessageTab')
      .mockResolvedValue(true);

    const result = await (executor as any).scanDouyinMessageTabs(page, 10);

    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenNthCalledWith(1, page, '朋友私信');
    expect(clickSpy).toHaveBeenNthCalledWith(2, page, '陌生人私信');
    expect(clickSpy).not.toHaveBeenCalledWith(page, '群消息');
    expect(
      result.scannedTabs.map((tab: Record<string, unknown>) => tab.label),
    ).toEqual(['全部', '朋友私信', '陌生人私信']);
  });

  it('executes the Douyin message scan script and returns DOM messages', async () => {
    const page = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      title: jest.fn().mockResolvedValue('抖音私信管理'),
      evaluate: jest
        .fn()
        .mockImplementation((fn: unknown, payload: unknown) => {
          if (typeof fn === 'function') {
            return Promise.resolve(
              (fn as (input: unknown) => unknown)({
                ...(payload as Record<string, unknown>),
                script:
                  '(limit) => ({ url: "https://creator.douyin.com/creator-micro/data/following/chat", title: "抖音私信管理", totalCandidates: 1, messages: [{ text: "您好，想了解GEO吗？", source: "message-row" }], pageTextSample: "私信列表", limit })',
              }),
            );
          }
          return Promise.resolve(undefined);
        }),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    jest
      .spyOn(executor as any, 'waitForDouyinMessagePageSettled')
      .mockResolvedValue({});

    const result = await (executor as any).scanDouyinMessageTabs(page, 10);

    expect(result.messages).toEqual([
      expect.objectContaining({
        text: '您好，想了解GEO吗？',
        source: 'message-row',
      }),
    ]);
  });

  it('keeps scanning Douyin private-message tabs until the target contact is found', async () => {
    const page = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      title: jest.fn().mockResolvedValue('抖音私信管理'),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce({
          url: 'https://creator.douyin.com/creator-micro/data/following/chat',
          title: '抖音私信管理',
          totalCandidates: 1,
          messages: [
            {
              text: '嗨，想了解GEO吗？',
              source: 'message-row',
              contactName: '斑马T7',
            },
          ],
          pageTextSample: '陌生人私信 斑马T7 06-14 嗨，想了解GEO吗？',
        })
        .mockResolvedValueOnce({
          url: 'https://creator.douyin.com/creator-micro/data/following/chat',
          title: '抖音私信管理',
          totalCandidates: 1,
          messages: [
            {
              text: '您好像发错啦，我才是本店客服哦。',
              source: 'message-row',
              contactName: '大壮AI研究员',
            },
          ],
          pageTextSample:
            '朋友私信 大壮AI研究员 昨天 您好像发错啦，我才是本店客服哦。',
        }),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    jest
      .spyOn(executor as any, 'waitForDouyinMessagePageSettled')
      .mockResolvedValue({});
    const clickSpy = jest
      .spyOn(executor as any, 'clickDouyinMessageTab')
      .mockResolvedValue(true);

    const result = await (executor as any).scanDouyinMessageTabs(
      page,
      10,
      '当前页没有这个正文',
      '大壮AI研究员',
    );

    expect(clickSpy).toHaveBeenCalledWith(page, '朋友私信');
    expect(result.selectedTab).toBe('朋友私信');
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        contactName: '大壮AI研究员',
      }),
    );
  });

  it('can select wide Douyin message rows by target text and contact name', async () => {
    const page = {
      context: jest.fn().mockReturnValue({}),
      url: jest
        .fn()
        .mockReturnValue(
          'https://creator.douyin.com/creator-micro/data/following/chat',
        ),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      mouse: {
        click: jest.fn().mockResolvedValue(undefined),
      },
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined),
        insertText: jest.fn().mockResolvedValue(undefined),
      },
      evaluate: jest
        .fn()
        .mockResolvedValueOnce({
          status: 'target_ready',
          message: '已找到目标私信，准备真实点击会话。',
          selected: {
            text: '你好啊',
            context: '2 大壮AI研究员 04:32 你好啊',
          },
          targetClickRect: { x: 248, y: 352, width: 1240, height: 105 },
        })
        .mockResolvedValueOnce({
          status: 'editor_ready',
          message: '真实点击目标会话后已打开抖音私信输入框。',
          editorRect: { x: 320, y: 840, width: 760, height: 48 },
        }),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    jest
      .spyOn(executor as any, 'installDouyinImRouteCapture')
      .mockResolvedValue({ patterns: [], handler: jest.fn(), captures: [] });
    jest
      .spyOn(executor as any, 'detachDouyinImRouteCapture')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'installDouyinImWindowCapture')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'dismissDouyinOverlays')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'openDouyinMessagePage')
      .mockResolvedValue(undefined);
    jest
      .spyOn(executor as any, 'pageContainsInteractionTarget')
      .mockResolvedValue(true);
    jest
      .spyOn(executor as any, 'waitForDouyinMessagePageSettled')
      .mockResolvedValue({});
    jest.spyOn(executor as any, 'scanDouyinMessageTabs').mockResolvedValue({
      messages: [
        {
          text: '你好啊',
          source: 'message-preview',
          contactName: '大壮AI研究员',
        },
      ],
      totalCandidates: 1,
    });
    jest
      .spyOn(executor as any, 'collectDouyinImWindowCapture')
      .mockResolvedValue({});
    jest
      .spyOn(executor as any, 'waitForDouyinMessageEditorOrSettled')
      .mockResolvedValue(undefined);

    const result = await (executor as any).performDouyinMessageInteraction(
      page,
      {
        platform: 'douyin',
        taskType: 'direct-message-reply',
        action: 'draft',
        accountId: 1,
        targetName: '大壮AI研究员',
        targetText: '你好啊',
        replyText: '你好，请问有什么可以帮你的？',
      },
    );

    expect(page.mouse.click).toHaveBeenCalledWith(468, 404.5);
    expect(page.keyboard.insertText).toHaveBeenCalledWith(
      '你好，请问有什么可以帮你的？',
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'draft_filled',
      }),
    );
  });

  it('treats Douyin comment scans as matched when the target name is visible', () => {
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    const result = (executor as any).douyinCommentScanHasTarget(
      {
        comments: [{ text: '评论管理页里可见的回复' }],
        pageTextSample: '评论管理 装修小王 还有其他评论',
        selectedWorkTitle: '装修小王的作品',
      },
      '你们这个怎么收费？',
      '装修小王',
    );

    expect(result).toBe(true);
  });

  it('prioritizes WeChat Channel private-message tab and customer left bubbles', async () => {
    const clickOrder: string[] = [];
    let selectedTab = '打招呼消息';
    let sessionOpened = false;
    let scanExecutedViaWrapper = false;
    let waitCalls = 0;
    const makeFrameState = () => {
      if (selectedTab === '打招呼消息') {
        return '私信管理 私信 打招呼消息 全部消息 暂无打招呼消息 视频号助手 · 打招呼';
      }
      if (!sessionOpened) {
        return '私信管理 私信 打招呼消息 全部私信 共1个 大壮 06月18日 04:43 我看到你提到“收到，感谢反馈。第5轮确认。”，这块我先按你的实际情况帮你核一下，再给你明确回复。';
      }
      return '私信管理 私信 打招呼消息 全部私信 共1个 大壮 哈喽 你好在吗 发送';
    };
    const frame = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://channels.weixin.qq.com/micro/interaction/private_msg',
        ),
      evaluate: jest.fn().mockImplementation((fn: unknown, arg: unknown) => {
        const source = String(fn);
        if (
          source.includes('activeTab') &&
          source.includes('hasPrivateItems')
        ) {
          const bodyText = makeFrameState();
          return Promise.resolve({
            activeTab: selectedTab,
            bodyText,
            hasPrivateItems: /全部私信|共1个|视频号助手\s*·\s*私信/.test(
              bodyText,
            ),
            hasGreetingEmpty: /暂无打招呼消息|视频号助手\s*·\s*打招呼/.test(
              bodyText,
            ),
          });
        }
        if (
          source.includes('matchedTarget') &&
          source.includes('hasListSignal')
        ) {
          const bodyText = makeFrameState();
          return Promise.resolve({
            matchedTarget: Boolean(
              (arg as any)?.targetText &&
              bodyText.includes((arg as any).targetText),
            ),
            hasItems:
              /共1个|哈喽/.test(bodyText) && !/暂无打招呼消息/.test(bodyText),
          });
        }
        if (
          source.includes('PointerEvent') &&
          source.includes('pointerdown') &&
          source.includes('data-kaypal-message-tab-target')
        ) {
          clickOrder.push(String(arg));
          selectedTab = String(arg);
          return Promise.resolve(true);
        }
        if (source.includes('data-kaypal-message-tab-target')) {
          return Promise.resolve({
            x: 336,
            y: 154,
            width: 34,
            height: 24,
            tag: 'A',
            text: String(arg),
          });
        }
        if (source.includes('querySelector(`[data-kaypal-message-tab-target')) {
          return Promise.resolve(false);
        }
        if (
          source.includes('session-wrap') &&
          source.includes('selectedText')
        ) {
          if (selectedTab !== '私信') {
            return Promise.resolve({
              clicked: false,
              reason: 'no-session-row',
            });
          }
          sessionOpened = true;
          return Promise.resolve({
            clicked: true,
            author: '大壮',
            content:
              '我看到你提到“收到，感谢反馈。第5轮确认。”，这块我先按你的实际情况帮你核一下，再给你明确回复。',
            selectedText:
              '大壮 06月18日 04:43 我看到你提到“收到，感谢反馈。第5轮确认。”，这块我先按你的实际情况帮你核一下，再给你明确回复。',
          });
        }
        if (
          source.includes('eval') &&
          (arg as any)?.script?.includes('wechat-channel-dom-left-bubble')
        ) {
          scanExecutedViaWrapper = true;
          return Promise.resolve({
            url: 'https://channels.weixin.qq.com/micro/interaction/private_msg',
            title: '视频号助手',
            totalCandidates: sessionOpened ? 3 : 0,
            items: sessionOpened
              ? [
                  {
                    text: '哈喽',
                    author: '大壮',
                    looksLikeMessage: true,
                    messageBubble: true,
                    source: 'wechat-channel-dom-left-bubble',
                    score: 120,
                    y: 300,
                  },
                  {
                    text: '你好在吗',
                    author: '大壮',
                    looksLikeMessage: true,
                    messageBubble: true,
                    source: 'wechat-channel-dom-left-bubble',
                    score: 120,
                    y: 420,
                  },
                  {
                    text: '我看到你提到“收到，感谢反馈。第5轮确认。”，这块我先按你的实际情况帮你核一下，再给你明确回复。',
                    author: '大壮',
                    looksLikeMessage: true,
                    sessionRow: true,
                    ownReply: true,
                    source: 'wechat-channel-dom-session-row',
                    score: 60,
                  },
                ]
              : [],
            pageTextSample: makeFrameState(),
          });
        }
        if (source.includes('wechat-channel-dom-left-bubble')) {
          return Promise.resolve(undefined);
        }
        return Promise.resolve({});
      }),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      url: jest
        .fn()
        .mockReturnValue('https://channels.weixin.qq.com/platform/private_msg'),
      title: jest.fn().mockResolvedValue('视频号助手'),
      goto: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          click: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      mouse: {
        move: jest.fn().mockResolvedValue(undefined),
        click: jest.fn().mockResolvedValue(undefined),
      },
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
      on: jest.fn(),
      off: jest.fn(),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);
    jest
      .spyOn(executor as any, 'waitForWechatChannelMessageListReady')
      .mockImplementation(async () => {
        waitCalls += 1;
        return { hasRows: selectedTab === '私信', syncing: false };
      });

    const result = await (executor as any).readWechatChannelWithLocalBrowser(
      page,
      {
        key: 'wechat-channel-4',
        profileDir: '/profiles/wechat-channel-4',
        debuggingPort: 9255,
        browserReused: true,
      },
      {
        platform: 'wechat-channel',
        taskType: 'direct-message-reply',
        accountId: 4,
        limit: 10,
      },
    );

    expect(clickOrder[0]).toBe('私信');
    expect(waitCalls).toBeGreaterThanOrEqual(2);
    expect(scanExecutedViaWrapper).toBe(true);
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        text: '你好在吗',
        source: 'wechat-channel-dom-left-bubble',
      }),
    );
    expect(result.navigationState.selectedTab).toBe('私信');
  });

  it('waits for WeChat Channel private messages after sync screen', async () => {
    const states = [
      {
        syncing: true,
        empty: false,
        declaredCount: null,
        rowCount: 0,
        hasRows: false,
        bodyTextSample: '消息同步中 私信管理',
      },
      {
        syncing: false,
        empty: false,
        declaredCount: 1,
        rowCount: 1,
        hasRows: true,
        bodyTextSample: '私信管理 全部私信 共1个 大壮',
      },
    ];
    const frame = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://channels.weixin.qq.com/micro/interaction/private_msg',
        ),
      evaluate: jest
        .fn()
        .mockImplementation(() => Promise.resolve(states.shift())),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);

    const result = await (executor as any).waitForWechatChannelMessageListReady(
      page,
      5000,
    );

    expect(frame.evaluate).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        hasRows: true,
        declaredCount: 1,
      }),
    );
  });

  it('retries WeChat Channel comment send when the first click leaves the editor unchanged', async () => {
    const frameBox = { x: 10, y: 20, width: 900, height: 700 };
    const evaluateResults = [
      { clicked: false, reason: 'target-already-visible' },
      {
        status: 'editor_found',
        editorRect: { x: 100, y: 220, width: 360, height: 48 },
      },
      {
        status: 'send_button_ready',
        sendButtonText: '发送',
        sendButtonRect: { x: 480, y: 226, width: 56, height: 30 },
      },
      {
        status: 'send_failed',
        sent: false,
        message:
          '已点击发送，但输入框仍保留内容且页面未看到回复，未确认发出。attempt=1',
        editorStillHasReply: true,
        replyVisible: false,
        retryButtonRect: { x: 480, y: 226, width: 56, height: 30 },
      },
      {
        status: 'sent',
        sent: true,
        message:
          '视频号回复已点击发送，已在页面看到回复内容或输入框已清空。attempt=2',
        editorStillHasReply: false,
        replyVisible: true,
        readbackText: '可以的，我帮你确认。',
      },
    ];
    const frame = {
      url: jest
        .fn()
        .mockReturnValue(
          'https://channels.weixin.qq.com/micro/interaction/comment',
        ),
      evaluate: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(evaluateResults.shift() || {}),
        ),
      frameElement: jest.fn().mockResolvedValue({
        boundingBox: jest.fn().mockResolvedValue(frameBox),
      }),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      url: jest
        .fn()
        .mockReturnValue(
          'https://channels.weixin.qq.com/platform/interaction/comment',
        ),
      title: jest.fn().mockResolvedValue('视频号助手'),
      goto: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          click: jest.fn().mockResolvedValue(undefined),
        }),
      }),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      mouse: {
        click: jest.fn().mockResolvedValue(undefined),
        move: jest.fn().mockResolvedValue(undefined),
      },
      keyboard: {
        press: jest.fn().mockResolvedValue(undefined),
        insertText: jest.fn().mockResolvedValue(undefined),
      },
      on: jest.fn(),
      off: jest.fn(),
    };
    const executor = new PlatformInteractionExecutor({} as any, {} as any);

    const result = await (executor as any).performWechatChannelInteraction(
      page,
      {
        platform: 'wechat-channel',
        taskType: 'comment-reply',
        action: 'send',
        accountId: 4,
        targetText: '牛排岛风格呢',
        replyText: '可以的，我帮你确认。',
      },
    );

    expect(result.status).toBe('sent');
    expect(result.readbackText).toBe('可以的，我帮你确认。');
    expect(page.mouse.click).toHaveBeenCalledTimes(3);
    expect(page.mouse.click).toHaveBeenNthCalledWith(2, 518, 261);
    expect(page.mouse.click).toHaveBeenNthCalledWith(3, 518, 261);
  });

  // ---- 2026-09-05 复核 P0-2：dispatch 写链审批闸门 ----

  function makeDispatchPage(overrides: Record<string, unknown> = {}) {
    return {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://creator.douyin.com/creator-micro/home'),
      evaluate: jest.fn().mockRejectedValue(new Error('boom')),
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
        }),
      }),
      mouse: { wheel: jest.fn().mockResolvedValue(undefined) },
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
      ...overrides,
    };
  }

  function makeDispatchBrowser(page: Record<string, unknown>) {
    return {
      getOrCreateSession: jest.fn().mockResolvedValue({
        key: 'douyin-1',
        accountId: '1',
        platform: 'douyin',
        page,
        profileDir: '/profiles/douyin-1',
        visibleWindow: true,
      }),
    };
  }

  function makeBridge(overrides: Record<string, unknown> = {}) {
    return {
      requestAction: jest.fn().mockResolvedValue({
        actionId: 'act-1',
        autoApproved: true,
        binding: { webContentsId: null, method: 'Input.insertText' },
      }),
      markInteractionTicket: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  const DISPATCH_INPUT = {
    platform: 'douyin' as const,
    taskType: 'comment-reply' as const,
    action: 'send' as const,
    accountId: 1,
    targetText: '想要链接',
    replyText: '已私信你啦',
  };

  it('P0-2 闸门：system 控制自动批 → requestAction 先于写操作，单据 in_use 回写，结果带 approvalGate', async () => {
    const page = makeDispatchPage();
    const bridge = makeBridge();
    const executor = new PlatformInteractionExecutor(
      {} as any,
      makeDispatchBrowser(page) as any,
      bridge as any,
    );

    const result = await executor.dispatch(DISPATCH_INPUT);

    expect(bridge.requestAction).toHaveBeenCalledTimes(1);
    const [actor, req] = (bridge.requestAction as jest.Mock).mock.calls[0];
    expect(actor).toEqual({ ownerId: 'local-engine', tenantId: 'local-tenant' });
    expect(req.method).toBe('Input.insertText');
    expect(req.summary).toEqual(
      expect.objectContaining({
        kind: 'interaction-dispatch',
        platform: 'douyin',
        taskType: 'comment-reply',
        action: 'send',
        accountId: '1',
      }),
    );
    const statuses = (bridge.markInteractionTicket as jest.Mock).mock.calls.map(
      (c) => c[1],
    );
    expect(statuses[0]).toBe('in_use');
    expect(statuses).not.toContain('consumed');
    expect(['failed', 'account_not_logged_in']).toContain(result.status);
    expect(result.approvalGate).toBe('panel-auto');
    expect(result.approvalActionId).toBe('act-1');
  });

  it('P0-2 闸门：用户接管（非自动批）→ 挂单拒绝执行（fail-closed），不碰页面，不写单据状态', async () => {
    const page = makeDispatchPage();
    const bridge = makeBridge({
      requestAction: jest.fn().mockResolvedValue({
        actionId: 'act-2',
        autoApproved: false,
        binding: { webContentsId: null, method: 'Input.insertText' },
      }),
    });
    const browser = makeDispatchBrowser(page);
    const executor = new PlatformInteractionExecutor(
      {} as any,
      browser as any,
      bridge as any,
    );

    const result = await executor.dispatch(DISPATCH_INPUT);

    expect(result.status).toBe('failed');
    expect(result.message).toContain('需用户确认');
    expect(result.message).toContain('act-2');
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(bridge.markInteractionTicket).not.toHaveBeenCalled();
  });

  it('P0-2 闸门 fail-closed：无面板桥（默认）→ 拒绝执行外部写操作，gate-unavailable 留审计', async () => {
    delete process.env.INTERACTION_GATE_BYPASS;
    const page = makeDispatchPage();
    const prisma = {
      agentConfirmation: { create: jest.fn().mockResolvedValue({}) },
    };
    const executor = new PlatformInteractionExecutor(
      {} as any,
      makeDispatchBrowser(page) as any,
      undefined,
      prisma as any,
    );

    const result = await executor.dispatch(DISPATCH_INPUT);

    expect(result.status).toBe('failed');
    expect(result.approvalGate).toBe('gate-unavailable');
    expect(result.message).toContain('fail-closed');
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    // 会话创建发生在闸门之后：拒绝时不产生浏览器会话
    expect((executor as any).browser.getOrCreateSession).not.toHaveBeenCalled();
    // P2：拒绝路径落长期审计（AgentConfirmation，status=rejected）
    expect(prisma.agentConfirmation.create).toHaveBeenCalledTimes(1);
    const row = (prisma.agentConfirmation.create as jest.Mock).mock.calls[0][0];
    expect(row.data.status).toBe('rejected');
    expect(row.data.confirmationJson.source).toBe('interaction-gate');
    expect(row.data.confirmationJson.gate).toBe('gate-unavailable');
    // 2026-09-05 复核 P1：归属与面板确认单一致（断链防护）
    expect(row.data.tenantId).toBe('local-tenant');
    expect(row.data.userId).toBe('local-engine');
  });

  it('P0-2 闸门 fail-closed：面板桥请求异常（默认）→ 拒绝执行，不签单不回写', async () => {
    delete process.env.INTERACTION_GATE_BYPASS;
    const page = makeDispatchPage();
    const bridge = makeBridge({
      requestAction: jest.fn().mockRejectedValue(new Error('PANEL_UNAVAILABLE')),
    });
    const executor = new PlatformInteractionExecutor(
      {} as any,
      makeDispatchBrowser(page) as any,
      bridge as any,
    );

    const result = await executor.dispatch(DISPATCH_INPUT);

    expect(result.status).toBe('failed');
    expect(result.approvalGate).toBe('gate-unavailable');
    expect(result.message).toContain('fail-closed');
    expect(bridge.markInteractionTicket).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('P0-2 闸门调试旁路：INTERACTION_GATE_BYPASS=1 显式开启 → 无桥/桥异常均放行且 approvalGate 留痕', async () => {
    process.env.INTERACTION_GATE_BYPASS = '1';
    try {
      // 直接验证闸门判定本身（不走完整 dispatch DOM 流——旁路测试不测业务链）
      const noBridgeExecutor = new PlatformInteractionExecutor(
        {} as any,
        {} as any,
      );
      const bypassed = await (noBridgeExecutor as any).ensureDispatchWriteGate(
        DISPATCH_INPUT,
        'sess-1',
      );
      expect(bypassed).toEqual({
        pass: true,
        actionId: null,
        gate: 'bypassed-no-bridge',
      });

      const bridge = makeBridge({
        requestAction: jest
          .fn()
          .mockRejectedValue(new Error('PANEL_UNAVAILABLE')),
      });
      const errBypassed = await (new PlatformInteractionExecutor(
        {} as any,
        {} as any,
        bridge as any,
      ) as any).ensureDispatchWriteGate(DISPATCH_INPUT, 'sess-1');
      expect(errBypassed).toEqual({
        pass: true,
        actionId: null,
        gate: 'bypassed-bridge-error',
      });
      expect(bridge.requestAction).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.INTERACTION_GATE_BYPASS;
    }
  });
});
