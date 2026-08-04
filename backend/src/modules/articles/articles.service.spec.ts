import { ArticlesService, withAbortTimeout } from './articles.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { createHash } from 'node:crypto';

describe('ArticlesService', () => {
  const createWorkspaceBriefFixture = () => ({
    goal: '形成可审核主稿',
    audience: '门店负责人',
    platforms: ['wechat'],
    deadline: '2026-07-30',
    action: '预约演示',
    constraints: '不作绝对化承诺',
  });
  const outlineItemsHash = (items: unknown[]) =>
    createHash('sha256').update(JSON.stringify(items)).digest('hex');

  it('超时时会 abort 正在执行的生成操作', async () => {
    jest.useFakeTimers();
    let operationSignal: AbortSignal | undefined;

    try {
      const result = withAbortTimeout(
        (signal) =>
          new Promise<never>((_, reject) => {
            operationSignal = signal;
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
        100,
        '文章生成超时',
      );
      const assertion = expect(result).rejects.toMatchObject({
        name: 'TimeoutError',
        message: '文章生成超时',
      });

      await jest.advanceTimersByTimeAsync(100);
      await assertion;
      expect(operationSignal?.aborted).toBe(true);
      expect(operationSignal?.reason).toMatchObject({
        name: 'TimeoutError',
        message: '文章生成超时',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('正常完成时不会 abort 生成操作', async () => {
    let operationSignal: AbortSignal | undefined;

    await expect(
      withAbortTimeout(
        async (signal) => {
          operationSignal = signal;
          return 'done';
        },
        1000,
        '不应触发的超时',
      ),
    ).resolves.toBe('done');
    expect(operationSignal?.aborted).toBe(false);
  });

  const createService = (options?: {
    generateImpl?: jest.Mock;
    selectImageImpl?: jest.Mock;
    generateCoverImageImpl?: jest.Mock;
    uploadBufferImpl?: jest.Mock;
  }) => {
    const generateImpl = options?.generateImpl ?? jest.fn();
    const selectImageImpl = options?.selectImageImpl ?? jest.fn();
    const generateCoverImageImpl = options?.generateCoverImageImpl ?? jest.fn();
    const uploadBufferImpl =
      options?.uploadBufferImpl ?? jest.fn().mockResolvedValue(null);
    const aiClient = { generate: generateImpl };
    const systemLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const imageSelector = {
      selectImage: selectImageImpl,
      generateCoverImage: generateCoverImageImpl,
    };
    const storageService = {
      uploadBuffer: uploadBufferImpl,
    };
    const service = new ArticlesService(
      {} as any,
      aiClient as any,
      {} as any,
      systemLogsService as any,
      imageSelector as any,
      {} as any,
      storageService as any,
    );

    return {
      service,
      aiClient,
      systemLogsService,
      imageSelector,
      storageService,
    };
  };

  it('创建空白草稿时会使用安全默认值并记录日志', async () => {
    const article = {
      id: 'article-draft-1',
      title: '未命名内容',
      content: '',
      contentType: 'article',
      contentFormat: 'markdown',
      status: 'draft',
    };
    const prisma = {
      article: {
        create: jest.fn().mockResolvedValue(article),
      },
    };
    const systemLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      systemLogsService as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.createDraft()).resolves.toEqual(article);
    expect(prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: '未命名内容',
        content: '',
        contentType: 'article',
        contentFormat: 'markdown',
        workspaceBrief: {
          goal: '形成一篇可审核、可交接的内容主稿',
          audience: '当前品牌的目标读者',
          platforms: [],
          deadline: null,
          action: '阅读后完成与内容目标一致的下一步行动',
          constraints: '仅使用可验证事实；避免绝对化承诺',
          fieldSources: {
            goal: {
              source: 'workflow_default',
              label: '工作流默认，可修改',
              edited: false,
            },
            audience: {
              source: 'workflow_default',
              label: '工作流默认，可修改',
              edited: false,
            },
            platforms: {
              source: 'unavailable',
              label: '未指定发布平台',
              edited: false,
            },
            deadline: {
              source: 'unavailable',
              label: '未关联营销任务，可选填',
              edited: false,
            },
            action: {
              source: 'workflow_default',
              label: '工作流默认，可修改',
              edited: false,
            },
            constraints: {
              source: 'compliance_default',
              label: '内容合规默认约束',
              edited: false,
            },
          },
        },
        workspaceOutline: {
          items: [],
          confirmedAt: null,
          confirmedItemsHash: null,
        },
        workspaceStep: 'brief',
        workspaceRevision: 1,
        status: 'draft',
      }),
      include: {
        topic: { select: { title: true, keywords: true } },
        template: { select: { id: true, name: true } },
      },
    });
    expect(systemLogsService.record).toHaveBeenCalledWith(
      '空白内容草稿「未命名内容」已创建',
      'success',
    );
  });

  it.each([
    ['create', '形成一篇可审核、可交接的内容主稿'],
    ['rewrite', '在保留核心事实的前提下完成内容改写'],
    ['multiplatform', '形成一份可继续适配多平台的内容主稿'],
    ['prepare', '形成一份可进入审核与发布准备的内容主稿'],
  ] as const)('会为 %s intent 原子创建预填草稿', async (task, taskGoal) => {
    const prisma = {
      article: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `article-${task}`,
            ...data,
          }),
        ),
      },
    };
    const context = new AuthRequestContextService();
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      context,
    );

    const result = await context.run(
      { user: { id: 'user-intent' }, tenantId: 'tenant-intent' },
      () =>
        service.createDraft({
          title: '新品内容',
          contentType: 'xiaohongshu',
          workspaceIntent: {
            task,
            platforms: ['wechat', 'wechat', 'douyin'],
          },
        }),
    );

    expect(prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-intent',
        userId: 'user-intent',
        workspaceStep: 'brief',
        workspaceRevision: 1,
        workspaceBrief: expect.objectContaining({
          goal: taskGoal,
          platforms: ['wechat', 'douyin'],
          fieldSources: expect.objectContaining({
            goal: {
              source: 'task_intent',
              label: '根据任务意图预填',
              edited: false,
            },
            platforms: {
              source: 'task_intent',
              label: '根据任务意图预填',
              edited: false,
            },
          }),
        }),
      }),
      include: expect.any(Object),
    });
    expect(result).toMatchObject({
      workspaceStep: 'brief',
      workspaceRevision: 1,
    });
  });

  it('显式 intent 目标和空平台列表优先于标题及内容类型默认值', async () => {
    const prisma = {
      article: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'article-intent-priority', ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.createDraft({
      title: '标题默认目标不应生效',
      contentType: 'xiaohongshu',
      workspaceIntent: {
        task: 'rewrite',
        goal: '  保留事实并缩短正文  ',
        platforms: [],
      },
    });

    expect(prisma.article.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceBrief: expect.objectContaining({
          goal: '保留事实并缩短正文',
          platforms: [],
        }),
      }),
      include: expect.any(Object),
    });
  });

  it('更新 Markdown 正文时会清除旧的派生 HTML', async () => {
    const currentArticle = {
      id: 'article-wechat-1',
      title: '公众号草稿',
      content: '旧 Markdown',
      contentFormat: 'markdown',
      rawHtml: '<p>旧 HTML</p>',
      finalHtml: '<p>旧 HTML</p>',
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...currentArticle,
            ...data,
          }),
        ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update('article-wechat-1', { content: '新 Markdown' });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-wechat-1' },
      data: expect.objectContaining({
        content: '新 Markdown',
        contentFormat: 'markdown',
        rawHtml: null,
        finalHtml: null,
        workspaceRevision: { increment: 1 },
      }),
    });
  });

  it('会独立保存简报、大纲与步骤并递增工作区版本', async () => {
    const currentArticle = {
      id: 'article-workspace-1',
      title: '工作区草稿',
      content: '正文保持不变',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceRevision: 3,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update('article-workspace-1', {
      workspaceBrief: {
        goal: ' 形成可审核主稿 ',
        audience: ' 门店负责人 ',
        platforms: ['wechat', 'wechat', 'xiaohongshu'],
        deadline: '2026-07-30',
        action: '预约演示',
        constraints: '不作绝对化承诺',
      },
      workspaceOutline: {
        items: [
          { id: 'intro', title: ' 先说结论 ', summary: '核心判断' },
          { id: 'proof', title: '补充依据', summary: '案例与数据' },
        ],
        confirmedAt: '2026-07-22T08:00:00.000Z',
      },
      confirmWorkspaceOutline: true,
      workspaceStep: 'outline',
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-workspace-1' },
      data: expect.objectContaining({
        content: '正文保持不变',
        workspaceBrief: {
          goal: '形成可审核主稿',
          audience: '门店负责人',
          platforms: ['wechat', 'xiaohongshu'],
          deadline: '2026-07-30',
          action: '预约演示',
          constraints: '不作绝对化承诺',
          fieldSources: {
            goal: { source: 'user', label: '已由你修改', edited: true },
            audience: { source: 'user', label: '已由你修改', edited: true },
            platforms: { source: 'user', label: '已由你修改', edited: true },
            deadline: { source: 'user', label: '已由你修改', edited: true },
            action: { source: 'user', label: '已由你修改', edited: true },
            constraints: { source: 'user', label: '已由你修改', edited: true },
          },
        },
        workspaceOutline: {
          items: [
            { id: 'intro', title: '先说结论', summary: '核心判断' },
            { id: 'proof', title: '补充依据', summary: '案例与数据' },
          ],
          confirmedAt: expect.any(String),
          confirmedItemsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        workspaceStep: 'outline',
        workspaceRevision: { increment: 1 },
      }),
    });
  });

  it('简报值变化会由服务端标记为用户编辑并合并局部来源', async () => {
    const currentWorkspaceBrief = {
      ...createWorkspaceBriefFixture(),
      fieldSources: {
        goal: {
          source: 'workflow_default',
          label: '工作流默认，可修改',
          edited: false,
        },
        audience: {
          source: 'campaign_context',
          label: '来自营销任务',
          edited: false,
        },
      },
    };
    const currentArticle = {
      id: 'article-brief-provenance',
      title: '工作区草稿',
      content: '',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: currentWorkspaceBrief,
      workspaceOutline: null,
      workspaceStep: 'brief',
      workspaceRevision: 2,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update(currentArticle.id, {
      workspaceBrief: {
        ...createWorkspaceBriefFixture(),
        goal: '形成新的可审核主稿',
        fieldSources: {
          goal: {
            source: 'article_title',
            label: '根据草稿标题预填',
            edited: false,
          },
        },
      },
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: currentArticle.id },
      data: expect.objectContaining({
        workspaceBrief: expect.objectContaining({
          goal: '形成新的可审核主稿',
          fieldSources: {
            goal: { source: 'user', label: '已由你修改', edited: true },
            audience: {
              source: 'campaign_context',
              label: '来自营销任务',
              edited: false,
            },
          },
        }),
      }),
    });
  });

  it('大纲变化会让旧确认失效且不能复用旧确认推进正文', async () => {
    const previousItems = [{ id: 'intro', title: '旧结构', summary: '旧要点' }];
    const changedItems = [{ id: 'intro', title: '新结构', summary: '新要点' }];
    const currentArticle = {
      id: 'article-outline-stale-confirmation',
      title: '工作区草稿',
      content: '已有正文',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: createWorkspaceBriefFixture(),
      workspaceOutline: {
        items: previousItems,
        confirmedAt: '2026-07-22T08:00:00.000Z',
        confirmedItemsHash: outlineItemsHash(previousItems),
      },
      workspaceStep: 'outline',
      workspaceRevision: 5,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update(currentArticle.id, {
      workspaceOutline: {
        items: changedItems,
        confirmedAt: currentArticle.workspaceOutline.confirmedAt,
        confirmedItemsHash: currentArticle.workspaceOutline.confirmedItemsHash,
      },
      workspaceStep: 'outline',
    });
    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: currentArticle.id },
      data: expect.objectContaining({
        workspaceOutline: {
          items: changedItems,
          confirmedAt: null,
          confirmedItemsHash: null,
        },
      }),
    });

    prisma.article.update.mockClear();
    await expect(
      service.update(currentArticle.id, {
        workspaceOutline: {
          items: changedItems,
          confirmedAt: currentArticle.workspaceOutline.confirmedAt,
          confirmedItemsHash:
            currentArticle.workspaceOutline.confirmedItemsHash,
        },
        workspaceStep: 'draft',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('历史确认大纲缺少摘要时可回填摘要并进入正文', async () => {
    const items = [{ id: 'intro', title: '历史结构', summary: '要点' }];
    const currentArticle = {
      id: 'article-outline-hash-backfill',
      title: '历史工作区草稿',
      content: '已有正文',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: createWorkspaceBriefFixture(),
      workspaceOutline: {
        items,
        confirmedAt: '2026-07-22T08:00:00.000Z',
      },
      workspaceStep: 'outline',
      workspaceRevision: 4,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update(currentArticle.id, {
      workspaceOutline: currentArticle.workspaceOutline,
      workspaceStep: 'draft',
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: currentArticle.id },
      data: expect.objectContaining({
        workspaceOutline: {
          items,
          confirmedAt: '2026-07-22T08:00:00.000Z',
          confirmedItemsHash: outlineItemsHash(items),
        },
        workspaceStep: 'draft',
      }),
    });
  });

  it('只有显式确认请求会由服务端确认当前大纲', async () => {
    const items = [{ id: 'intro', title: '当前结构', summary: '核心要点' }];
    const currentArticle = {
      id: 'article-outline-confirm',
      title: '工作区草稿',
      content: '',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: createWorkspaceBriefFixture(),
      workspaceOutline: {
        items,
        confirmedAt: null,
        confirmedItemsHash: null,
      },
      workspaceStep: 'outline',
      workspaceRevision: 2,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update(currentArticle.id, {
      confirmWorkspaceOutline: true,
      workspaceStep: 'outline',
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: currentArticle.id },
      data: expect.objectContaining({
        workspaceOutline: {
          items,
          confirmedAt: expect.any(String),
          confirmedItemsHash: outlineItemsHash(items),
        },
        workspaceRevision: { increment: 1 },
      }),
    });
  });

  it('旧正文只通过显式兼容标记进入正文且不能跳过版本与审核', async () => {
    const currentArticle = {
      id: 'article-legacy-body',
      title: '旧文章',
      content: '已有正文',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: null,
      workspaceOutline: null,
      workspaceStep: null,
      workspaceRevision: 1,
    };
    const persistedLegacyArticle = {
      ...currentArticle,
      workspaceOutline: {
        items: [],
        confirmedAt: null,
        confirmedItemsHash: null,
        legacyBodyWithoutOutline: true,
      },
      workspaceStep: 'draft',
    };
    const prisma = {
      article: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(currentArticle)
          .mockResolvedValueOnce(persistedLegacyArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update(currentArticle.id, { workspaceStep: 'draft' });
    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: currentArticle.id },
      data: expect.objectContaining({
        workspaceOutline: {
          items: [],
          confirmedAt: null,
          confirmedItemsHash: null,
          legacyBodyWithoutOutline: true,
        },
        workspaceStep: 'draft',
      }),
    });

    prisma.article.update.mockClear();
    await expect(
      service.update(currentArticle.id, { workspaceStep: 'versions' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('相同工作区快照重试不会递增版本', async () => {
    const workspaceBrief = {
      goal: '形成可审核主稿',
      audience: '门店负责人',
      platforms: ['wechat', 'xiaohongshu'],
      deadline: '2026-07-30',
      action: '预约演示',
      constraints: '不作绝对化承诺',
    };
    const workspaceOutline = {
      items: [{ id: 'intro', title: '先说结论', summary: '核心判断' }],
      confirmedAt: '2026-07-22T08:00:00.000Z',
    };
    const currentArticle = {
      id: 'article-workspace-same',
      title: '工作区草稿',
      content: '正文保持不变',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief,
      workspaceOutline,
      workspaceStep: 'outline',
      workspaceRevision: 4,
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...currentArticle, ...data }),
          ),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.update('article-workspace-same', {
      title: currentArticle.title,
      content: currentArticle.content,
      workspaceBrief: {
        ...workspaceBrief,
        goal: ` ${workspaceBrief.goal} `,
        platforms: ['wechat', 'wechat', 'xiaohongshu'],
      },
      workspaceOutline,
      workspaceStep: 'outline',
    });

    expect(prisma.article.update).toHaveBeenCalledWith({
      where: { id: 'article-workspace-same' },
      data: expect.objectContaining({ workspaceRevision: undefined }),
    });
  });

  it('非法简报形状、长度和日期会拒绝且不覆盖已有数据', async () => {
    const currentArticle = {
      id: 'article-workspace-invalid-brief',
      title: '工作区草稿',
      content: '',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: createWorkspaceBriefFixture(),
      workspaceOutline: { items: [], confirmedAt: null },
      workspaceStep: 'brief',
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest.fn(),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const invalidBriefs = [
      null,
      { ...createWorkspaceBriefFixture(), goal: 'x'.repeat(2001) },
      { ...createWorkspaceBriefFixture(), deadline: 'not-a-date' },
      { ...createWorkspaceBriefFixture(), platforms: 'wechat' },
    ];

    for (const workspaceBrief of invalidBriefs) {
      await expect(
        service.update(currentArticle.id, { workspaceBrief }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('非法大纲形状、超长字段和重复 ID 会拒绝且不覆盖已有数据', async () => {
    const currentArticle = {
      id: 'article-workspace-invalid-outline',
      title: '工作区草稿',
      content: '',
      contentFormat: 'markdown',
      rawHtml: null,
      finalHtml: null,
      workspaceBrief: createWorkspaceBriefFixture(),
      workspaceOutline: { items: [], confirmedAt: null },
      workspaceStep: 'outline',
    };
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue(currentArticle),
        update: jest.fn(),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const invalidOutlines = [
      { items: 'not-an-array', confirmedAt: null },
      {
        items: [{ id: 'one', title: 'x'.repeat(161), summary: '' }],
        confirmedAt: null,
      },
      {
        items: [
          { id: 'same', title: '第一节', summary: '' },
          { id: 'same', title: '第二节', summary: '' },
        ],
        confirmedAt: null,
      },
      { items: [], confirmedAt: 'not-a-date' },
    ];

    for (const workspaceOutline of invalidOutlines) {
      await expect(
        service.update(currentArticle.id, { workspaceOutline }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('非法工作区步骤会安全拒绝且不写入文章', async () => {
    const prisma = {
      article: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'article-workspace-2',
          content: '',
          contentFormat: 'markdown',
          rawHtml: null,
          finalHtml: null,
        }),
        update: jest.fn(),
      },
    };
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.update('article-workspace-2', {
        workspaceStep: 'not-a-step',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('在 HTML 首次截断时会复用同一轮上下文续写补全', async () => {
    const generate = jest.fn().mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>它已经不只是玩具，而是进入真实业务流程的
HTML_END`).mockResolvedValueOnce(`HTML_CONTINUATION_START
信用卡风控排查场景。</p></section>
HTML_CONTINUATION_END`);

    const { service, aiClient } = createService({ generateImpl: generate });

    const result = await (service as any).generateArticlePayload({
      modelId: 'model-1',
      systemPrompt: 'system',
      userPrompt: 'user',
      fallbackTitle: 'fallback',
      contentFormat: 'html',
      templateHtml: '<section><h1>模板</h1><p>正文</p></section>',
    });

    expect(result.title).toBe('OpenClaw 龙虾爆火');
    expect(result.content).toContain('它已经不只是玩具');
    expect(result.content).toContain('信用卡风控排查场景');
    expect(result.content.trim().endsWith('</section>')).toBe(true);
    expect(aiClient.generate).toHaveBeenCalledTimes(2);
    expect(aiClient.generate.mock.calls[1][1][2]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('HTML_START'),
    });
  });

  it('续写补全失败后会回退到下一轮整篇重生成', async () => {
    const generate = jest.fn().mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>第一段还没写完
HTML_END`).mockResolvedValueOnce(`HTML_CONTINUATION_START
但这里依然没有闭合
HTML_CONTINUATION_END`).mockResolvedValueOnce(`TITLE_START
OpenClaw 龙虾爆火
TITLE_END
HTML_START
<section><h1>OpenClaw 龙虾爆火</h1><p>第一段已经完整。</p></section>
HTML_END`);

    const { service, aiClient } = createService({ generateImpl: generate });

    const result = await (service as any).generateArticlePayload({
      modelId: 'model-1',
      systemPrompt: 'system',
      userPrompt: 'user',
      fallbackTitle: 'fallback',
      contentFormat: 'html',
      templateHtml: '<section><h1>模板</h1><p>正文</p></section>',
    });

    expect(result.content).toBe(
      '<section><h1>OpenClaw 龙虾爆火</h1><p>第一段已经完整。</p></section>',
    );
    expect(aiClient.generate).toHaveBeenCalledTimes(3);
    expect(aiClient.generate.mock.calls[2][1]).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content:
          'user\n\n【重试要求】：HTML 结尾缺少闭合标签，疑似被截断\n请重新完整输出整篇文章。',
      },
    ]);
  });

  it('正文配图成功后不再把首图写入封面字段', async () => {
    const selectImage = jest
      .fn()
      .mockResolvedValue('https://cdn.example.com/body-image.png');
    const { service } = createService({ selectImageImpl: selectImage });

    const result = await (service as any).renderImages({
      content: '<section><img src="[ai-image-龙虾机器人]" /></section>',
      contentFormat: 'html',
      materialInfos: [],
      imageStylePrompt: '风格提示',
      imageStyleParams: undefined,
      imageCreationEnabled: true,
      topicTitle: 'OpenClaw 龙虾爆火',
    });

    expect(result.content).toContain('https://cdn.example.com/body-image.png');
    expect(result.coverImage).toBeNull();
  });

  it('会使用独立封面提示词调用 AI 生成封面', async () => {
    const generateCoverImage = jest
      .fn()
      .mockResolvedValue('https://cdn.example.com/cover-image.png');
    const { service, imageSelector } = createService({
      generateCoverImageImpl: generateCoverImage,
    });

    const result = await (service as any).generateCoverImage({
      topicTitle: 'OpenClaw 龙虾爆火',
      topicSummary: '有人用它排查信用卡盗刷，AI 私人助理感开始落地。',
      keywords: ['OpenClaw', '信用卡盗刷', 'AI 助手'],
      imageStylePrompt: '电影感、纪实质感',
      imageStyleParams: { ratio: '16:9' },
      imageCreationEnabled: true,
    });

    expect(result).toBe('https://cdn.example.com/cover-image.png');
    expect(imageSelector.generateCoverImage).toHaveBeenCalledWith(
      expect.stringContaining('这不是正文插图'),
      '电影感、纪实质感',
      { ratio: '16:9' },
    );
    expect(imageSelector.generateCoverImage.mock.calls[0][0]).toContain(
      '封面图',
    );
    expect(imageSelector.generateCoverImage.mock.calls[0][0]).toContain(
      '不要做成正文配图拼贴',
    );
  });

  it('会清理中文段落首部空白和内联特效前后的误空格', () => {
    const { service } = createService();

    const cleaned = (service as any)
      .cleanupHtml(`<p style="margin-bottom: 24px; font-size: 14px; line-height: 1.9; text-align: justify; color: #374151;">
      你仔细看看这个 ai-hedge-fund 到底干了啥。
      <span style="background: linear-gradient(120deg, rgba(167,139,250,0.2) 0%, transparent 100%); padding: 1px 5px; border-radius: 3px; font-weight: 700; color: #4C1D95;">它就像你免费雇了10个清华北大的实习生。</span>
    </p>`);

    expect(
      cleaned.startsWith(
        '<p style="margin-bottom: 24px; font-size: 14px; line-height: 1.9; text-align: justify; color: #374151;">你仔细看看这个 ai-hedge-fund 到底干了啥。',
      ),
    ).toBe(true);
    expect(cleaned).toContain('干了啥。<span');
    expect(cleaned).not.toContain('干了啥。\n      <span');
  });

  it('会为小红书笔记生成独立的 platform prompt', () => {
    const { service } = createService();

    const prompt = (service as any).buildSystemPrompt(
      'xiaohongshu',
      '真实口语感，先给结论再展开',
      'markdown',
      '',
      '',
    );

    expect(prompt).toContain('小红书内容策划与爆款笔记写手');
    expect(prompt).toContain('文字排版优先、图片辅助');
    expect(prompt).toContain('默认适配 3:4 竖版成品卡图');
    expect(prompt).toContain('cover-poster');
    expect(prompt).toContain('"slides"');
  });

  it('会解析新版小红书模板化卡片 payload', () => {
    const { service } = createService();

    const result = (service as any).parseXiaohongshuPayload(
      JSON.stringify({
        title: 'AI 创业者一定要试试这套工作流',
        caption: '我最近把选题、配图、发布拆成了三段式，效率真的高很多。',
        hashtags: ['AI创业', '#内容运营'],
        slides: [
          {
            role: 'cover',
            template: 'cover-poster',
            title: '别再一口气写长文',
            body: '先把卡片主题列出来，转成固定模板更稳',
            bullets: [],
            highlight: '适合内容团队',
            imagePrompt: '办公室里规划卡片分镜',
            imageType: 'ai',
          },
          {
            role: 'hook',
            template: 'insight-card',
            title: '封面先打利益点',
            body: '让读者一眼知道能得到什么，点击率才会起来',
            bullets: [],
            highlight: '先结果后解释',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'problem',
            template: 'bullet-list',
            title: '每张图只讲一个点',
            body: '不要一页塞满三层信息',
            bullets: [
              '一个页面只讲一个动作',
              '标题替你做筛选',
              '配色固定降低犹豫',
            ],
            highlight: '信息密度刚刚好',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'method',
            template: 'checklist-card',
            title: '固定模板最省心',
            body: '照着模板填字就能出稿',
            bullets: ['封面写利益点', '中间页拆要点', '结尾页给行动'],
            highlight: '流程可复用',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'summary',
            template: 'summary-card',
            title: '最后再补一句结论',
            body: '小红书不是拼命堆图，而是让文字更容易被读完',
            bullets: [],
            highlight: '文字才是核心',
            imagePrompt: '',
            imageType: 'none',
          },
        ],
      }),
      'fallback',
    );

    expect(result.title).toBe('AI 创业者一定要试试这套工作流');
    expect(result.hashtags).toEqual(['AI创业', '#内容运营']);
    expect(result.slides).toHaveLength(5);
    expect(result.slides[0].template).toBe('cover-poster');
    expect(result.slides[2].bullets).toHaveLength(3);
    expect(result.slides[1].imageType).toBe('none');
  });

  it('会兼容旧版小红书卡片结构并补齐模板字段', () => {
    const { service } = createService();

    const result = (service as any).parseXiaohongshuPayload(
      JSON.stringify({
        title: '旧版兼容测试',
        caption: '沿用 coverText/bodyText 也能正常转成新版结构。',
        hashtags: ['兼容', '#升级'],
        slides: [
          {
            coverText: '封面先说结果',
            bodyText: '旧数据也会被强制映射到封面模板',
            imagePrompt: '极简封面背景',
            imageType: 'ai',
          },
          {
            coverText: '第二页讲问题',
            bodyText: '不用重跑历史数据',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            coverText: '第三页拆重点',
            bodyText: '重点继续可以显示',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            coverText: '第四页给方法',
            bodyText: '照着模板继续展示',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            coverText: '最后一页总结',
            bodyText: '历史数据也能继续被下载',
            imagePrompt: '',
            imageType: 'none',
          },
        ],
      }),
      'fallback',
    );

    expect(result.slides[0].role).toBe('cover');
    expect(result.slides[0].template).toBe('cover-poster');
    expect(result.slides[1].title).toBe('第二页讲问题');
  });

  it('会在小红书 JSON 失败时回退到稳定的卡片骨架', () => {
    const { service } = createService();

    const result = (service as any).parseXiaohongshuPayload(
      '标题：商业验收卡片\n这不是 JSON，也没有卡片数组。',
      '商业验收选题',
    );

    expect(result.title).toBe('商业验收选题');
    expect(result.caption).toContain('商业验收选题');
    expect(result.slides).toHaveLength(6);
    expect(result.slides[0].template).toBe('cover-poster');
    expect(result.slides[5].role).toBe('summary');
  });

  it('会生成可直接预览的小红书 PNG 成品卡图 data url', async () => {
    const generate = jest.fn().mockResolvedValue(
      JSON.stringify({
        title: '模板化小红书更稳',
        caption: '先定模板，再填文字，小红书风格会稳定很多。',
        hashtags: ['模板化', '#小红书'],
        slides: [
          {
            role: 'cover',
            template: 'cover-poster',
            title: '模板先定死',
            body: '封面做成大字报，其他页就不会跑偏',
            bullets: [],
            highlight: '稳定出风格',
            imagePrompt: '柔和办公桌面背景',
            imageType: 'ai',
          },
          {
            role: 'hook',
            template: 'insight-card',
            title: '别交给图片模型决定排版',
            body: '排版交给系统，图片只负责气氛和辅助',
            bullets: [],
            highlight: '文字优先',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'problem',
            template: 'bullet-list',
            title: '为什么以前容易飘',
            body: '因为每页都在临场发挥',
            bullets: ['标题样式不固定', '图和字互相抢戏', '重点层级不稳定'],
            highlight: '核心是失控',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'method',
            template: 'checklist-card',
            title: '新方案怎么做',
            body: '先脚本再成图',
            bullets: ['先出页面角色', '再选固定模板', '最后生成成品卡图'],
            highlight: '流程清晰',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'summary',
            template: 'summary-card',
            title: '效果会更像真人账号',
            body: '读者会先看字，再看图，信息吸收更顺畅',
            bullets: [],
            highlight: '更像真实运营产物',
            imagePrompt: '',
            imageType: 'none',
          },
        ],
      }),
    );
    const { service } = createService({ generateImpl: generate });

    const result = await (service as any).generateXiaohongshuNote({
      modelId: 'model-1',
      stylePrompt: '真实口语感',
      topicTitle: '模板化小红书',
      topicSummary: '测试',
      keywords: ['模板', '小红书'],
      materialContents: '素材内容',
      materialInfos: [],
      imageStylePrompt: '柔和明亮',
      imageStyleParams: { ratio: '3:4' },
      imageCreationEnabled: false,
    });

    expect(result.slides).toHaveLength(5);
    expect(
      result.slides[0].cardImageUrl.startsWith('data:image/png;base64'),
    ).toBe(true);
    expect(result.slides[0].coverText).toBe('模板先定死');
    expect(result.slides[2].bullets[0]).toBe('标题样式不固定');
  });

  it('七牛上传成功时会优先使用上传后的 PNG URL', async () => {
    const generate = jest.fn().mockResolvedValue(
      JSON.stringify({
        title: '上传版小红书',
        caption: '测试上传后的卡图地址是否被使用。',
        hashtags: ['上传', '#PNG'],
        slides: [
          {
            role: 'cover',
            template: 'cover-poster',
            title: '先上传再返回',
            body: '这样前端拿到的就是稳定地址',
            bullets: [],
            highlight: 'PNG URL',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'hook',
            template: 'insight-card',
            title: '第二页',
            body: '继续用模板渲染',
            bullets: [],
            highlight: '',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'problem',
            template: 'bullet-list',
            title: '第三页',
            body: '拆成要点',
            bullets: ['第一点', '第二点', '第三点'],
            highlight: '',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'method',
            template: 'checklist-card',
            title: '第四页',
            body: '按清单排版',
            bullets: ['动作一', '动作二', '动作三'],
            highlight: '',
            imagePrompt: '',
            imageType: 'none',
          },
          {
            role: 'summary',
            template: 'summary-card',
            title: '第五页',
            body: '结束总结',
            bullets: [],
            highlight: '收尾',
            imagePrompt: '',
            imageType: 'none',
          },
        ],
      }),
    );
    const uploadBuffer = jest
      .fn()
      .mockResolvedValue('https://cdn.example.com/xhs-card-01.png');
    const { service, storageService } = createService({
      generateImpl: generate,
      uploadBufferImpl: uploadBuffer,
    });

    const result = await (service as any).generateXiaohongshuNote({
      modelId: 'model-1',
      stylePrompt: '真实口语感',
      topicTitle: '上传版小红书',
      topicSummary: '测试',
      keywords: ['上传'],
      materialContents: '素材内容',
      materialInfos: [],
      imageStylePrompt: '',
      imageStyleParams: { ratio: '3:4' },
      imageCreationEnabled: false,
    });

    expect(storageService.uploadBuffer).toHaveBeenCalled();
    expect(result.slides[0].cardImageUrl).toBe(
      'https://cdn.example.com/xhs-card-01.png',
    );
  });

  it('按组织和使用者隔离文章列表、详情与修改', async () => {
    const rows = [
      {
        id: 'article-a',
        tenantId: 'tenant-a',
        userId: 'user-a',
        title: '租户 A 文章',
        content: 'A',
        contentFormat: 'markdown',
        rawHtml: null,
        finalHtml: null,
        createdAt: new Date('2026-07-11T00:00:00.000Z'),
      },
      {
        id: 'article-b',
        tenantId: 'tenant-b',
        userId: 'user-b',
        title: '租户 B 文章',
        content: 'B',
        contentFormat: 'markdown',
        rawHtml: null,
        finalHtml: null,
        createdAt: new Date('2026-07-11T00:01:00.000Z'),
      },
    ];
    const matches = (row: (typeof rows)[number], where: Record<string, any>) =>
      (!where.id || row.id === where.id) &&
      (!where.tenantId || row.tenantId === where.tenantId) &&
      (!where.userId || row.userId === where.userId);
    const prisma = {
      tenantMember: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => [
          {
            tenantId: where.userId === 'user-a' ? 'tenant-a' : 'tenant-b',
          },
        ]),
      },
      article: {
        findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
          rows.filter((row) => matches(row, where)),
        ),
        count: jest.fn(
          async ({ where }: { where: Record<string, any> }) =>
            rows.filter((row) => matches(row, where)).length,
        ),
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, any> }) =>
            rows.find((row) => matches(row, where)) || null,
        ),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const context = new AuthRequestContextService();
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      context,
    );

    const tenantA = await context.run({ user: { id: 'user-a' } }, () =>
      service.findAll({ page: 1, limit: 20 }),
    );
    const tenantB = await context.run({ user: { id: 'user-b' } }, () =>
      service.findAll({ page: 1, limit: 20 }),
    );
    const hidden = await context.run({ user: { id: 'user-a' } }, () =>
      service.findOne('article-b'),
    );

    expect(tenantA.items.map((item) => item.id)).toEqual(['article-a']);
    expect(tenantB.items.map((item) => item.id)).toEqual(['article-b']);
    expect(hidden).toBeNull();
    await expect(service.findAll({ page: 1, limit: 20 })).rejects.toThrow(
      '缺少登录上下文',
    );
    await expect(
      context.run({ user: { id: 'user-a' } }, () =>
        service.update('article-b', { title: '越权修改' }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.article.update).not.toHaveBeenCalled();
  });

  it('原子拒绝同一选题的并发生成', async () => {
    const prisma = {
      tenantMember: {
        findMany: jest.fn().mockResolvedValue([{ tenantId: 'tenant-a' }]),
      },
      topic: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'topic-1',
          title: '并发选题',
          status: 'generating',
          isPublished: false,
          materials: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const context = new AuthRequestContextService();
    const service = new ArticlesService(
      prisma as any,
      {} as any,
      {} as any,
      { record: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      context,
    );

    await expect(
      context.run({ user: { id: 'user-a' } }, () =>
        service.generateFromTopic('topic-1'),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.topic.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'topic-1',
        status: { not: 'generating' },
        isPublished: false,
      },
      data: { status: 'generating' },
    });
  });
});
