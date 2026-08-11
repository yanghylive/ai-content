import { GrowthService } from './growth.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

function makeService(
  prisma: Record<string, unknown> = {},
  aiEmployee: Record<string, unknown> = {},
  runtime: Record<string, unknown> = {},
  crm: Record<string, unknown> = {},
  autoUpload: Record<string, unknown> = {},
  authRequestContext?: Record<string, unknown>,
) {
  return new GrowthService(
    aiEmployee as any,
    autoUpload as any,
    prisma as any,
    runtime as any,
    crm as any,
    authRequestContext as any,
  ) as any;
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    strategies: [],
    configs: [],
    runs: [],
    leads: [],
    accountHealth: [],
    workflows: [],
    commercialAudits: [],
    ...overrides,
  } as any;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'config-commercial',
    userId: 'user-1',
    tenantId: 'tenant-1',
    mode: 'keyword',
    taskName: '装修客户自动获客',
    platform: 'douyin',
    accountId: 'douyin-1',
    accountName: '大壮抖音号',
    sourceInputs: ['装修'],
    includeKeywords: ['多少钱', '本地'],
    excludeKeywords: ['招聘'],
    blacklistNicknames: ['广告号'],
    commentTemplates: ['我这边刚好有相关案例，可以交流一下。'],
    privateMessageTemplates: ['我可以先发你一份避坑清单，你看完再决定。'],
    dailyLimit: 10,
    perTargetLimit: 1,
    deduplicate: true,
    scheduleEnabled: true,
    beginTime: '00:00',
    riskMode: 'auto',
    status: 'enabled',
    exposureCount: 0,
    exposureDate: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

function makeAccountHealth(overrides: Record<string, unknown> = {}) {
  return {
    id: 'douyin:douyin-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    platform: 'douyin',
    accountId: 'douyin-1',
    accountName: '大壮抖音号',
    loginStatus: 'online',
    todayActionCount: 0,
    failureRate: 0,
    riskStatus: 'normal',
    recommendation: '账号可用于增长任务。',
    lastCheckedAt: new Date().toISOString(),
    ...overrides,
  } as any;
}

async function withGrowthExecutionEnv<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const original = process.env.GROWTH_EXECUTION_ENABLED;
  if (value === undefined) {
    delete process.env.GROWTH_EXECUTION_ENABLED;
  } else {
    process.env.GROWTH_EXECUTION_ENABLED = value;
  }
  try {
    return await run();
  } finally {
    if (original === undefined) {
      delete process.env.GROWTH_EXECUTION_ENABLED;
    } else {
      process.env.GROWTH_EXECUTION_ENABLED = original;
    }
  }
}

describe('GrowthService tenant scheduler scope', () => {
  it('runs only tenant-scoped automatic acquisition configs once before daemon execution', async () => {
    const service = makeService({
      tenantEntitlement: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.tenantId === 'tenant-1' &&
          where.source === 'kaypal-subscription'
            ? { id: 'entitlement-1' }
            : null,
        ),
      },
    });
    const store = makeStore({
      strategies: [{ id: 'strategy-legacy', userId: 'user-2' }],
      configs: [
        makeConfig({
          id: 'config-tenant',
          userId: 'user-1',
          tenantId: 'tenant-1',
        }),
        makeConfig({
          id: 'config-legacy-confirm',
          userId: 'user-2',
          tenantId: undefined,
          riskMode: 'confirm-first',
        }),
        makeConfig({
          id: 'config-legacy-auto',
          userId: 'user-2',
          tenantId: undefined,
        }),
        makeConfig({
          id: 'config-personal',
          userId: 'user-3',
          tenantId: undefined,
        }),
      ],
      runs: [{ id: 'run-legacy', userId: 'user-2' }],
      leads: [{ id: 'lead-legacy', userId: 'user-2' }],
      accountHealth: [
        {
          id: 'douyin:4',
          userId: 'user-2',
          platform: 'douyin',
          accountId: '4',
        },
      ],
      workflows: [{ id: 'workflow-legacy', userId: 'user-2' }],
    });

    service.loadStore = jest.fn().mockResolvedValue(store);
    service.saveStore = jest.fn();
    service.resolveGrowthTenantId = jest.fn(async (userId: string) => {
      if (userId === 'user-1' || userId === 'user-2') return 'tenant-1';
      return undefined;
    });

    await expect(service.listGrowthSchedulerTargets()).resolves.toEqual([
      { lockKey: 'tenant:tenant-1', userId: 'user-1', tenantId: 'tenant-1' },
    ]);
    expect(service.saveStore).not.toHaveBeenCalled();
  });

  it('excludes personal and manual-review rows from daemon targets', async () => {
    const service = makeService();
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({
        configs: [
          makeConfig({
            id: 'config-personal-auto',
            userId: 'user-1',
            tenantId: undefined,
          }),
          makeConfig({
            id: 'config-manual',
            userId: 'user-2',
            tenantId: undefined,
            riskMode: 'confirm-first',
          }),
          makeConfig({
            id: 'config-disabled',
            userId: 'user-3',
            tenantId: undefined,
            status: 'disabled',
          }),
        ],
      }),
    );
    service.saveStore = jest.fn();
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue(undefined);

    await expect(service.listGrowthSchedulerTargets()).resolves.toEqual([]);
    expect(service.saveStore).not.toHaveBeenCalled();
  });

  it('excludes local commercial override tenants from daemon execution targets', async () => {
    const service = makeService({
      tenantEntitlement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({
        configs: [
          makeConfig({
            id: 'config-local-override',
            userId: 'local-user',
            tenantId: 'tenant-local',
          }),
        ],
      }),
    );
    service.saveStore = jest.fn();
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-local');

    await expect(service.listGrowthSchedulerTargets()).resolves.toEqual([]);
  });

  it('matches tenant rows and current user legacy rows without exposing other users legacy rows', () => {
    const service = makeService();
    const scope = { userId: 'user-1', tenantId: 'tenant-1' };

    expect(
      service.inGrowthScope({ userId: 'user-2', tenantId: 'tenant-1' }, scope),
    ).toBe(true);
    expect(service.inGrowthScope({ userId: 'user-1' }, scope)).toBe(true);
    expect(service.inGrowthScope({ userId: 'user-2' }, scope)).toBe(false);
    expect(
      service.inGrowthScope({ userId: 'user-3', tenantId: 'tenant-2' }, scope),
    ).toBe(false);
  });

  it('acquires a fresh database lease for a scheduler target', async () => {
    const lease = {
      create: jest.fn().mockResolvedValue({ id: 'tenant:tenant-1' }),
      updateMany: jest.fn(),
    };
    const service = makeService({ growthSchedulerLease: lease });

    await expect(
      service.acquireGrowthSchedulerLease({
        lockKey: 'tenant:tenant-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toMatchObject({ acquired: true });

    expect(lease.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'tenant:tenant-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          ownerId: expect.stringContaining('growth-'),
        }),
      }),
    );
    expect(lease.updateMany).not.toHaveBeenCalled();
  });

  it('takes over an expired database lease and skips an active one', async () => {
    const uniqueError = Object.assign(new Error('unique'), { code: 'P2002' });
    const lease = {
      create: jest.fn().mockRejectedValue(uniqueError),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    };
    const service = makeService({ growthSchedulerLease: lease });
    const target = {
      lockKey: 'tenant:tenant-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    };

    await expect(
      service.acquireGrowthSchedulerLease(target),
    ).resolves.toMatchObject({ acquired: true });
    await expect(
      service.acquireGrowthSchedulerLease(target),
    ).resolves.toMatchObject({ acquired: false });

    expect(lease.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'tenant:tenant-1',
          lockedUntil: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('daemon executes only targets whose database lease was acquired', async () => {
    const service = makeService();
    const originalExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;
    const originalDaemonEnabled = process.env.GROWTH_SCHEDULER_DAEMON;
    const originalRealDaemonAllowed =
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    process.env.GROWTH_SCHEDULER_DAEMON = 'true';
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    service.listGrowthSchedulerTargets = jest.fn().mockResolvedValue([
      { lockKey: 'tenant:locked', userId: 'user-1', tenantId: 'locked' },
      { lockKey: 'tenant:ready', userId: 'user-2', tenantId: 'ready' },
    ]);
    service.acquireGrowthSchedulerLease = jest
      .fn()
      .mockResolvedValueOnce({ acquired: false })
      .mockResolvedValueOnce({ acquired: true });
    service.runScheduledConfigs = jest
      .fn()
      .mockResolvedValue({ executedCount: 0 });
    service.releaseGrowthSchedulerLease = jest.fn();

    try {
      await service.runGrowthSchedulerDaemon();
    } finally {
      if (originalExecutionEnabled === undefined) {
        delete process.env.GROWTH_EXECUTION_ENABLED;
      } else {
        process.env.GROWTH_EXECUTION_ENABLED = originalExecutionEnabled;
      }
      if (originalDaemonEnabled === undefined) {
        delete process.env.GROWTH_SCHEDULER_DAEMON;
      } else {
        process.env.GROWTH_SCHEDULER_DAEMON = originalDaemonEnabled;
      }
      if (originalRealDaemonAllowed === undefined) {
        delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
      } else {
        process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED =
          originalRealDaemonAllowed;
      }
    }

    expect(service.runScheduledConfigs).toHaveBeenCalledTimes(1);
    expect(service.runScheduledConfigs).toHaveBeenCalledWith('user-2', {
      limit: 3,
      trigger: 'daemon',
    });
    expect(service.releaseGrowthSchedulerLease).toHaveBeenCalledWith(
      { lockKey: 'tenant:ready', userId: 'user-2', tenantId: 'ready' },
      'success',
    );
  });

  it('does not run daemon unless real daemon execution is explicitly armed', async () => {
    const service = makeService();
    const originalExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;
    const originalDaemonEnabled = process.env.GROWTH_SCHEDULER_DAEMON;
    const originalRealDaemonAllowed =
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    process.env.GROWTH_SCHEDULER_DAEMON = 'true';
    delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    service.listGrowthSchedulerTargets = jest
      .fn()
      .mockResolvedValue([
        { lockKey: 'tenant:ready', userId: 'user-2', tenantId: 'ready' },
      ]);
    service.runScheduledConfigs = jest
      .fn()
      .mockResolvedValue({ executedCount: 1 });

    try {
      await service.runGrowthSchedulerDaemon();
    } finally {
      if (originalExecutionEnabled === undefined) {
        delete process.env.GROWTH_EXECUTION_ENABLED;
      } else {
        process.env.GROWTH_EXECUTION_ENABLED = originalExecutionEnabled;
      }
      if (originalDaemonEnabled === undefined) {
        delete process.env.GROWTH_SCHEDULER_DAEMON;
      } else {
        process.env.GROWTH_SCHEDULER_DAEMON = originalDaemonEnabled;
      }
      if (originalRealDaemonAllowed === undefined) {
        delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
      } else {
        process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED =
          originalRealDaemonAllowed;
      }
    }

    expect(service.listGrowthSchedulerTargets).not.toHaveBeenCalled();
    expect(service.runScheduledConfigs).not.toHaveBeenCalled();
  });
});

describe('GrowthService commercial acquisition execution', () => {
  it('keeps external execution disabled when the commercial switch is off', async () => {
    const aiEmployee = {
      findDouyinHotVideoLeads: jest.fn(),
      planDouyinFollowUp: jest.fn(),
      executeDouyinFollowUp: jest.fn(),
    };
    const service = makeService({}, aiEmployee);
    let store = makeStore({
      configs: [makeConfig()],
      accountHealth: [makeAccountHealth()],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');
    service.requireGrowthMutationScope = jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
      legacy: false,
    });

    await withGrowthExecutionEnv(undefined, async () => {
      const result = await service.executeConfig('user-1', 'config-commercial');

      expect(result.run.status).toBe('skipped');
      expect(result.run.message).toContain('当前为安全演练');
      expect(result.leads).toHaveLength(0);
      expect(store.runs).toHaveLength(1);
      expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
      expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
    });
  });

  it('does not claim a config can execute when no verified account exists', async () => {
    const aiEmployee = {
      findDouyinHotVideoLeads: jest.fn(),
      executeDouyinFollowUp: jest.fn(),
    };
    const service = makeService({}, aiEmployee);
    let store = makeStore({
      configs: [makeConfig({ riskMode: 'confirm-first' })],
      accountHealth: [],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');

    await withGrowthExecutionEnv('true', async () => {
      const result = await service.executeConfig('user-1', 'config-commercial');

      expect(result.run).toMatchObject({
        status: 'skipped',
        failureReason: 'account_not_logged_in',
        message: '未找到可验证的执行账号，已阻止增长获客执行。',
      });
      expect(result.run.message).not.toContain('账号可执行');
      expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
      expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
    });
  });

  it('executes a confirm-first config only for a backend-confirmed manual run', async () => {
    const candidate = {
      text: '想了解本地装修报价',
      targetName: '装修意向客户',
      sourceUrl: 'https://www.douyin.com/video/confirmed-run',
      videoUrl: 'https://www.douyin.com/video/confirmed-run',
      score: 90,
    };
    const followUpTarget = {
      ...candidate,
      index: 0,
      sourceText: candidate.text,
      commentReplyText: '可以先交流一下你的户型和预算。',
      commentTaskEnabled: true,
      messageTaskEnabled: false,
    };
    const aiEmployee = {
      findDouyinHotVideoLeads: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '读取到 1 条候选',
        candidates: [candidate],
        evidence: [],
      }),
      planDouyinFollowUp: jest.fn().mockResolvedValue({
        targets: [followUpTarget],
        skipped: [],
        summary: {
          totalCandidates: 1,
          selectedCount: 1,
          skippedCount: 0,
          commentTaskCount: 1,
          messageTaskCount: 0,
        },
      }),
      executeDouyinFollowUp: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '确认后执行完成',
        summary: {
          totalTargets: 1,
          attemptedCount: 1,
          successCount: 1,
          failedCount: 0,
          sendMode: 'auto-send',
        },
        results: [
          {
            index: 0,
            targetName: candidate.targetName,
            targetText: candidate.text,
            replyText: followUpTarget.commentReplyText,
            ok: true,
            status: 'success',
            message: '发送成功且回读一致',
            evidence: [],
          },
        ],
      }),
    };
    const crmService = {
      captureGrowthLead: jest.fn().mockResolvedValue({
        enabled: true,
        capturedCount: 0,
        skippedCount: 1,
        capturedCustomers: [],
      }),
    };
    const service = makeService({}, aiEmployee, {}, crmService);
    let store = makeStore({
      configs: [makeConfig({ riskMode: 'confirm-first' })],
      accountHealth: [makeAccountHealth()],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');
    service.requireGrowthMutationScope = jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
      legacy: false,
    });

    await withGrowthExecutionEnv('true', async () => {
      const skipped = await service.executeConfig(
        'user-1',
        'config-commercial',
      );
      expect(skipped.run.status).toBe('skipped');
      expect(skipped.run.message).toContain('需要本次后端确认');
      expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();

      const executed = await service.executeConfig(
        'user-1',
        'config-commercial',
        { confirmedExecution: true },
      );
      expect(executed.run.status).toBe('success');
      expect(executed.run.contactedCount).toBe(1);
      expect(aiEmployee.findDouyinHotVideoLeads).toHaveBeenCalledTimes(1);
      expect(aiEmployee.executeDouyinFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'douyin-1',
          autoSend: true,
          targets: [followUpTarget],
        }),
      );
    });
  });

  it('routes search-account exposure through the account search collector without messaging candidates', async () => {
    const aiEmployee = {
      findDouyinLeadsByKeyword: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '已从真实搜索页读取 1 个账号候选。',
        candidates: [
          {
            text: '同城装修设计企业号 粉丝 1.2 万',
            targetName: '同城装修设计',
            profileUrl: 'https://www.douyin.com/user/search-result-1',
            sourceUrl: 'https://www.douyin.com/search/装修设计师',
            kind: 'search-account-result',
            score: 80,
          },
        ],
        evidence: [
          {
            type: 'screenshot',
            label: '账号搜索回读',
            url: 'https://evidence.local/search-account.png',
          },
        ],
      }),
      findDouyinHotVideoLeads: jest.fn(),
      planDouyinFollowUp: jest.fn(),
      executeDouyinFollowUp: jest.fn(),
    };
    const service = makeService({}, aiEmployee);
    let store = makeStore({
      configs: [
        makeConfig({
          mode: 'search-account',
          taskName: '搜索账号曝光任务',
          sourceInputs: ['装修设计师'],
          riskMode: 'auto',
        }),
      ],
      accountHealth: [makeAccountHealth()],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');
    service.requireGrowthMutationScope = jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
      legacy: false,
    });

    await withGrowthExecutionEnv('true', async () => {
      const result = await service.executeConfig('user-1', 'config-commercial');

      expect(result.run).toMatchObject({
        status: 'success',
        candidateCount: 1,
        selectedCount: 1,
        contactedCount: 0,
      });
      expect(result.run.evidenceUrls).toContain(
        'https://evidence.local/search-account.png',
      );
      expect(result.config.exposureCount).toBe(1);
      expect(result.leads[0]).toMatchObject({
        nickname: '同城装修设计',
        status: 'new',
      });
      expect(aiEmployee.findDouyinLeadsByKeyword).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'douyin-1',
          keyword: '装修设计师',
        }),
      );
      expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
      expect(aiEmployee.planDouyinFollowUp).not.toHaveBeenCalled();
      expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['keyword', 'findDouyinHotVideoLeads', 'douyin-hot-video-exposure'],
    ['video-link', 'findDouyinLeadsByLink', 'douyin-link-exposure'],
    ['target-account', 'findDouyinTargetedLeads', 'douyin-targeted-exposure'],
    ['retention', 'findDouyinRetentionLeads', 'douyin-retention-exposure'],
  ] as const)(
    'keeps %s acquisition on its collector and customer-action capability',
    async (mode, collectorMethod, sourceCapability) => {
      const collectorResult = {
        ok: true,
        status: 'success',
        candidates: [],
        evidence: [],
      };
      const aiEmployee = {
        findDouyinHotVideoLeads: jest.fn().mockResolvedValue(collectorResult),
        findDouyinLeadsByLink: jest.fn().mockResolvedValue(collectorResult),
        findDouyinTargetedLeads: jest.fn().mockResolvedValue(collectorResult),
        findDouyinRetentionLeads: jest.fn().mockResolvedValue(collectorResult),
        executeDouyinFollowUp: jest.fn().mockResolvedValue({
          ok: true,
          status: 'success',
          message: '完成',
          summary: { successCount: 0, failedCount: 0 },
          results: [],
        }),
      };
      const service = makeService({}, aiEmployee);
      service.nextGrowthAcquisitionSourceInput = jest
        .fn()
        .mockResolvedValue('https://www.douyin.com/video/7390000000000000011');
      const config = makeConfig({
        mode,
        sourceInputs:
          mode === 'target-account'
            ? ['目标装修达人']
            : ['https://www.douyin.com/video/7390000000000000011'],
        perTargetLimit: 2,
      });

      await service.fetchCandidatesWithAiEmployee(config, 5);
      await service.executePlatformFollowUp(config, [], 5);

      expect(aiEmployee[collectorMethod]).toHaveBeenCalledTimes(1);
      expect(aiEmployee.executeDouyinFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'douyin-1',
          autoSend: true,
          sourceCapability,
        }),
      );
      if (mode === 'target-account') {
        expect(aiEmployee.findDouyinTargetedLeads).toHaveBeenCalledWith(
          expect.objectContaining({ perTargetLimit: 2 }),
        );
      }
    },
  );

  it('rejects retention configs that cannot identify a Douyin interaction or customer', () => {
    const service = makeService();

    expect(() =>
      service.assertValidConfig(
        makeConfig({
          mode: 'retention',
          sourceInputs: ['活动表单线索'],
        }),
      ),
    ).toThrow('不能使用普通搜索词代替客户来源');
  });

  it('runs due auto tasks through Douyin execution and persists run, leads, and reports', async () => {
    const candidate = {
      text: '最近想装修改造，想问一下本地大概多少钱？',
      targetName: '本地装修咨询客户',
      profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-commercial',
      sourceUrl: 'https://www.douyin.com/video/123456',
      videoUrl: 'https://www.douyin.com/video/123456',
      videoTitle: '旧房翻新避坑',
      kind: 'hot-video-comment',
      score: 92,
      reason: '明确询价和本地需求',
    };
    const followUpTarget = {
      ...candidate,
      index: 0,
      sourceText:
        '目标：本地装修咨询客户\n最近想装修改造，想问一下本地大概多少钱？',
      commentReplyText: '我这边刚好有本地旧房翻新案例，可以交流一下。',
      commentTaskEnabled: true,
      messageTaskEnabled: false,
      followUpActions: ['comment'],
    };
    const aiEmployee = {
      findDouyinHotVideoLeads: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '已采集到 1 条高意向评论。',
        candidates: [candidate],
        evidence: [
          {
            type: 'json',
            label: '候选采集',
            url: 'https://evidence.local/candidates.json',
          },
        ],
      }),
      planDouyinFollowUp: jest.fn().mockResolvedValue({
        sourceLabel: '抖音',
        sourceText: '装修',
        accountName: '大壮抖音号',
        targets: [followUpTarget],
        skipped: [],
        summary: {
          totalCandidates: 1,
          selectedCount: 1,
          skippedCount: 0,
          commentTaskCount: 1,
          messageTaskCount: 0,
          nextAction: '已筛出 1 条高意向线索。',
        },
      }),
      executeDouyinFollowUp: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '已自动执行 1 条评论回复',
        summary: {
          totalTargets: 1,
          attemptedCount: 1,
          successCount: 1,
          failedCount: 0,
          sendMode: 'auto-send',
          videoCount: 1,
        },
        results: [
          {
            index: 0,
            targetName: '本地装修咨询客户',
            targetText: candidate.text,
            replyText: followUpTarget.commentReplyText,
            ok: true,
            status: 'success',
            message: '发送成功且回读一致',
            evidence: [
              {
                type: 'screenshot',
                label: '评论发送回读',
                url: 'https://evidence.local/send.png',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
      }),
    };
    const crmService = {
      captureGrowthLead: jest.fn().mockResolvedValue({
        enabled: true,
        capturedCount: 1,
        skippedCount: 0,
        message: '已沉淀 1 条增长线索到 CRM',
        capturedCustomers: [
          {
            leadId: 'lead-generated',
            customerId: 'crm-customer-1',
            displayName: '本地装修咨询客户',
            dedupeKey: 'crm:growth-lead:test',
          },
        ],
      }),
    };
    const service = makeService({}, aiEmployee, {}, crmService);
    let store = makeStore({
      configs: [makeConfig()],
      accountHealth: [makeAccountHealth()],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');

    await withGrowthExecutionEnv('true', async () => {
      const scheduled = await service.runScheduledConfigs('user-1', {
        limit: 5,
      });

      expect(scheduled.executedCount).toBe(1);
      expect(scheduled.results[0].run.status).toBe('success');
      expect(scheduled.results[0].run.candidateCount).toBe(1);
      expect(scheduled.results[0].run.selectedCount).toBe(1);
      expect(scheduled.results[0].run.contactedCount).toBe(1);
      expect(scheduled.results[0].run.crmCapturedCount).toBe(1);
      expect(scheduled.results[0].run.message).toContain(
        '已同步 1 条线索到 CRM',
      );
      expect(scheduled.results[0].run.evidenceUrls).toEqual(
        expect.arrayContaining([
          'https://evidence.local/candidates.json',
          'https://evidence.local/send.png',
        ]),
      );
      expect(scheduled.results[0].leads).toHaveLength(1);
      expect(scheduled.results[0].leads[0]).toMatchObject({
        sourceRunId: scheduled.results[0].run.id,
        sourceTaskId: 'config-commercial',
        crmCustomerId: 'crm-customer-1',
        status: 'contacted',
        latestReply: followUpTarget.commentReplyText,
      });
      expect(scheduled.results[0].leads[0].notes?.[0]).toMatchObject({
        type: 'general',
        text: expect.stringContaining('已自动沉淀到 CRM 客户'),
      });
      expect(store.configs[0].exposureCount).toBe(1);
      expect(store.configs[0].lastRunAt).toBeTruthy();
      expect(store.runs).toHaveLength(1);
      expect(store.leads).toHaveLength(1);
      expect(aiEmployee.findDouyinHotVideoLeads).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'douyin-1',
          keyword: '装修',
        }),
      );
      expect(aiEmployee.executeDouyinFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'douyin-1',
          targets: [followUpTarget],
          maxTargets: 10,
          autoSend: true,
        }),
      );
      expect(crmService.captureGrowthLead).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          platform: 'douyin',
          sourceType: 'auto-acquisition',
          sourceTaskId: 'config-commercial',
          status: 'contacted',
          latestReply: followUpTarget.commentReplyText,
        }),
      );

      const reports = await service.getReports('user-1', { range: '7d' });
      expect(reports.overview.todayLeadCount).toBe(1);
      expect(reports.overview.todayContactedCount).toBe(1);
      expect(reports.funnel).toMatchObject({
        candidates: 1,
        selected: 1,
        contacted: 1,
        crmCaptured: 1,
      });
      expect(reports.taskPerformance[0]).toMatchObject({
        configId: 'config-commercial',
        runCount: 1,
        contactedCount: 1,
      });
    });
  });

  it('syncs an existing lead into CRM and stores the CRM customer id', async () => {
    const crmService = {
      captureGrowthLead: jest.fn().mockResolvedValue({
        enabled: true,
        capturedCount: 1,
        skippedCount: 0,
        message: '已沉淀 1 条增长线索到 CRM',
        capturedCustomers: [
          {
            leadId: 'lead-1',
            customerId: 'crm-customer-manual-1',
            displayName: '本地装修咨询客户',
            dedupeKey: 'crm:growth-lead:manual',
          },
        ],
      }),
    };
    const service = makeService({}, {}, {}, crmService);
    const now = new Date().toISOString();
    let store = makeStore({
      leads: [
        {
          id: 'lead-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          platform: 'douyin',
          sourceType: 'manual-import',
          nickname: '本地装修咨询客户',
          profileUrl: 'https://www.douyin.com/user/manual',
          sourceText: '想了解旧房翻新多少钱',
          sourceUrl: 'https://www.douyin.com/video/manual',
          matchedKeywords: ['多少钱', '旧房翻新'],
          score: 82,
          scoreReasons: ['价格需求明确'],
          status: 'new',
          notes: [],
          evidenceUrls: [],
          latestReply: '可以先发你一份报价参考。',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');

    const result = await service.syncLeadToCrm('user-1', 'lead-1');

    expect(result).toMatchObject({
      ok: true,
      enabled: true,
      customerId: 'crm-customer-manual-1',
    });
    expect(store.leads[0]).toMatchObject({
      crmCustomerId: 'crm-customer-manual-1',
    });
    expect(store.leads[0].notes[0]).toMatchObject({
      type: 'general',
      text: expect.stringContaining('已同步到 CRM 客户'),
    });
    expect(crmService.captureGrowthLead).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        leadId: 'lead-1',
        platform: 'douyin',
        sourceType: 'manual-import',
        status: 'new',
      }),
    );
  });

  it('keeps manual lead provenance fields when creating a growth lead', async () => {
    const service = makeService();
    let store = makeStore();
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest.fn().mockResolvedValue('tenant-1');
    service.requireGrowthMutationScope = jest.fn().mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      permissions: [],
      legacy: false,
    });

    const lead = await service.createLead('user-1', {
      platform: 'douyin',
      sourceType: 'manual-import',
      sourceTaskId: 'task-manual-1',
      sourceRunId: 'run-manual-1',
      nickname: '本地装修咨询客户',
      sourceText: '想了解旧房翻新多少钱',
      sourceUrl: 'https://www.douyin.com/video/manual',
      commentTime: '2026-07-03T10:00:00.000Z',
      matchedKeywords: ['旧房翻新', '多少钱'],
      status: 'qualified',
    });

    expect(lead).toMatchObject({
      tenantId: 'tenant-1',
      sourceType: 'manual-import',
      sourceTaskId: 'task-manual-1',
      sourceRunId: 'run-manual-1',
      commentTime: '2026-07-03T10:00:00.000Z',
      status: 'qualified',
    });
    expect(store.leads[0]).toMatchObject({
      id: lead.id,
      sourceTaskId: 'task-manual-1',
      sourceRunId: 'run-manual-1',
    });
  });
});

describe('GrowthService tenant mutation security', () => {
  it('allows an active read-only member to view tenant-scoped account health and schedule plan', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'member',
      permissions: ['growth:read'],
    });
    const autoUpload = {
      listAccounts: jest.fn().mockResolvedValue([
        {
          id: 'douyin-1',
          type: 3,
          platform: '抖音',
          profileName: '大壮抖音号',
          status: 1,
        },
      ]),
      getAccountHealth: jest.fn().mockResolvedValue({
        checkedAt: '2026-07-22T04:00:00.000Z',
        issues: [],
      }),
    };
    const service = makeService(
      { tenantMember: { findFirst } },
      {},
      {},
      {},
      autoUpload,
    );
    let store = makeStore({
      configs: [
        makeConfig(),
        makeConfig({
          id: 'config-other-tenant',
          userId: 'user-2',
          tenantId: 'tenant-2',
          accountId: 'douyin-other',
        }),
      ],
      accountHealth: [
        makeAccountHealth(),
        makeAccountHealth({
          id: 'douyin:douyin-other',
          userId: 'user-2',
          tenantId: 'tenant-2',
          accountId: 'douyin-other',
        }),
      ],
    });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });

    const health = await service.listAccountHealth('user-1');
    const plan = await service.getSchedulePlan('user-1');

    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      tenantId: 'tenant-1',
      accountId: 'douyin-1',
    });
    expect(plan.items.map((item: any) => item.configId)).toEqual([
      'config-commercial',
    ]);
    expect(autoUpload.listAccounts).toHaveBeenCalledWith(
      expect.not.objectContaining({ ids: expect.anything() }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          status: 'active',
          tenant: { status: 'active' },
        },
      }),
    );
  });

  it('discovers a tenant-owned publishing account before any growth config exists', async () => {
    const autoUpload = {
      listAccounts: jest.fn().mockResolvedValue([
        {
          id: 17,
          type: 3,
          platform: '抖音',
          profileName: '已登录抖音号',
          status: 1,
        },
      ]),
      getAccountHealth: jest.fn().mockResolvedValue({
        checkedAt: '2026-07-22T04:00:00.000Z',
        issues: [],
      }),
    };
    const service = makeService(
      {
        tenantMember: {
          findFirst: jest.fn().mockResolvedValue({
            tenantId: 'tenant-1',
            role: 'member',
            permissions: ['growth:read'],
          }),
        },
      },
      {},
      {},
      {},
      autoUpload,
    );
    let store = makeStore();
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });

    await expect(service.listAccountHealth('user-1')).resolves.toEqual([
      expect.objectContaining({
        tenantId: 'tenant-1',
        platform: 'douyin',
        accountId: '17',
        accountName: '已登录抖音号',
      }),
    ]);
    expect(autoUpload.listAccounts).toHaveBeenCalledWith({
      validate: true,
      force: true,
    });
  });

  it('uses the explicitly selected active tenant for growth reads', async () => {
    const context = new AuthRequestContextService();
    const findFirst = jest.fn().mockResolvedValue({
      tenantId: 'tenant-b',
      role: 'member',
      permissions: ['growth:read'],
    });
    const autoUpload = {
      listAccounts: jest.fn().mockResolvedValue([]),
      getAccountHealth: jest.fn().mockResolvedValue({
        checkedAt: '2026-07-22T04:00:00.000Z',
        issues: [],
      }),
    };
    const service = makeService(
      {
        tenantMember: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { tenantId: 'tenant-a' },
              { tenantId: 'tenant-b' },
            ]),
          findFirst,
        },
      },
      {},
      {},
      {},
      autoUpload,
      context,
    );
    service.loadStore = jest.fn().mockResolvedValue(makeStore());
    service.saveStore = jest.fn();

    await context.run(
      {
        requestedTenantId: 'tenant-b',
        user: { id: 'user-1' },
      },
      () => service.listAccountHealth('user-1'),
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-b' }),
      }),
    );
  });

  it('keeps account-health reads closed when no active tenant membership exists', async () => {
    const autoUpload = {
      listAccounts: jest.fn(),
      getAccountHealth: jest.fn(),
    };
    const service = makeService(
      {
        tenantMember: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
      {},
      {},
      {},
      autoUpload,
    );

    await expect(service.listAccountHealth('user-1')).rejects.toThrow(
      '当前账号不属于可用组织，不能查看增长数据',
    );
    expect(autoUpload.listAccounts).not.toHaveBeenCalled();
  });

  it('allows any active tenant member to mutate growth data (all-features-open)', async () => {
    const service = makeService({
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          role: 'member',
          permissions: ['growth:read'],
        }),
      },
    });
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({ configs: [], accountHealth: [] }),
    );
    service.saveStore = jest.fn().mockResolvedValue(undefined);

    const lead = await service.createLead('user-1', { nickname: '可写线索' });
    expect(lead).toMatchObject({ tenantId: 'tenant-1' });
    expect(service.saveStore).toHaveBeenCalled();
  });

  it('allows any active tenant member to create config (all-features-open)', async () => {
    const service = makeService({
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          role: 'member',
          permissions: [],
          tenant: { ownerUserId: 'someone-else' },
        }),
      },
    });
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({ configs: [], accountHealth: [] }),
    );
    service.saveStore = jest.fn().mockResolvedValue(undefined);

    const config = await service.createConfig('user-1', {
      platform: 'douyin',
      accountId: 'douyin-1',
      sourceInputs: ['装修'],
      includeKeywords: ['报价'],
      commentTemplates: ['可以交流一下。'],
    });

    expect(config).toMatchObject({ tenantId: 'tenant-1', accountId: 'douyin-1' });
    expect(service.saveStore).toHaveBeenCalled();
  });

  it('allows tenant owner to create config even when cloud-synced role is member', async () => {
    const service = makeService({
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          role: 'member',
          permissions: [],
          tenant: { ownerUserId: 'user-1' },
        }),
      },
    });
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({ configs: [], accountHealth: [] }),
    );
    service.saveStore = jest.fn().mockResolvedValue(undefined);

    const config = await service.createConfig('user-1', {
      platform: 'douyin',
      accountId: 'douyin-1',
      sourceInputs: ['装修'],
      includeKeywords: ['报价'],
      commentTemplates: ['可以交流一下。'],
    });

    expect(config).toMatchObject({ tenantId: 'tenant-1', accountId: 'douyin-1' });
    expect(service.saveStore).toHaveBeenCalled();
  });

  it('still blocks a user with no active tenant membership', async () => {
    const service = makeService({
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.createConfig('user-1', {
        platform: 'douyin',
        accountId: 'douyin-1',
        sourceInputs: ['装修'],
        includeKeywords: ['报价'],
        commentTemplates: ['可以交流一下。'],
      }),
    ).rejects.toThrow('当前账号不属于可用组织，不能修改增长数据');
  });

  it('does not allow an account already claimed by another tenant', async () => {
    const service = makeService({
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          role: 'admin',
          permissions: [],
        }),
      },
    });
    service.loadStore = jest.fn().mockResolvedValue(
      makeStore({
        configs: [
          makeConfig({
            id: 'config-other',
            userId: 'user-2',
            tenantId: 'tenant-2',
          }),
        ],
      }),
    );
    service.saveStore = jest.fn();

    await expect(
      service.createConfig('user-1', {
        platform: 'douyin',
        accountId: 'douyin-1',
        sourceInputs: ['装修'],
        includeKeywords: ['报价'],
        commentTemplates: ['可以交流一下。'],
      }),
    ).rejects.toThrow('该平台账号已属于其他组织');
    expect(service.saveStore).not.toHaveBeenCalled();
  });

  it('computes account failure rate from scoped run history', () => {
    const service = makeService();
    const config = makeConfig();
    const scope = { userId: 'user-1', tenantId: 'tenant-1' };
    const runs = [
      {
        id: 'run-success',
        userId: 'user-1',
        tenantId: 'tenant-1',
        configId: config.id,
        status: 'success',
        startedAt: '2026-07-11T03:00:00.000Z',
      },
      {
        id: 'run-failed',
        userId: 'user-1',
        tenantId: 'tenant-1',
        configId: config.id,
        status: 'failed',
        failureReason: 'send_failed',
        startedAt: '2026-07-11T02:00:00.000Z',
      },
      {
        id: 'run-skipped',
        userId: 'user-1',
        tenantId: 'tenant-1',
        configId: config.id,
        status: 'skipped',
        startedAt: '2026-07-11T01:00:00.000Z',
      },
      {
        id: 'run-other-tenant',
        userId: 'user-2',
        tenantId: 'tenant-2',
        configId: config.id,
        status: 'failed',
        failureReason: 'send_failed',
        startedAt: '2026-07-11T04:00:00.000Z',
      },
    ];

    expect(
      service.accountFailureRate(runs, [config], scope, 'douyin', 'douyin-1'),
    ).toBe(0.3333);
  });

  it('persists only the requested tenant collection without snapshot eviction', async () => {
    const strategyUpsert = jest.fn();
    const strategyDelete = jest.fn();
    const tx = {
      growthStrategy: {
        upsert: strategyUpsert,
        deleteMany: strategyDelete,
      },
    };
    const service = makeService({
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    });
    const now = new Date().toISOString();
    const strategy = (id: string, tenantId: string, userId: string) => ({
      id,
      tenantId,
      userId,
      industry: '装修',
      scenario: '获客',
      name: id,
      sourceKeywords: [],
      demandKeywords: [],
      excludeKeywords: [],
      blacklistNicknames: [],
      commentTemplates: [],
      privateMessageTemplates: [],
      defaultDailyLimit: 10,
      defaultRiskMode: 'confirm-first',
      scoringRules: [],
      createdAt: now,
      updatedAt: now,
    });
    const store = makeStore({
      strategies: [
        strategy('strategy-own', 'tenant-1', 'user-1'),
        strategy('strategy-other', 'tenant-2', 'user-2'),
      ],
    });

    await service.saveStoreToDatabase(store, {
      scope: { userId: 'user-1', tenantId: 'tenant-1' },
      collections: ['strategies'],
    });

    expect(strategyUpsert).toHaveBeenCalledTimes(1);
    expect(strategyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'strategy-own' } }),
    );
    expect(strategyDelete).not.toHaveBeenCalled();
  });
});
