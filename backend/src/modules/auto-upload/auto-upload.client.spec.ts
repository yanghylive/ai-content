import { AutoUploadClient } from './auto-upload.client';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AutoUploadClient', () => {
  it('reports needs_login when the latest real interaction task failed on a platform login page', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_COMMENT_REPLY',
            status: 'FAILED',
            config: {
              failureReason:
                '视频号账号未登录，当前页面 https://channels.weixin.qq.com/login.html',
              nextAction: '请重新登录视频号账号。',
            },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: null,
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockResolvedValue([]),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'needs_login',
        lastError: '平台页面要求重新登录（最近一次真实读取失败）',
      }),
    );
  });

  it('lets a current platform page override a stale login failure after relogin', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
            status: 'FAILED',
            config: { failureReason: '账号未登录，请重新登录。' },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: 'wechat-channel-4',
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockResolvedValue([
        {
          platform: 'wechat-channel',
          accountId: 4,
          currentUrl: 'https://channels.weixin.qq.com/platform',
        },
      ]),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl: 'https://channels.weixin.qq.com/platform',
      }),
    );
  });

  it('lets a current interaction backend page override a stale login failure', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            platform: 'wechat-channel',
            name: '视频号账号',
            config: { engineAccountId: 4, status: 'ready' },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([
          {
            accountId: '4',
            taskType: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
            status: 'FAILED',
            config: { failureReason: '账号未登录，请重新登录。' },
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const mcp = {
      getStatus: jest.fn().mockReturnValue({
        online: true,
        visibleWindow: true,
        isolated: false,
        profileKey: 'wechat-channel-4',
      }),
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockResolvedValue([
        {
          platform: 'wechat-channel',
          accountId: 4,
          currentUrl: 'https://channels.weixin.qq.com/platform/interaction/comment',
          debuggingPort: 9253,
          runtimeMode: 'persistent-cdp-browser',
          browserReused: true,
        },
      ]),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'wechat-channel',
        accountId: 4,
        status: 'ready',
        currentUrl: 'https://channels.weixin.qq.com/platform/interaction/comment',
        debuggingPort: 9253,
        runtimeMode: 'persistent-cdp-browser',
        browserReused: true,
      }),
    );
  });

  it('keeps persisted profile cookies unverified until a platform page proves login', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kaypal-auto-upload-'));
    const profileDir = join(root, 'profiles', 'douyin-1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, '.login-cookies.json'),
      JSON.stringify({
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      }),
    );
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'local-engine-1',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              status: 'expired',
              filePath: 'missing.json',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      interactionTask: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const interactionExecutor = {
      getStatus: jest.fn().mockResolvedValue({
        online: true,
        visibleWindow: true,
        isolated: false,
      }),
      listSessions: jest.fn().mockResolvedValue([]),
    };
    const client = new AutoUploadClient(
      {
        get: jest.fn((key: string) =>
          key === 'LOCAL_BROWSER_PROFILE_ROOT'
            ? join(root, 'profiles')
            : undefined,
        ),
      } as any,
      prisma as any,
      {} as any,
      interactionExecutor as any,
      { execute: jest.fn() } as any,
    );

    const result = await client.getCdpSessions();

    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        platform: 'douyin',
        accountId: 1,
        status: 'unknown',
        profileDir,
        activeProfile: true,
        lastError: undefined,
      }),
    );
  });

  it('opens interaction entries with the account persistent browser profile', async () => {
    const prisma = {
      publishAccount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'publish-account-wechat-channel',
          platform: 'wechat-channel',
          name: '视频号账号',
          config: {
            engineAccountId: 4,
            status: 'ready',
            filePath: 'wechat-channel.json',
          },
          createdAt: new Date('2026-06-07T00:00:00.000Z'),
        }),
      },
    };
    const mcp = { rpcCall: jest.fn() };
    const localBrowser = {
      getSession: jest.fn().mockReturnValue({
        page: {
          waitForLoadState: jest.fn().mockResolvedValue(undefined),
          waitForTimeout: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue({
            url: 'https://channels.weixin.qq.com/platform',
            title: '视频号助手',
            loggedIn: true,
            pageTextSample: '视频号助手 互动管理 内容管理',
          }),
          url: jest.fn().mockReturnValue('https://channels.weixin.qq.com/platform'),
        },
      }),
      captureEvidence: jest.fn().mockResolvedValue({
        path: '/tmp/wechat-entry.png',
        url: '/api/local-engine/browser/evidence/wechat-entry.png',
      }),
    };
    const interactionExecutor = {
      openAccount: jest.fn().mockResolvedValue({
        sessionKey: 'wechat-channel-4',
        currentUrl: 'https://channels.weixin.qq.com/platform',
        profileDir: '/tmp/wechat-channel-4',
        visibleWindow: true,
        cdpPort: 9253,
        browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        browserReused: true,
        runtimeMode: 'persistent-cdp-browser',
      }),
    };
    const runtime = { execute: jest.fn() };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      mcp as any,
      interactionExecutor as any,
      runtime as any,
      {} as any,
      localBrowser as any,
    );

    const result = await client.openInteractionEntry({
      accountId: 4,
      entryType: 'wechat-channel:message',
    });

    expect(interactionExecutor.openAccount).toHaveBeenCalledWith({
      platform: 'wechat-channel',
      accountId: 4,
      url: 'https://channels.weixin.qq.com/platform',
      storagePath: expect.stringContaining('wechat-channel.json'),
    });
    expect(mcp.rpcCall).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        platformName: '视频号',
        entryName: '视频号私信',
        status: 'opened',
        url: 'https://channels.weixin.qq.com/platform',
        title: '视频号助手',
        loggedIn: true,
        pageTextSample: '视频号助手 互动管理 内容管理',
        runtimeMode: 'persistent-cdp-browser',
        profileDir: '/tmp/wechat-channel-4',
        cdpPort: 9253,
        browserReused: true,
        evidence: expect.objectContaining({
          type: 'screenshot',
          path: '/tmp/wechat-entry.png',
        }),
      }),
    );
  });

  it('routes publish requests through Runtime and keeps not_integrated explicit', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              filePath: '/profiles/douyin.json',
              status: 'ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: false,
        status: 'blocked',
        reasonCode: 'not_integrated',
        userMessage: '抖音「测试视频」真实发布执行器尚未迁入 3011 Runtime，未上传到平台。',
        technicalMessage: 'uploader not migrated',
        evidence: [{ type: 'text', label: 'publish-not-integrated', createdAt: new Date().toISOString() }],
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );

    const result = await client.publishBatch([
      {
        type: 3,
        contentKind: 'video',
        title: '测试视频',
        tags: [],
        fileList: ['/tmp/video.mp4'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'platform-publish-video',
        platform: 'douyin',
        accountId: '1',
        payload: expect.objectContaining({ accountId: '1' }),
      }),
      expect.objectContaining({ sendMode: 'auto-send' }),
    );
    expect(result?.results?.[0]).toEqual(
      expect.objectContaining({
        ok: false,
        notIntegrated: true,
        message: expect.stringContaining('真实发布执行器尚未迁入 3011 Runtime'),
      }),
    );
  });

  it('keeps Runtime publish readback as commercial publish evidence', async () => {
    const prisma = {
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publish-account-douyin',
            platform: 'douyin',
            name: '抖音账号',
            config: {
              engineAccountId: 1,
              filePath: '/profiles/douyin.json',
              status: 'ready',
            },
            createdAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
    };
    const runtime = {
      execute: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: '抖音「测试视频」已提交发布，并进入发布成功/管理页。',
        technicalMessage: 'url=https://creator.douyin.com/creator-micro/content/manage',
        evidence: [
          {
            type: 'text',
            label: 'publish-readback',
            value: JSON.stringify({
              currentUrl:
                'https://creator.douyin.com/creator-micro/content/manage',
              title: '测试视频',
            }),
            createdAt: new Date().toISOString(),
          },
        ],
        readback: {
          expectedText: '测试视频',
          actualText: 'https://creator.douyin.com/creator-micro/content/manage',
          matched: true,
        },
      }),
    };
    const client = new AutoUploadClient(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      prisma as any,
      {} as any,
      {} as any,
      runtime as any,
    );

    const result = await client.publishBatch([
      {
        type: 3,
        contentKind: 'video',
        title: '测试视频',
        tags: [],
        fileList: ['/tmp/video.mp4'],
        accountIds: [1],
        accountList: ['/profiles/douyin.json'],
      },
    ]);

    expect(result?.reason).toBe('3011 Runtime 已返回平台发布回读证据。');
    expect(result?.results?.[0]).toEqual(
      expect.objectContaining({
        ok: true,
        notIntegrated: false,
        publishUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        platformUrl: 'https://creator.douyin.com/creator-micro/content/manage',
        evidence: expect.objectContaining({
          source: 'readback',
          readbackOk: true,
          reasonCode: 'success',
          publishUrl:
            'https://creator.douyin.com/creator-micro/content/manage',
        }),
      }),
    );
  });

  it('restores utf8 material names when multipart originalname is decoded as latin1', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'auto-upload-material-name-'));
    process.chdir(root);

    try {
      const client = new AutoUploadClient(
        { get: jest.fn().mockReturnValue(undefined) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const expectedName = '短视频素材-05.mp4';
      const mojibakeName = Buffer.from(expectedName, 'utf8').toString('latin1');

      const uploaded = await client.uploadMaterial({
        file: {
          buffer: Buffer.from('video'),
          originalname: mojibakeName,
        },
      });
      const materials = await client.listMaterials();

      expect(uploaded.filename).toBe(expectedName);
      expect(materials[0]).toEqual(
        expect.objectContaining({
          filename: expectedName,
        }),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('displays and previews legacy materials saved with latin1 mojibake names', async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), 'auto-upload-legacy-material-name-'));
    process.chdir(root);

    try {
      const client = new AutoUploadClient(
        { get: jest.fn().mockReturnValue(undefined) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const expectedName = '短视频素材-08.mp4';
      const mojibakeName = Buffer.from(expectedName, 'utf8').toString('latin1');
      const legacySafeName = mojibakeName.replace(/\s+/g, '-');
      const materialDir = join(root, 'data', 'materials');
      mkdirSync(materialDir, { recursive: true });
      writeFileSync(join(materialDir, legacySafeName), Buffer.from('legacy-video'));
      writeFileSync(
        join(materialDir, 'index.json'),
        JSON.stringify({
          nextId: 2,
          files: [
            {
              id: 1,
              filename: legacySafeName,
              filepath: join(materialDir, legacySafeName),
              uploadedAt: new Date('2026-06-09T00:00:00.000Z').toISOString(),
            },
          ],
        }),
      );

      const materials = await client.listMaterials();
      const preview = await client.fetchMaterialFile(expectedName);

      expect(materials[0]).toEqual(
        expect.objectContaining({
          filename: expectedName,
          filePath: join(materialDir, legacySafeName),
        }),
      );
      expect(preview.buffer.toString()).toBe('legacy-video');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
