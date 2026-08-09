import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  DURABLE_PUBLISH_RECORD_TASK_TYPE,
  PublishRecordStore,
} from './publish-record.store';

describe('PublishRecordStore tenant scope', () => {
  function setup() {
    const prisma = {
      tenantMember: {
        findMany: jest.fn(async () => [{ tenantId: 'tenant-a' }]),
      },
      runtimeExecution: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
      },
    };
    const context = new AuthRequestContextService();
    const store = new PublishRecordStore(prisma as never, context);
    return { context, prisma, store };
  }

  it('limits publish history to the authenticated tenant and user', async () => {
    const { context, prisma, store } = setup();

    await context.run({ user: { id: 'user-a' } }, async () => store.list(25));

    expect(prisma.runtimeExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
          tenantId: 'tenant-a',
          userId: 'user-a',
        },
      }),
    );
  });

  it('uses an isolated desktop tenant for a local-only account', async () => {
    const { context, prisma, store } = setup();
    prisma.tenantMember.findMany.mockResolvedValueOnce([]);

    await context.run(
      { user: { id: 'local-user', kaypalLocalOnly: true } },
      async () => store.findByPublicId(123),
    );

    expect(prisma.runtimeExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'local-desktop:local-user',
          userId: 'local-user',
        }),
      }),
    );
  });

  it('rejects publish history reads without an authenticated actor', async () => {
    const { store } = setup();

    await expect(store.list(25)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('searches and paginates scoped history beyond 200 records', async () => {
    const context = new AuthRequestContextService();
    const rows = Array.from({ length: 240 }, (_, index) => ({
      id: `row-${index}`,
      tenantId: index === 239 ? 'tenant-b' : 'tenant-a',
      userId: index === 239 ? 'user-b' : 'user-a',
      relatedId: String(index + 1),
      relatedType: 'agent-session',
      executor: 'local-runtime',
      platform: '抖音',
      taskType: DURABLE_PUBLISH_RECORD_TASK_TYPE,
      accountId: `account-${index}`,
      ok: false,
      status: 'waiting',
      reasonCode: 'readback_failed',
      userMessage: '等待平台确认',
      technicalMessage: null,
      runtimeJson: {
        source: 'durable_publish_record',
        version: 1,
        title: index === 225 ? '跨越二百条的目标文章' : `文章 ${index}`,
        platformType: 3,
        accountFile: `账号 ${index}`,
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
      },
      evidenceJson: [],
      readbackJson: null,
      agentSSessionId: null,
      engineUrl: null,
      createdAt: new Date(2026, 0, 1, 0, 0, index),
    }));
    const prisma = {
      tenantMember: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => [
          {
            tenantId: where.userId === 'user-a' ? 'tenant-a' : 'tenant-b',
          },
        ]),
      },
      runtimeExecution: {
        findMany: jest.fn(
          async ({ where }: { where: Record<string, string> }) =>
            rows.filter(
              (row) =>
                row.taskType === where.taskType &&
                row.tenantId === where.tenantId &&
                row.userId === where.userId,
            ),
        ),
      },
    };
    const store = new PublishRecordStore(prisma as never, context);

    const result = await context.run({ user: { id: 'user-a' } }, () =>
      store.listPage({ page: 1, pageSize: 20, search: '目标文章' }),
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.envelope.title).toBe('跨越二百条的目标文章');
    expect(prisma.runtimeExecution.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it('keeps the article as draft until verified readback and blocks another tenant', async () => {
    const context = new AuthRequestContextService();
    let runtimeRow: Record<string, any> | null = null;
    const prisma = {
      tenantMember: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => [
          {
            tenantId: where.userId === 'user-a' ? 'tenant-a' : 'tenant-b',
          },
        ]),
      },
      runtimeExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
          runtimeRow = { id: 'runtime-1', ...data };
          return runtimeRow;
        }),
        update: jest.fn(async ({ data }: { data: Record<string, any> }) => {
          runtimeRow = { ...(runtimeRow || {}), ...data };
          return runtimeRow;
        }),
      },
      publishRecord: {
        create: jest.fn().mockResolvedValue({ id: 'publish-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      article: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const store = new PublishRecordStore(prisma as never, context);
    const payload = {
      type: 3,
      contentKind: 'article' as const,
      articleId: 'article-a',
      body: '完整正文',
      sourceIdentity: {
        sourceType: 'article' as const,
        sourceId: 'article-a',
        title: '租户 A 的文章',
        contentType: 'article',
        contentFormat: 'markdown',
        updatedAt: '2026-07-11T00:00:00.000Z',
      },
      accountIdentity: {
        id: 'account-a',
        name: '租户 A 账号',
        platform: 'douyin',
        status: 'ready',
      },
      title: '租户 A 的文章',
      tags: [],
      fileList: ['image.png'],
      accountList: ['account.json'],
    };
    const pending = {
      platforms: [
        {
          platform: '抖音',
          accountId: 'account-a',
          accountName: '租户 A 账号',
          articleId: 'article-a',
          status: 'pending_manual' as const,
        },
      ],
      summary: {
        total: 1,
        success: 0,
        failed: 0,
        accountExpired: 0,
        materialError: 0,
        loginRequired: 0,
        pendingManual: 1,
        blocked: 0,
        notIntegrated: 0,
      },
    };

    const record = await context.run({ user: { id: 'user-a' } }, () =>
      store.create({
        title: payload.title,
        platformType: 3,
        accountFile: '租户 A 账号',
        fileList: payload.fileList,
        tags: [],
        dryRun: false,
        payloads: [payload],
        result: pending,
      }),
    );
    const unverified = {
      ...pending,
      platforms: [
        {
          ...pending.platforms[0],
          status: 'success' as const,
          evidence: { readback: { matched: false } },
        },
      ],
    };
    await context.run({ user: { id: 'user-a' } }, () =>
      store.updateResult(record, unverified),
    );
    expect(prisma.article.updateMany).not.toHaveBeenCalled();

    const verified = {
      ...pending,
      platforms: [
        {
          ...pending.platforms[0],
          status: 'success' as const,
          evidence: { readbackOk: true, readback: { matched: true } },
        },
      ],
    };
    await context.run({ user: { id: 'user-a' } }, () =>
      store.updateResult(record, verified),
    );
    expect(prisma.article.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'article-a',
        updatedAt: new Date('2026-07-11T00:00:00.000Z'),
        tenantId: 'tenant-a',
        userId: 'user-a',
      },
      data: { status: 'published' },
    });
    expect(prisma.publishRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          articleId: 'article-a',
          accountId: 'account-a',
          bodySnapshot: '完整正文',
          tenantId: 'tenant-a',
          userId: 'user-a',
        }),
      }),
    );

    await expect(
      context.run({ user: { id: 'user-b' } }, () =>
        store.updateResult(record, verified),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
