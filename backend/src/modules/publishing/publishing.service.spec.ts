import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { PublishingService } from './publishing.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { JpagePreviewClientService } from './jpage-preview/jpage-preview-client.service';

jest.mock('./wechat-publisher/wechat-publisher.service', () => ({
  WechatPublisherService: class WechatPublisherService {},
}));
jest.mock('../auto-upload/auto-upload.service', () => ({
  AutoUploadService: class AutoUploadService {},
}));

const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const testCredentialConfig = {
  get: jest.fn(() => TEST_MASTER_KEY),
} as unknown as ConfigService;
const testCredentialEnvelope = new CredentialEnvelopeService(
  testCredentialConfig,
);

describe('PublishingService', () => {
  let service: PublishingService;
  let prisma: any;
  let wechatPublisher: {
    publish: jest.Mock;
    createOfficialDraft: jest.Mock;
    readbackOfficialDraft: jest.Mock;
    submitOfficialPublish: jest.Mock;
    getOfficialPublishStatus: jest.Mock;
  };
  let autoUploadService: { listAccounts: jest.Mock };
  let authRequestContext: {
    get: jest.Mock;
    resolveTenantId: jest.Mock;
  };
  let riskPolicyService: {
    issueHighRiskApproval: jest.Mock;
    consumeHighRiskApproval: jest.Mock;
  };
  let jpagePreviewClient: {
    normalizeBaseUrl: jest.Mock;
    ensurePrivateFile: jest.Mock;
    verifyPrivateFile: jest.Mock;
  };

  const article = (overrides: Record<string, unknown> = {}) => ({
    id: 'article-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    title: '门店文章',
    content: '完整正文',
    contentType: 'article',
    contentFormat: 'markdown',
    finalHtml: null,
    coverImage: null,
    xiaohongshuData: { sourceUrl: 'https://source.example.test/article/1' },
    updatedAt: new Date('2026-07-11T10:00:00.000Z'),
    ...overrides,
  });

  const account = (overrides: Record<string, unknown> = {}) => ({
    id: 'wechat-account-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    platform: 'wechat',
    name: '公众号',
    status: 'ready',
    appId: 'wx-app',
    apiToken: testCredentialEnvelope.encryptString(
      'token',
      'publishAccount.apiToken',
    ),
    config: { apiUrl: 'https://publisher.example.test/articles' },
    updatedAt: new Date('2026-07-11T09:00:00.000Z'),
    ...overrides,
  });

  const draftPayload = (overrides: Record<string, unknown> = {}) => ({
    articles: [
      {
        title: '门店文章',
        author: '',
        digest: '',
        content: '<p>公众号正文</p>',
        content_source_url: 'https://source.example.test/article/1',
        thumb_media_id: 'cover-media-1',
        need_open_comment: 1,
        only_fans_can_comment: 0,
        ...overrides,
      },
    ],
  });

  const verifiedJpagePreview = () => {
    const markdown = '完整正文';
    const html = '<p>公众号正文</p>';
    const markdownSha256 = createHash('sha256').update(markdown).digest('hex');
    const htmlSha256 = createHash('sha256').update(html).digest('hex');
    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          articleId: 'article-1',
          title: '门店文章',
          markdownSha256,
          htmlSha256,
        }),
      )
      .digest('hex');
    const stem = `wechat-article-1-${revision.slice(0, 12)}`;
    const file = (id: string, name: string, sha256: string) => ({
      id,
      name,
      fileType: name.endsWith('.md') ? 'markdown' : 'html',
      size: 100,
      isPublic: false,
      sha256,
      authenticatedRenderUrl: `https://jpage.cn/api/files/${id}/render`,
      tags: ['wechat-official-account', 'pre-draft-preview'],
    });
    return {
      version: 1,
      status: 'verified',
      articleId: 'article-1',
      accountId: 'jpage-account-1',
      revision,
      baseUrl: 'https://jpage.cn',
      visibility: 'private',
      tags: ['wechat-official-account', 'pre-draft-preview'],
      assetGate: 'pass',
      integratedRenderGate: 'pass',
      contentReadbackGate: 'pass',
      remoteRenderGate: 'pass',
      markdown: file('jpage-md-1', `${stem}.md`, markdownSha256),
      html: file('jpage-html-1', `${stem}.html`, htmlSha256),
      uploadedAt: '2026-07-21T12:00:00.000Z',
      remoteRenderVerifiedAt: '2026-07-21T12:01:00.000Z',
    };
  };

  beforeEach(async () => {
    prisma = {
      tenantMember: {
        findMany: jest.fn().mockResolvedValue([{ tenantId: 'tenant-1' }]),
      },
      publishAccount: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue(account()),
      },
      article: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      publishRecord: {
        create: jest.fn().mockResolvedValue({ id: 'record-1' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      agentSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operations) => Promise.all(operations)),
    };
    wechatPublisher = {
      publish: jest.fn(),
      createOfficialDraft: jest.fn(),
      readbackOfficialDraft: jest.fn(),
      submitOfficialPublish: jest.fn(),
      getOfficialPublishStatus: jest.fn(),
    };
    autoUploadService = { listAccounts: jest.fn() };
    authRequestContext = {
      get: jest.fn(() => ({
        sessionId: 'session-1',
        user: { id: 'user-1' },
      })),
      resolveTenantId: jest.fn(async () => {
        const user = authRequestContext.get().user;
        return user.kaypalLocalOnly ? `local-desktop:${user.id}` : 'tenant-1';
      }),
    };
    riskPolicyService = {
      issueHighRiskApproval: jest.fn().mockResolvedValue({
        confirmationId: 'confirmation-1',
        singleUse: true,
      }),
      consumeHighRiskApproval: jest.fn().mockResolvedValue({
        confirmed: true,
      }),
    };
    jpagePreviewClient = {
      normalizeBaseUrl: jest.fn((value: string) => value),
      ensurePrivateFile: jest.fn(),
      verifyPrivateFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingService,
        { provide: PrismaService, useValue: prisma },
        { provide: WechatPublisherService, useValue: wechatPublisher },
        { provide: AutoUploadService, useValue: autoUploadService },
        { provide: AuthRequestContextService, useValue: authRequestContext },
        { provide: RiskPolicyService, useValue: riskPolicyService },
        {
          provide: JpagePreviewClientService,
          useValue: jpagePreviewClient,
        },
        {
          provide: CredentialEnvelopeService,
          useValue: testCredentialEnvelope,
        },
      ],
    }).compile();

    service = module.get(PublishingService);
  });

  it('lists and syncs accounts only inside the current tenant and user', async () => {
    autoUploadService.listAccounts.mockResolvedValue([
      {
        id: 1,
        type: 3,
        platform: '抖音',
        filePath: 'douyin.json',
        userName: '抖音创作者中心',
        status: 1,
        statusLabel: '已登录',
      },
      {
        id: 1,
        type: 1,
        platform: '小红书',
        filePath: 'xhs.json',
        userName: '小红书创作服务平台',
        status: 1,
        statusLabel: '已登录',
      },
    ]);

    await service.getAccounts({ validate: true, force: true });

    expect(prisma.publishAccount.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
    const ids = prisma.publishAccount.upsert.mock.calls.map(
      ([input]: [any]) => input.where.id,
    );
    expect(ids).toEqual([
      expect.stringMatching(/^local-engine-[a-f0-9]{16}-1-douyin$/),
      expect.stringMatching(/^local-engine-[a-f0-9]{16}-1-xiaohongshu$/),
    ]);
    for (const [input] of prisma.publishAccount.upsert.mock.calls) {
      expect(input.create).toEqual(
        expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
      );
    }
  });

  it('deduplicates local engine account snapshots before returning public accounts', async () => {
    prisma.publishAccount.findMany.mockResolvedValueOnce([
      account({
        id: 'old-wechat-channel-1',
        platform: 'wechat-channel',
        name: '1111',
        status: 'expired',
        config: {
          source: 'local-engine',
          engineAccountId: 1,
          platformType: 2,
          filePath: 'wechat-channel-old.json',
          status: 'expired',
          sessionStatus: 'needs_login',
          lastDispatchOk: false,
        },
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      account({
        id: 'ready-wechat-channel-1',
        platform: 'wechat-channel',
        name: '1111',
        status: 'ready',
        config: {
          source: 'local-engine',
          engineAccountId: 1,
          platformType: 2,
          filePath: 'wechat-channel-ready.json',
          status: 'ready',
          sessionStatus: 'logged_in',
          lastDispatchOk: true,
        },
        updatedAt: new Date('2026-08-03T00:00:00.000Z'),
      }),
    ]);

    const accounts = await service.getAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toEqual(
      expect.objectContaining({
        id: 'ready-wechat-channel-1',
        source: 'local-engine',
        engineAccountId: 1,
        status: 'ready',
      }),
    );
  });

  it('overrides caller-supplied ownership when creating an account', async () => {
    prisma.publishAccount.create.mockResolvedValue({ id: 'account-1' });

    await service.createAccount({
      platform: 'wechat',
      name: '公众号',
      tenantId: 'attacker-tenant',
      userId: 'attacker-user',
    } as any);

    expect(prisma.publishAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        platform: 'wechat',
        name: '公众号',
      }),
    });
  });

  it.each(['update', 'delete'])(
    'blocks %s for an account outside the current owner scope',
    async (action) => {
      prisma.publishAccount.findFirst.mockResolvedValue(null);

      const operation =
        action === 'update'
          ? service.updateAccount('other-account', { name: '篡改名称' })
          : service.deleteAccount('other-account', 'confirmation-1');

      await expect(operation).rejects.toThrow('发布账号不存在');
      expect(prisma.publishAccount.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'other-account',
          tenantId: 'tenant-1',
          userId: 'user-1',
        },
      });
      expect(prisma.publishAccount.update).not.toHaveBeenCalled();
      expect(prisma.publishAccount.delete).not.toHaveBeenCalled();
    },
  );

  it('does not allow an account update to rewrite ownership', async () => {
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.publishAccount.update.mockResolvedValue(account({ name: '新名称' }));

    await service.updateAccount('wechat-account-1', {
      name: '新名称',
      tenantId: 'attacker-tenant',
      userId: 'attacker-user',
    });

    expect(prisma.publishAccount.update).toHaveBeenCalledWith({
      where: { id: 'wechat-account-1' },
      data: { name: '新名称' },
    });
  });

  it('does not reveal credentials when deleting an account', async () => {
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.publishAccount.delete.mockResolvedValue(
      account({
        apiToken: 'deleted-token',
        config: { nested: { apiKey: 'deleted-key', label: '保留' } },
      }),
    );

    const result = await service.deleteAccount(
      'wechat-account-1',
      'confirmation-1',
    );

    expect(result).not.toHaveProperty('apiToken');
    expect(result).toEqual(
      expect.objectContaining({
        hasApiToken: true,
        config: { nested: { label: '保留' } },
      }),
    );
  });

  it('issues an account deletion confirmation bound to the scoped account fingerprint', async () => {
    prisma.publishAccount.findFirst.mockResolvedValue(account());

    await service.createAccountDeleteConfirmation('wechat-account-1');

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform-account-delete',
        riskLevel: 'high',
        target: expect.stringMatching(
          /^platform-account-delete:tenant-1:user-1:session-1:wechat-account-1:[a-f0-9]{64}$/,
        ),
      }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        operator: 'user-1',
      },
    );
  });

  it('consumes the account deletion confirmation before deleting', async () => {
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.publishAccount.delete.mockResolvedValue(account());

    await service.deleteAccount('wechat-account-1', 'confirmation-1');

    expect(riskPolicyService.consumeHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'confirmation-1',
        action: 'platform-account-delete',
        target: expect.stringMatching(
          /^platform-account-delete:tenant-1:user-1:session-1:wechat-account-1:[a-f0-9]{64}$/,
        ),
      }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        operator: 'user-1',
      },
    );
    expect(prisma.publishAccount.delete).toHaveBeenCalledWith({
      where: { id: 'wechat-account-1' },
    });
  });

  it('requires an account deletion confirmation before resolving the account', async () => {
    await expect(service.deleteAccount('wechat-account-1')).rejects.toThrow(
      '一次性确认',
    );
    expect(prisma.publishAccount.findFirst).not.toHaveBeenCalled();
    expect(prisma.publishAccount.delete).not.toHaveBeenCalled();
  });

  it('encrypts account credentials before persistence and strips them from responses', async () => {
    prisma.publishAccount.create.mockImplementation(async ({ data }: any) => ({
      id: 'account-1',
      ...data,
    }));

    const result = await service.createAccount({
      platform: 'wechat',
      name: '公众号',
      apiToken: 'plain-api-token',
      config: {
        apiUrl: 'https://publisher.example.test',
        apiKey: 'plain-api-key',
        nested: { password: 'plain-password', label: 'public' },
      },
    });

    const persisted = prisma.publishAccount.create.mock.calls[0][0].data;
    expect(persisted.apiToken).toEqual(expect.stringMatching(/^enc:v1:/));
    expect(persisted.apiToken).not.toContain('plain-api-token');
    expect(persisted.config).toEqual({
      apiUrl: 'https://publisher.example.test',
      apiKey: expect.stringMatching(/^enc:v1:/),
      nested: {
        password: expect.stringMatching(/^enc:v1:/),
        label: 'public',
      },
    });
    expect(result).not.toHaveProperty('apiToken');
    expect(result).toEqual(
      expect.objectContaining({
        hasApiToken: true,
        config: {
          apiUrl: 'https://publisher.example.test',
          nested: { label: 'public' },
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('plain-');
  });

  it('keeps legacy plaintext accounts readable but blocks publish use', async () => {
    prisma.publishAccount.findMany.mockResolvedValue([
      account({
        apiToken: 'legacy-api-token',
        config: { apiKey: 'legacy-api-key', label: 'public' },
      }),
    ]);

    const accounts = await service.getAccounts();
    expect(accounts).toEqual([
      expect.objectContaining({
        hasApiToken: true,
        config: { label: 'public' },
      }),
    ]);
    expect(JSON.stringify(accounts)).not.toContain('legacy-');

    prisma.article.findFirst.mockResolvedValue(article());
    prisma.publishAccount.findFirst.mockResolvedValue(
      account({ apiToken: 'legacy-api-token' }),
    );
    await expect(
      service.publishArticle('article-1', 'wechat-account-1', 'confirmation-1'),
    ).rejects.toThrow('仍是明文');
    expect(riskPolicyService.consumeHighRiskApproval).not.toHaveBeenCalled();
  });

  it('requires replacing legacy credentials during an account update', async () => {
    prisma.publishAccount.findFirst.mockResolvedValue(
      account({ apiToken: 'legacy-api-token' }),
    );

    await expect(
      service.updateAccount('wechat-account-1', { name: '新名称' }),
    ).rejects.toThrow('重新填写 apiToken');
    expect(prisma.publishAccount.update).not.toHaveBeenCalled();
  });

  it('blocks AgentWaker WeChat articles from the legacy one-click publisher', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        wechatData: { channel: 'wechat-official-account' },
      }),
    );

    await expect(
      service.createPublishConfirmation('article-1', 'wechat-account-1'),
    ).rejects.toThrow('不能走旧的一键发布入口');
    expect(riskPolicyService.issueHighRiskApproval).not.toHaveBeenCalled();
  });

  it('issues a server-side confirmation bound to ownership and content version', async () => {
    prisma.article.findFirst.mockResolvedValue(article());
    prisma.publishAccount.findFirst.mockResolvedValue(account());

    const result = await service.createPublishConfirmation(
      'article-1',
      'wechat-account-1',
    );

    expect(result).toEqual(
      expect.objectContaining({ confirmationId: 'confirmation-1' }),
    );
    expect(prisma.article.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'article-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'publish',
        riskLevel: 'high',
        target: expect.stringMatching(
          /^publishing:article-1:wechat-account-1:/,
        ),
      }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        operator: 'user-1',
      },
    );
  });

  it('issues confirmations inside the isolated local-desktop tenant', async () => {
    authRequestContext.get.mockReturnValue({
      sessionId: 'session-local',
      user: { id: 'user-local', kaypalLocalOnly: true },
    });
    prisma.tenantMember.findMany.mockResolvedValue([]);
    prisma.article.findFirst.mockResolvedValue(
      article({
        tenantId: 'local-desktop:user-local',
        userId: 'user-local',
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(
      account({
        tenantId: 'local-desktop:user-local',
        userId: 'user-local',
      }),
    );

    await service.createPublishConfirmation('article-1', 'wechat-account-1');

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish' }),
      {
        tenantId: 'local-desktop:user-local',
        userId: 'user-local',
        sessionId: 'session-local',
        operator: 'user-local',
      },
    );
  });

  it('changes the confirmation fingerprint when the article body changes', async () => {
    prisma.article.findFirst.mockResolvedValueOnce(
      article({ content: '签票正文' }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());

    await service.createPublishConfirmation('article-1', 'wechat-account-1');
    const issuedTarget = riskPolicyService.issueHighRiskApproval.mock
      .calls[0][0].target as string;

    prisma.article.findFirst.mockResolvedValueOnce(
      article({ content: '发布前被修改' }),
    );
    riskPolicyService.consumeHighRiskApproval.mockRejectedValueOnce(
      new Error('高风险确认不匹配'),
    );

    await expect(
      service.publishArticle('article-1', 'wechat-account-1', 'confirmation-1'),
    ).rejects.toThrow('高风险确认不匹配');
    const consumedTarget =
      riskPolicyService.consumeHighRiskApproval.mock.calls[0][0].target;

    expect(consumedTarget).not.toBe(issuedTarget);
    expect(prisma.publishRecord.create).not.toHaveBeenCalled();
    expect(wechatPublisher.publish).not.toHaveBeenCalled();
  });

  it('rejects direct publishing without consuming any external action', async () => {
    await expect(
      service.publishArticle('article-1', 'wechat-account-1'),
    ).rejects.toThrow('服务端一次性确认');

    expect(prisma.article.findFirst).not.toHaveBeenCalled();
    expect(wechatPublisher.publish).not.toHaveBeenCalled();
  });

  it('does not reveal or publish another tenant article or account', async () => {
    prisma.article.findFirst.mockResolvedValue(null);

    await expect(
      service.publishArticle(
        'other-tenant-article',
        'other-tenant-account',
        'confirmation-1',
      ),
    ).rejects.toThrow('文章不存在');

    expect(prisma.article.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-tenant-article',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(riskPolicyService.consumeHighRiskApproval).not.toHaveBeenCalled();
    expect(wechatPublisher.publish).not.toHaveBeenCalled();
  });

  it('persists ownership, snapshots and provider waiting evidence', async () => {
    prisma.article.findFirst.mockResolvedValue(article());
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    wechatPublisher.publish.mockResolvedValue({
      articleId: 'platform-article-1',
      publishUrl: 'https://publisher.example.test/articles/1',
      evidence: { requestId: 'request-1' },
      readback: { matched: false, expectedText: '门店文章' },
    });

    const result = await service.publishArticle(
      'article-1',
      'wechat-account-1',
      'confirmation-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        status: 'waiting',
        publishRecordId: 'record-1',
        durableRecordId: expect.stringMatching(/^publish-/),
      }),
    );
    expect(riskPolicyService.consumeHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'confirmation-1',
        target: expect.stringMatching(
          /^publishing:article-1:wechat-account-1:/,
        ),
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
      }),
    );
    expect(prisma.publishRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        durableRecordId: expect.stringMatching(/^publish-/),
        bodySnapshot: '完整正文',
        sourceIdentity: expect.objectContaining({
          sourceId: 'article-1',
          sourceUrl: 'https://source.example.test/article/1',
        }),
        payloadJson: expect.objectContaining({
          bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    });
    expect(wechatPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://source.example.test/article/1',
      }),
    );
    expect(prisma.publishRecord.update).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: expect.objectContaining({
        status: 'pending',
        resultJson: expect.objectContaining({
          status: 'pending',
          providerArticleId: 'platform-article-1',
        }),
      }),
    });
    expect(prisma.article.updateMany).not.toHaveBeenCalled();
  });

  it('marks the scoped article published only after matched readback', async () => {
    prisma.article.findFirst.mockResolvedValue(article());
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    wechatPublisher.publish.mockResolvedValue({
      articleId: 'platform-article-2',
      publishUrl: 'https://publisher.example.test/articles/2',
      evidence: { requestId: 'request-2' },
      readback: {
        matched: true,
        expectedText: '门店文章',
        actualText: '门店文章',
      },
    });

    const result = await service.publishArticle(
      'article-1',
      'wechat-account-1',
      'confirmation-1',
    );

    expect(result).toEqual(
      expect.objectContaining({ success: true, status: 'completed' }),
    );
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'article-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      data: { status: 'published' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ content: ' ', finalHtml: ' ' }, '文章正文为空'],
    [{ xiaohongshuData: null }, '缺少有效来源链接'],
    [{ contentFormat: 'plain-text' }, '内容格式必须是 markdown 或 html'],
  ])(
    'blocks invalid article payload before confirmation consumption',
    async (overrides, message) => {
      prisma.article.findFirst.mockResolvedValue(article(overrides));
      prisma.publishAccount.findFirst.mockResolvedValue(account());

      await expect(
        service.publishArticle(
          'article-1',
          'wechat-account-1',
          'confirmation-1',
        ),
      ).rejects.toThrow(message);

      expect(riskPolicyService.consumeHighRiskApproval).not.toHaveBeenCalled();
      expect(prisma.publishRecord.create).not.toHaveBeenCalled();
      expect(wechatPublisher.publish).not.toHaveBeenCalled();
    },
  );

  it('publishes the same validated body stored in the snapshot', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({ finalHtml: '   ', content: '精确的 Markdown 正文' }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    wechatPublisher.publish.mockResolvedValue({
      articleId: 'platform-article-3',
      readback: { matched: false },
    });

    await service.publishArticle(
      'article-1',
      'wechat-account-1',
      'confirmation-1',
    );

    expect(prisma.publishRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bodySnapshot: '精确的 Markdown 正文',
      }),
    });
    expect(wechatPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        markdownContent: '精确的 Markdown 正文',
        htmlContent: undefined,
      }),
    );
  });

  it('filters publication records by current tenant and user', async () => {
    prisma.publishRecord.findMany.mockResolvedValue([
      {
        id: 'record-structured',
        status: 'pending',
        account: account({
          apiToken: 'never-return-this-token',
          config: {
            defaultThumbMediaId: 'cover-1',
            nested: {
              clientSecret: 'never-return-this-secret',
              displayName: '保留字段',
            },
          },
        }),
        errorMessage:
          'publish-record:v1:{"version":1,"platform":"wechat","accountId":"account-1","resultId":"result-1","evidence":{"requestId":"request-1"},"readback":{"matched":false}}',
      },
    ]);

    const records = await service.getRecordsByArticle('article-1');

    expect(records[0]).toEqual(
      expect.objectContaining({
        resultId: 'result-1',
        evidence: { requestId: 'request-1' },
        account: expect.objectContaining({
          hasApiToken: true,
          config: {
            defaultThumbMediaId: 'cover-1',
            nested: { displayName: '保留字段' },
          },
        }),
      }),
    );
    expect(records[0].account).not.toHaveProperty('apiToken');
    expect(prisma.publishRecord.findMany).toHaveBeenCalledWith({
      where: {
        articleId: 'article-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('uploads and persists an exact private JPage Markdown and HTML pair', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(
      account({
        id: 'jpage-account-1',
        platform: 'jpage',
        apiToken: testCredentialEnvelope.encryptString(
          'jpage-token',
          'publishAccount.apiToken',
        ),
        config: {
          baseUrl: 'https://jpage.cn',
          tags: 'wechat-official-account,pre-draft-preview',
        },
      }),
    );
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    jpagePreviewClient.ensurePrivateFile.mockImplementation(
      async (input: { name: string; content: string; tags: string[] }) => ({
        id: input.name.endsWith('.md') ? 'jpage-md-1' : 'jpage-html-1',
        name: input.name,
        fileType: input.name.endsWith('.md') ? 'markdown' : 'html',
        size: Buffer.byteLength(input.content),
        isPublic: false,
        sha256: createHash('sha256').update(input.content).digest('hex'),
        authenticatedRenderUrl: `https://jpage.cn/api/files/${input.name}/render`,
        tags: input.tags,
      }),
    );

    await service.createJpagePreviewConfirmation(
      'article-1',
      'jpage-account-1',
    );
    const result = await service.createJpagePreview(
      'article-1',
      'jpage-account-1',
      'confirmation-1',
    );

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jpage-private-preview-upload',
        target: expect.stringMatching(/^jpage-private-preview:article-1:/),
      }),
      expect.any(Object),
    );
    expect(riskPolicyService.consumeHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jpage-private-preview-upload',
        confirmationId: 'confirmation-1',
        target: riskPolicyService.issueHighRiskApproval.mock.calls[0][0].target,
      }),
      expect.any(Object),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ready: false,
        receipt: expect.objectContaining({
          status: 'content_verified',
          visibility: 'private',
          contentReadbackGate: 'pass',
          remoteRenderGate: 'pending',
        }),
      }),
    );
    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: {
        wechatData: expect.objectContaining({
          preview: expect.objectContaining({
            visibility: 'jpage-private',
            jpage: expect.objectContaining({
              markdown: expect.objectContaining({ id: 'jpage-md-1' }),
              html: expect.objectContaining({ id: 'jpage-html-1' }),
            }),
          }),
        }),
      },
    });
  });

  it('keeps official draft creation blocked before JPage remote render verification', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);

    await expect(
      service.createWechatDraftConfirmation('article-1', 'wechat-account-1'),
    ).rejects.toThrow('JPage 私有 Markdown/HTML 预览对');
    expect(prisma.publishAccount.findFirst).not.toHaveBeenCalled();
    expect(riskPolicyService.issueHighRiskApproval).not.toHaveBeenCalled();
  });

  it('records an audited remote-render verification after re-reading both private files', async () => {
    const previewReceipt = {
      ...verifiedJpagePreview(),
      status: 'content_verified',
      remoteRenderGate: 'pending',
      remoteRenderVerifiedAt: undefined,
    };
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
          preview: { jpage: previewReceipt },
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(
      account({
        id: 'jpage-account-1',
        platform: 'jpage',
        apiToken: testCredentialEnvelope.encryptString(
          'jpage-token',
          'publishAccount.apiToken',
        ),
        config: { baseUrl: 'https://jpage.cn' },
      }),
    );
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    jpagePreviewClient.verifyPrivateFile.mockImplementation(
      async (_options, fileId: string) =>
        fileId === previewReceipt.markdown.id
          ? previewReceipt.markdown
          : previewReceipt.html,
    );

    await service.createJpageRemoteRenderConfirmation('article-1');
    const result = await service.confirmJpageRemoteRender(
      'article-1',
      'confirmation-1',
    );

    expect(result.ready).toBe(true);
    expect(result.receipt).toEqual(
      expect.objectContaining({
        status: 'verified',
        remoteRenderGate: 'pass',
        remoteRenderVerifiedAt: expect.any(String),
      }),
    );
    expect(riskPolicyService.consumeHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jpage-private-preview-render-verify',
        confirmationId: 'confirmation-1',
      }),
      expect.any(Object),
    );
  });

  it('persists media id and payload when official draft readback is pending', async () => {
    const previewReceipt = verifiedJpagePreview();
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
          preview: { jpage: previewReceipt },
        },
      }),
    );
    const jpageAccount = account({
      id: 'jpage-account-1',
      platform: 'jpage',
      apiToken: testCredentialEnvelope.encryptString(
        'jpage-token',
        'publishAccount.apiToken',
      ),
      config: { baseUrl: 'https://jpage.cn' },
    });
    prisma.publishAccount.findFirst
      .mockResolvedValueOnce(jpageAccount)
      .mockResolvedValueOnce(
        account({ config: { defaultThumbMediaId: 'cover-media-1' } }),
      );
    jpagePreviewClient.verifyPrivateFile.mockImplementation(
      async (_options, fileId: string) =>
        fileId === previewReceipt.markdown.id
          ? previewReceipt.markdown
          : previewReceipt.html,
    );
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    prisma.publishRecord.findUnique.mockResolvedValue(null);
    wechatPublisher.createOfficialDraft.mockResolvedValue({
      mediaId: 'draft-media-recover',
      payload: draftPayload(),
      readback: {
        matched: false,
        expectedTitle: '门店文章',
        contentMatched: false,
        failureReason: '微信官方 API 40001: readback unavailable',
      },
    });

    const result = await service.createWechatOfficialDraft(
      'article-1',
      'wechat-account-1',
      'confirmation-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        publishRecordId: 'record-1',
        mediaId: 'draft-media-recover',
        payload: draftPayload(),
        readback: expect.objectContaining({ matched: false }),
      }),
    );
    expect(prisma.publishRecord.update).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: expect.objectContaining({
        status: 'pending',
        publishUrl: 'draft-media-recover',
        payloadJson: expect.objectContaining({ payload: draftPayload() }),
        resultJson: expect.objectContaining({
          status: 'readback_pending',
          mediaId: 'draft-media-recover',
          payload: draftPayload(),
          readback: expect.objectContaining({ matched: false }),
        }),
      }),
    });
  });

  it('issues approval and reconciles a pending draft without repeating draft/add', async () => {
    prisma.publishRecord.findFirst.mockResolvedValue({
      id: 'draft-record-pending',
      tenantId: 'tenant-1',
      userId: 'user-1',
      articleId: 'article-1',
      accountId: 'wechat-account-1',
      platform: 'wechat',
      status: 'pending',
      publishUrl: 'draft-media-recover',
      sourceIdentity: {
        title: '门店文章',
        sourceUrl: 'https://source.example.test/article/1',
      },
      bodySnapshot: '<p>公众号正文</p>',
      payloadJson: { payload: draftPayload() },
      resultJson: {
        status: 'readback_pending',
        mediaId: 'draft-media-recover',
        readback: { matched: false },
      },
      account: account(),
    });
    wechatPublisher.readbackOfficialDraft.mockResolvedValue({
      matched: true,
      expectedTitle: '门店文章',
      actualTitle: '门店文章',
      contentMatched: true,
    });

    await service.createWechatDraftReadbackConfirmation('draft-record-pending');
    const result = await service.reconcileWechatOfficialDraft(
      'draft-record-pending',
      'confirmation-1',
    );

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'publish',
        target: expect.stringMatching(
          /^wechat-draft-readback:tenant-1:user-1:session-1:draft-record-pending:draft-media-recover:/,
        ),
      }),
      expect.any(Object),
    );
    expect(riskPolicyService.consumeHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'confirmation-1',
        target: riskPolicyService.issueHighRiskApproval.mock.calls[0][0].target,
      }),
      expect.any(Object),
    );
    expect(wechatPublisher.readbackOfficialDraft).toHaveBeenCalledWith(
      'token',
      'draft-media-recover',
      draftPayload(),
    );
    expect(wechatPublisher.createOfficialDraft).not.toHaveBeenCalled();
    expect(prisma.publishRecord.update).toHaveBeenCalledWith({
      where: { id: 'draft-record-pending' },
      data: expect.objectContaining({
        status: 'draft_saved',
        resultJson: expect.objectContaining({
          status: 'draft_saved',
          readback: expect.objectContaining({ matched: true }),
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'draft_saved',
        mediaId: 'draft-media-recover',
      }),
    );
  });

  it('does not read back a draft without a reconcile confirmation', async () => {
    await expect(
      service.reconcileWechatOfficialDraft('draft-record-pending'),
    ).rejects.toThrow('一次性确认');
    expect(prisma.publishRecord.findFirst).not.toHaveBeenCalled();
    expect(wechatPublisher.readbackOfficialDraft).not.toHaveBeenCalled();
  });

  it('rejects a WeChat media id that is not a verified draft for the same article version', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    prisma.publishRecord.findMany.mockResolvedValue([]);

    await expect(
      service.createWechatOfficialPublishConfirmation(
        'article-1',
        'wechat-account-1',
        'stale-or-foreign-media-id',
      ),
    ).rejects.toThrow('不属于当前文章、账号和内容版本');
    expect(riskPolicyService.issueHighRiskApproval).not.toHaveBeenCalled();
  });

  it('keeps official publishing blocked until draft readback matched is true', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    prisma.publishRecord.findMany.mockResolvedValue([
      {
        id: 'draft-record-pending',
        bodySnapshot: '<p>公众号正文</p>',
        sourceIdentity: {
          title: '门店文章',
          sourceUrl: 'https://source.example.test/article/1',
        },
        resultJson: {
          mediaId: 'draft-media-pending',
          readback: { matched: false },
        },
      },
    ]);

    await expect(
      service.createWechatOfficialPublishConfirmation(
        'article-1',
        'wechat-account-1',
        'draft-media-pending',
      ),
    ).rejects.toThrow('尚未通过标题回读验证');
    expect(riskPolicyService.issueHighRiskApproval).not.toHaveBeenCalled();
  });

  it('issues a publish confirmation only for a verified matching WeChat draft', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    prisma.publishRecord.findMany.mockResolvedValue([
      {
        id: 'draft-record-1',
        bodySnapshot: '<p>公众号正文</p>',
        sourceIdentity: {
          title: '门店文章',
          sourceUrl: 'https://source.example.test/article/1',
        },
        resultJson: {
          mediaId: 'verified-media-id',
          readback: { matched: true },
        },
      },
    ]);

    await service.createWechatOfficialPublishConfirmation(
      'article-1',
      'wechat-account-1',
      'verified-media-id',
    );

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.stringContaining('verified-media-id'),
      }),
      expect.any(Object),
    );
  });

  it('stores terminal WeChat publication results as failed', async () => {
    prisma.publishRecord.findFirst.mockResolvedValue({
      id: 'publish-record-1',
      publishUrl: null,
      resultJson: { publishId: 'publish-job-1' },
      account: account(),
    });
    wechatPublisher.getOfficialPublishStatus.mockResolvedValue({
      publishId: 'publish-job-1',
      status: 'audit_failed',
    });

    await service.refreshWechatOfficialPublish('publish-record-1');

    expect(prisma.publishRecord.update).toHaveBeenCalledWith({
      where: { id: 'publish-record-1' },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: '微信发布终止：audit_failed',
      }),
    });
  });

  it('marks the article published after a verified official WeChat publication', async () => {
    prisma.article.findFirst.mockResolvedValue(
      article({
        finalHtml: '<p>公众号正文</p>',
        wechatData: {
          channel: 'wechat-official-account',
          sourceUrl: 'https://source.example.test/article/1',
        },
      }),
    );
    prisma.publishAccount.findFirst.mockResolvedValue(account());
    prisma.agentSession.findMany.mockResolvedValue([
      { sessionJson: { metadata: { articleId: 'article-1' } } },
    ]);
    prisma.publishRecord.findMany.mockResolvedValue([
      {
        id: 'draft-record-1',
        bodySnapshot: '<p>公众号正文</p>',
        sourceIdentity: {
          title: '门店文章',
          sourceUrl: 'https://source.example.test/article/1',
        },
        resultJson: {
          mediaId: 'verified-media-id',
          readback: { matched: true },
        },
      },
    ]);
    prisma.publishRecord.findUnique.mockResolvedValue(null);
    wechatPublisher.submitOfficialPublish.mockResolvedValue({
      publishId: 'publish-job-1',
    });
    wechatPublisher.getOfficialPublishStatus.mockResolvedValue({
      publishId: 'publish-job-1',
      status: 'published',
      articleUrl: 'https://mp.weixin.qq.com/s/verified',
    });

    await service.submitWechatOfficialPublish(
      'article-1',
      'wechat-account-1',
      'verified-media-id',
      'confirmation-1',
    );

    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'article-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      data: { status: 'published' },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
