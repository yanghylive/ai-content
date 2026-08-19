import { GrowthService } from './growth.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

function makeService(
  prisma: Record<string, unknown> = {},
  aiEmployee: Record<string, unknown> = {},
  runtime: Record<string, unknown> = {},
  crm: Record<string, unknown> = {},
  autoUpload: Record<string, unknown> = {},
  authRequestContext?: Record<string, unknown>,
  activation?: Record<string, unknown>,
  leadBridge?: Record<string, unknown>,
  leadConvertService?: Record<string, unknown>,
  rpaExecutionStore?: Record<string, unknown>,
  rpaDriverRegistry?: Record<string, unknown>,
) {
  return new GrowthService(
    aiEmployee as any,
    autoUpload as any,
    prisma as any,
    runtime as any,
    crm as any,
    authRequestContext as any,
    activation as any,
    leadBridge as any,
    leadConvertService as any,
    rpaExecutionStore as any,
    rpaDriverRegistry as any,
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
    // 复核#4：daemon 执行 auto 任务需审批留痕（create 时 auto+enabled+scheduleEnabled 会自动落）
    autoApprovedAt: now,
    autoApprovedBy: 'backend-risk-gate',
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

  it('recommended 模式 → driverActionForMode 映射 discover-recommended，input 带 keyword 标识（P2 复核）', () => {
    const service = makeService();
    expect(
      (service as any).driverActionForMode('recommended'),
    ).toBe('discover-recommended');
    expect((service as any).modeLabel('recommended')).toBe('推荐流获客');
    expect((service as any).douyinExposureCapability('recommended')).toBe(
      'douyin-recommended-exposure',
    );
  });

  it('runs due auto tasks through Douyin execution and persists run, leads, and reports', async () => {
    const candidate = {
      text: '最近想装修改造，想问一下本地大概多少钱？',
      targetName: '本地装修咨询客户',
      // P0-6 复核：可归因线索需真实外部身份（缺身份字段被 CRM 门禁拦入人工池）
      externalUserId: 'douyin-user-commercial-002',
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

describe('GrowthService RPA driver 发现接入（阶段 A，fail-safe）', () => {
  function makeRegistry(driver?: Record<string, unknown>) {
    return {
      get: jest.fn().mockReturnValue(driver ?? null),
    } as any;
  }

  function makeDriver(overrides?: {
    capabilities?: Record<string, unknown>;
    openSession?: Record<string, unknown>;
    execute?: Record<string, unknown>;
  }) {
    return {
      capabilities: jest.fn().mockResolvedValue(
        overrides?.capabilities ?? {
          platform: 'kuaishou',
          runtimeReady: true,
          actions: [
            { action: 'discover-keyword', supported: true },
            { action: 'discover-account-works', supported: true },
          ],
        },
      ),
      openSession: jest.fn().mockResolvedValue(
        overrides?.openSession ?? { sessionId: 's1', platform: 'kuaishou' },
      ),
      // P1 复核：mock 必须带 closeSession（评审测试质量项），默认成功释放
      closeSession: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(
        overrides?.execute ?? {
          status: 'success',
          reasonCode: 'ok',
          items: [
            { externalContentId: 'c1', url: 'https://kuaishou.com/v/1', title: '装修案例', rawHash: 'h1' },
            { externalContentId: 'c2', url: 'https://kuaishou.com/v/2', title: '翻新实拍', rawHash: 'h2' },
          ],
        },
      ),
    } as any;
  }

  it('driver 支持且成功 → 用 driver 候选，不再走旧 adapter（P0 门控：审计落库成功才返回成功）', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    // P0 门控：必须提供可用 store（createWithLock/appendStep/finalize 成功）才能返回成功候选
    const rpaStore = {
      createWithLock: jest.fn().mockResolvedValue({ id: 'rpa-rec-1' }),
      appendStep: jest.fn().mockResolvedValue({}),
      finalize: jest.fn().mockResolvedValue({}),
    } as any;
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, rpaStore, registry);
    let store = makeStore({ configs: [makeConfig({ platform: 'kuaishou' })] });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => { store = next; });

    const result = await service.fetchCandidatesWithAiEmployee(
      makeConfig({ platform: 'kuaishou' }),
      20,
    );

    expect(driver.execute).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.message).toContain('统一 RPA');
    expect(rpaStore.appendStep).toHaveBeenCalled();
    expect(rpaStore.finalize).toHaveBeenCalled();
  });

  it('driver 不支持该动作 → 回退旧 adapter（不抛错）', async () => {
    const driver = makeDriver({
      capabilities: {
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [{ action: 'discover-keyword', supported: false }],
      },
    });
    const registry = makeRegistry(driver);
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {}, registry);
    let store = makeStore({ configs: [makeConfig({ platform: 'kuaishou' })] });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => { store = next; });

    // 旧 adapter 对 kuaishou keyword 是抛 unsupported；验证回退后由旧逻辑处理（不静默吞错）
    await expect(
      service.fetchCandidatesWithAiEmployee(makeConfig({ platform: 'kuaishou' }), 20),
    ).rejects.toThrow(/unsupported|尚未接入/i);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('driver execute 失败 → 静默回退旧 adapter', async () => {
    const driver = makeDriver({
      execute: { status: 'failed', reasonCode: 'parse_failed', message: '解析失败' },
    });
    const registry = makeRegistry(driver);
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {}, registry);
    let store = makeStore({ configs: [makeConfig({ platform: 'kuaishou' })] });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => { store = next; });

    await expect(
      service.fetchCandidatesWithAiEmployee(makeConfig({ platform: 'kuaishou' }), 20),
    ).rejects.toThrow(/unsupported|尚未接入/i);
  });

  it('registry 为空 → 不影响（抖音旧链路原样）', async () => {
    const aiEmployee = { findDouyinHotVideoLeads: jest.fn().mockResolvedValue({ ok: true, status: 'success', candidates: [] }) };
    const service = makeService({}, aiEmployee, {}, {}, {}, undefined, undefined, undefined, undefined, {}, undefined);
    let store = makeStore({ configs: [makeConfig()] });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => { store = next; });

    const result = await service.fetchCandidatesWithAiEmployee(makeConfig(), 20);
    expect(aiEmployee.findDouyinHotVideoLeads).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('mode 不支持 driver 动作（如 retention）→ 回退旧链路', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {}, registry);
    let store = makeStore({ configs: [makeConfig({ platform: 'kuaishou', mode: 'retention' })] });
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => { store = next; });

    await expect(
      service.fetchCandidatesWithAiEmployee(
        makeConfig({ platform: 'kuaishou', mode: 'retention' }),
        20,
      ),
    ).rejects.toThrow(/unsupported|尚未接入/i);
    expect(driver.execute).not.toHaveBeenCalled();
  });
});

describe('GrowthService RPA execution record (复核#2)', () => {
  function makeRunInput(status: string) {
    return {
      status,
      message: `执行结果：${status}`,
      failureReason: status === 'failed' ? ('account_not_logged_in' as any) : undefined,
      candidateCount: 3,
      selectedCount: 2,
      contactedCount: 1,
      evidenceUrls: ['https://evidence.local/a.png'],
    } as any;
  }

  function makeRunRow(status: string) {
    return {
      id: 'run-rpa-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      configId: 'config-commercial',
      mode: 'keyword',
      platform: 'douyin',
      status,
      message: `执行结果：${status}`,
      candidateCount: 3,
      selectedCount: 2,
      contactedCount: 1,
      crmCapturedCount: 0,
      evidenceUrls: [],
      leadIds: [],
      startedAt: new Date().toISOString(),
    } as any;
  }

  it('persists an RPA execution record with honest status and evidence on each acquisition run', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-1' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      makeRunRow('success'),
      makeRunInput('success'),
      'tenant-1',
    );

    expect(rpaCreate).toHaveBeenCalledTimes(1);
    expect(rpaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        mode: 'keyword',
        status: 'success',
        resumeStep: null,
        runId: 'run-rpa-1',
        evidence: ['https://evidence.local/a.png'],
      }),
    );
    const call = rpaCreate.mock.calls[0][0];
    expect(call.pageFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(call.steps).toHaveLength(3);
  });

  it('keeps skipped as skipped (does not fold into failed) and records resumeStep only on failure', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-2' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      makeRunRow('skipped'),
      makeRunInput('skipped'),
      'tenant-1',
    );

    const call = rpaCreate.mock.calls[0][0];
    expect(call.status).toBe('skipped');
    expect(call.resumeStep).toBeNull();
  });

  it('records resumeStep and reasonCode when the run failed', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-3' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      makeRunRow('failed'),
      makeRunInput('failed'),
      'tenant-1',
    );

    const call = rpaCreate.mock.calls[0][0];
    expect(call.status).toBe('failed');
    expect(call.resumeStep).toBe('fetch-candidates');
    expect(call.reasonCode).toBe('account_not_logged_in');
    expect(call.nextAction).toBeTruthy();
  });

  it('store 未注入 → persistRpaExecution 返回 true（本环境不启用 RPA 审计，不降级 run）', async () => {
    const service = makeService({}, {}, {}, {}, {});
    const config = makeConfig({ riskMode: 'confirm-first' });
    await expect(
      service.persistRpaExecution(
        config,
        makeRunRow('success'),
        makeRunInput('success'),
        'tenant-1',
      ),
    ).resolves.toBe(true);
  });

  it('store 写失败 → persistRpaExecution 返回 false（调用方据此降级 run，不静默当成功）', async () => {
    const rpaCreate = jest.fn().mockRejectedValue(new Error('db down'));
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });
    await expect(
      service.persistRpaExecution(
        config,
        makeRunRow('success'),
        makeRunInput('success'),
        'tenant-1',
      ),
    ).resolves.toBe(false);
    expect(rpaCreate).toHaveBeenCalled();
  });
});

describe('GrowthService RPA driver 真实状态机（阶段 B，create→appendStep→finalize）', () => {
  function makeRegistry(driver?: Record<string, unknown>) {
    return { get: jest.fn().mockReturnValue(driver ?? null) } as any;
  }

  function makeDriver(overrides?: {
    capabilities?: Record<string, unknown>;
    openSession?: Record<string, unknown>;
    execute?: Record<string, unknown>;
  }) {
    return {
      displayName: '快手RPA',
      driverVersion: '1.0.0',
      capabilities: jest.fn().mockResolvedValue(
        overrides?.capabilities ?? {
          platform: 'kuaishou',
          runtimeReady: true,
          actions: [
            { action: 'discover-keyword', supported: true },
            { action: 'discover-account-works', supported: true },
          ],
        },
      ),
      openSession:
        overrides?.openSession instanceof Error
          ? jest.fn().mockRejectedValue(overrides.openSession)
          : jest.fn().mockResolvedValue(
              overrides?.openSession ?? {
                sessionId: 'ks-session-1',
                platform: 'kuaishou',
              },
            ),
      // P1 复核：mock 必须带 closeSession（评审测试质量项），默认成功释放
      closeSession: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(
        overrides?.execute ?? {
          status: 'success',
          reasonCode: 'ok',
          items: [
            {
              externalContentId: 'c1',
              url: 'https://kuaishou.com/v/1',
              title: '装修案例',
              rawHash: 'h1',
            },
          ],
        },
      ),
    } as any;
  }

  function makeStoreMock() {
    return {
      // P1 复核：发现路径走 createWithLock 原子锁（与主 RPA 控制器统一）
      createWithLock: jest.fn().mockResolvedValue({ id: 'rpa-state-1' }),
      appendStep: jest.fn().mockResolvedValue({ id: 'rpa-state-1' }),
      finalize: jest.fn().mockResolvedValue({ id: 'rpa-state-1' }),
      transition: jest.fn().mockResolvedValue({ id: 'rpa-state-1' }),
    } as any;
  }

  it('driver 成功 → 真实状态机 createWithLock(open-session)→appendStep(discover success)→finalize(success)，返回 rpaRecordId（参数透传）', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    const store = makeStoreMock();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    const result = await service.fetchCandidatesWithAiEmployee(config, 20);

    expect(result.candidates).toHaveLength(1);
    expect(result.message).toContain('统一 RPA');
    expect(result.rpaRecordId).toBe('rpa-state-1');
    // P1-9 复核：RPA 结果字段完整透传到候选（外部 ID/身份/事件/指纹不丢）
    expect(result.candidates[0]).toMatchObject({
      externalContentId: 'c1',
      sourceUrl: 'https://kuaishou.com/v/1',
      rawHash: 'h1',
    });
    expect(store.createWithLock).toHaveBeenCalledTimes(1);
    expect(store.createWithLock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'kuaishou',
        sessionId: 'ks-session-1',
        status: 'running',
        steps: expect.arrayContaining([
          expect.objectContaining({ stepName: 'open-session', status: 'success' }),
        ]),
      }),
    );
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-state-1',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1' }),
      expect.objectContaining({
        stepName: 'discover-keyword',
        status: 'success',
        reasonCode: 'ok',
      }),
      { internal: true },
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-state-1',
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ status: 'success', reasonCode: 'ok' }),
    );
    // 复核#4-6：无单例字段——rpaRecordId 随响应参数透传
    expect(service.driverRpaRecordId).toBeUndefined();
  });

  it('driver execute 失败 → appendStep(failed)+finalize(failed)，返回 null 回退旧链路', async () => {
    const driver = makeDriver({
      execute: {
        status: 'failed',
        reasonCode: 'parse_failed',
        message: '搜索页未解析到结果',
      },
    });
    const registry = makeRegistry(driver);
    const store = makeStoreMock();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    // 旧 adapter 对 kuaishou keyword 抛 unsupported → 验证回退后由旧逻辑处理
    await expect(
      service.fetchCandidatesWithAiEmployee(config, 20),
    ).rejects.toThrow(/unsupported|尚未接入/i);
    expect(store.createWithLock).toHaveBeenCalledTimes(1);
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-state-1',
      expect.anything(),
      expect.objectContaining({
        stepName: 'discover-keyword',
        status: 'failed',
        reasonCode: 'parse_failed',
      }),
      { internal: true },
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-state-1',
      expect.anything(),
      expect.objectContaining({ status: 'failed', reasonCode: 'parse_failed' }),
    );
    // 复核#4-6：失败路径无 rpaRecordId（合成记录照写最终结果）
    expect(service.driverRpaRecordId).toBeUndefined();
  });

  it('driver openSession 抛错 → 不建记录，静默回退旧链路', async () => {
    const driver = makeDriver({
      openSession: new Error('unsupported: 会话未就绪'),
    });
    const registry = makeRegistry(driver);
    const store = makeStoreMock();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    await expect(
      service.fetchCandidatesWithAiEmployee(config, 20),
    ).rejects.toThrow(/unsupported|尚未接入/i);
    expect(store.createWithLock).not.toHaveBeenCalled();
  });

  it('driver 不支持该动作 → 不建状态机记录（create 不被调用）', async () => {
    const driver = makeDriver({
      capabilities: {
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [{ action: 'discover-keyword', supported: false }],
      },
    });
    const registry = makeRegistry(driver);
    const store = makeStoreMock();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    await expect(
      service.fetchCandidatesWithAiEmployee(config, 20),
    ).rejects.toThrow(/unsupported|尚未接入/i);
    expect(store.createWithLock).not.toHaveBeenCalled();
  });

  it('store 不可用 → P0 门控阻断成功（recordId=null 不返回成功候选）', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      undefined, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    const result = await service.fetchCandidatesWithAiEmployee(config, 20);
    // P0 复核：状态记录创建失败（store 不可用）→ 阻断成功，返回 ok:false + 审计失败原因
    expect(result.ok).toBe(false);
    expect(result.fallback).toMatchObject({ reasonCode: 'audit_record_failed' });
    expect(result.candidates ?? []).toHaveLength(0);
  });

  it('store.createWithLock 抛错 → P0 门控阻断成功（recordId=null，不调 appendStep/finalize）', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    const store = {
      createWithLock: jest.fn().mockRejectedValue(new Error('db down')),
      appendStep: jest.fn().mockResolvedValue({}),
      finalize: jest.fn().mockResolvedValue({}),
    } as any;
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    const result = await service.fetchCandidatesWithAiEmployee(config, 20);
    // P0 复核：记录创建失败 → 阻断成功，不返回成功候选
    expect(result.ok).toBe(false);
    expect(result.fallback).toMatchObject({ reasonCode: 'audit_record_failed' });
    expect(store.appendStep).not.toHaveBeenCalled();
    expect(store.finalize).not.toHaveBeenCalled();
  });

  it('video-link 模式 → 映射 read-comments（打开内容 URL 读评论，复核#4-5）', async () => {
    const driver = makeDriver({
      capabilities: {
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [{ action: 'read-comments', supported: true }],
      },
      execute: {
        status: 'success',
        reasonCode: 'ok',
        items: [
          {
            title: '视频1',
            text: '这个价格怎么算？',
            url: 'https://kuaishou.com/v/1',
            rawHash: 'h1',
          },
        ],
      },
    });
    const registry = makeRegistry(driver);
    const store = makeStoreMock();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({
      platform: 'kuaishou',
      mode: 'video-link',
      sourceInputs: ['https://www.kuaishou.com/video/1'],
    });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    const result = await service.fetchCandidatesWithAiEmployee(config, 20);

    expect(driver.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'read-comments',
        input: expect.objectContaining({
          contentUrl: 'https://www.kuaishou.com/video/1',
        }),
      }),
    );
    expect(result.candidates).toHaveLength(1);
  });

  it('会话关闭失败 → 执行记录转 reconcile_required（业务结果不被覆盖，审计如实留痕，P1 复核）', async () => {
    const driver = makeDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('browser process gone'));
    const registry = makeRegistry(driver);
    const store = {
      ...makeStoreMock(),
      transition: jest.fn().mockResolvedValue({ id: 'rpa-state-1' }),
    } as any;
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    const result = await service.fetchCandidatesWithAiEmployee(config, 20);

    // P1 复核：候选仍返回（发现动作已成功），但关闭失败 → run 状态降级 partial（需人工核对），
    // 与 rpa_executions 的 reconcile_required 语义一致，避免「任务列表成功、审计页待核对」不一致。
    expect(result.candidates).toHaveLength(1);
    expect(result.status).toBe('partial');
    expect(result.message).toContain('会话关闭失败');
    // P1 复核：关闭失败必须把执行记录转 reconcile_required（不能只留日志）
    expect(driver.closeSession).toHaveBeenCalled();
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-state-1',
      expect.objectContaining({ userId: 'user-1' }),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'session_close_failed' }),
    );
  });

  it('并发同账号执行（createWithLock 抛 account_busy）→ 透传 ConflictException，不回退 legacy（P1 复核统一锁语义）', async () => {
    const driver = makeDriver();
    const registry = makeRegistry(driver);
    const store = {
      createWithLock: jest
        .fn()
        .mockRejectedValue(new Error('account_busy')),
      appendStep: jest.fn().mockResolvedValue({}),
      finalize: jest.fn().mockResolvedValue({}),
    } as any;
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      store, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    service.loadStore = jest.fn(async () => makeStore({ configs: [config] }));

    await expect(
      service.fetchCandidatesWithAiEmployee(config, 20),
    ).rejects.toMatchObject({ name: 'ConflictException' });
    // 账号忙：不 appendStep/finalize 失败步骤（无记录可写），不回退 legacy adapter
    expect(store.appendStep).not.toHaveBeenCalled();
    expect(store.finalize).not.toHaveBeenCalled();
  });
});

describe('GrowthService RPA 合成记录跳过（阶段 B 去重）', () => {
  it('driver 状态机已记录成功 → persistRpaExecution 跳过合成 create（driverRecordId 参数透传）', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-skip' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      { id: 'run-x', userId: 'user-1', configId: 'config-commercial' } as any,
      {
        status: 'success',
        message: '成功',
        candidateCount: 1,
        selectedCount: 1,
        contactedCount: 0,
        evidenceUrls: [],
        rpaRecordId: 'rpa-state-9',
      } as any,
      'tenant-1',
      'rpa-state-9',
    );

    expect(rpaCreate).not.toHaveBeenCalled();
  });

  it('driver 已记录但任务最终 failed → 合成记录照写（如实反映最终结果）', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-2' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      { id: 'run-y', userId: 'user-1', configId: 'config-commercial' } as any,
      {
        status: 'failed',
        message: '失败',
        failureReason: 'target_not_found',
        candidateCount: 1,
        selectedCount: 0,
        contactedCount: 0,
        evidenceUrls: [],
        rpaRecordId: 'rpa-state-9',
      } as any,
      'tenant-1',
      'rpa-state-9',
    );

    expect(rpaCreate).toHaveBeenCalledTimes(1);
  });

  it('无 driverRecordId → 合成记录正常写（未走 driver 路径）', async () => {
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-3' });
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, undefined, undefined, {
      create: rpaCreate,
    });
    const config = makeConfig({ riskMode: 'confirm-first' });

    await service.persistRpaExecution(
      config,
      { id: 'run-z', userId: 'user-1', configId: 'config-commercial' } as any,
      {
        status: 'success',
        message: '成功',
        candidateCount: 1,
        selectedCount: 1,
        contactedCount: 0,
        evidenceUrls: [],
      } as any,
      'tenant-1',
      null,
    );

    expect(rpaCreate).toHaveBeenCalledTimes(1);
  });
});

describe('GrowthService 跟进阶段接入 driver 触达（C 阶段）', () => {
  function makeRegistry(driver?: Record<string, unknown>) {
    return { get: jest.fn().mockReturnValue(driver ?? null) } as any;
  }

  function makeTouchDriver(overrides?: { execute?: Record<string, unknown> }) {
    return {
      driverVersion: '1.0.0',
      capabilities: jest.fn().mockResolvedValue({
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [
          { action: 'reply-comment', supported: true },
          { action: 'send-direct-message', supported: true },
        ],
      }),
      openSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 's1', platform: 'kuaishou' }),
      // P1 复核：mock 必须带 closeSession（评审测试质量项），默认成功释放
      closeSession: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(
        overrides?.execute ?? {
          stepName: 'reply-comment',
          status: 'success',
          reasonCode: 'ok',
          attempt: 1,
          durationMs: 10,
          driverVersion: '1.0.0',
        },
      ),
    } as any;
  }

  function makeNoTouchDriver() {
    return {
      driverVersion: '1.0.0',
      capabilities: jest.fn().mockResolvedValue({
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [
          {
            action: 'reply-comment',
            supported: false,
            unavailableReasonCode: 'unsupported',
          },
          {
            action: 'send-direct-message',
            supported: false,
            unavailableReasonCode: 'unsupported',
          },
        ],
      }),
    } as any;
  }

  function makeTargets() {
    return [
      {
        targetName: '装修用户',
        text: '这个价格怎么算？',
        sourceUrl: 'https://www.kuaishou.com/video/v1',
        commentReplyText: '我这边有真实案例，可以交流。',
      },
    ] as any;
  }

  it('driver 声明支持触达 → 走 driver 执行并组装结果', async () => {
    const driver = makeTouchDriver();
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      undefined, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    const execution = await service.executePlatformFollowUp(
      config,
      makeTargets(),
      10,
    );

    expect(driver.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reply-comment',
        input: expect.objectContaining({
          replyText: '我这边有真实案例，可以交流。',
        }),
      }),
    );
    expect(execution.status).toBe('success');
    expect(execution.results).toHaveLength(1);
    expect(execution.results[0].ok).toBe(true);
  });

  it('driver 触达失败 → results 如实 failed（原因码语义映射）', async () => {
    const driver = makeTouchDriver({
      execute: {
        stepName: 'reply-comment',
        status: 'failed',
        reasonCode: 'risk_control',
        message: '平台风控',
        attempt: 1,
        durationMs: 10,
        driverVersion: '1.0.0',
      },
    });
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      undefined, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    const execution = await service.executePlatformFollowUp(
      config,
      makeTargets(),
      10,
    );

    expect(execution.status).toBe('failed');
    expect(execution.results[0].ok).toBe(false);
    expect(execution.results[0].reasonCode).toBe('review_required');
  });

  it('driver 未声明触达支持 → 保持诚实抛错（不伪装完成）', async () => {
    const driver = makeNoTouchDriver();
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      undefined, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    await expect(
      service.executePlatformFollowUp(config, makeTargets(), 10),
    ).rejects.toThrow(/尚未接入/);
  });

  it('registry 为空 → 非抖音/企微平台保持 unsupported 抛错', async () => {
    const service = makeService({}, {}, {}, {}, {});
    const config = makeConfig({ platform: 'kuaishou' });

    await expect(
      service.executePlatformFollowUp(config, makeTargets(), 10),
    ).rejects.toThrow(/尚未接入/);
  });

  it('无回复文案的目标被跳过 → 无可执行触达时抛错', async () => {
    const driver = makeTouchDriver();
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      undefined, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    const targets = [{ targetName: '无文案', text: 'xx', commentReplyText: '' }] as any;
    await expect(
      service.executePlatformFollowUp(config, targets, 10),
    ).rejects.toThrow(/没有可执行的/);
  });

  it('触达路径会话关闭失败 → 落独立 reconcile_required 审计记录（触达无独立执行记录，P1 复核）', async () => {
    const driver = makeTouchDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('close session timeout'));
    const registry = makeRegistry(driver);
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-close-audit' });
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      { create: rpaCreate }, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    const execution = await service.executePlatformFollowUp(
      config,
      makeTargets(),
      10,
    );

    // P1 复核：关闭失败 → 本次触达结果降级 partial（需人工核对），上层据此创建待核对 run
    expect(execution.status).toBe('partial');
    expect(execution.message).toContain('会话关闭失败');
    // P1 复核：关闭失败必须落可追责审计记录（status=reconcile_required）
    expect(driver.closeSession).toHaveBeenCalled();
    expect(rpaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reconcile_required',
        reasonCode: 'session_close_failed',
        mode: 'session-close-audit',
        platform: 'kuaishou',
        accountId: 'douyin-1',
      }),
    );
  });

  it('读评论路径会话关闭失败 → closeState.failed 回传（上层 run 据此标注需人工核对，P1 复核）', async () => {
    const driver = makeTouchDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('close session timeout'));
    // 读评论需要 read-comments 能力
    driver.capabilities = jest.fn().mockResolvedValue({
      platform: 'kuaishou',
      runtimeReady: true,
      actions: [{ action: 'read-comments', supported: true }],
    });
    driver.execute = jest.fn().mockResolvedValue({
      stepName: 'read-comments',
      status: 'success',
      reasonCode: 'ok',
      items: [
        { authorName: '装修用户', text: '这个价格怎么算？' },
        { authorName: '作者', text: '已回复' },
      ],
      attempt: 1,
      durationMs: 10,
      driverVersion: '1.0.0',
    });
    const registry = makeRegistry(driver);
    const rpaCreate = jest.fn().mockResolvedValue({ id: 'rpa-close-audit' });
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      { create: rpaCreate }, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    const closeState = { failed: false };

    const leads = await (service as any).fetchCommentUsersAsLeads(
      config,
      [{ sourceUrl: 'https://www.kuaishou.com/short-video/1' }],
      10,
      closeState,
    );

    // 评论用户已采集（作者回复被过滤）
    expect(leads).toHaveLength(1);
    // P1 复核：关闭失败显式回传调用方
    expect(closeState.failed).toBe(true);
    expect(rpaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'reconcile_required' }),
    );
  });
});

describe('GrowthService 小红书获客执行（D 阶段：发现进线索池，触达待人工）', () => {
  it('platformTouchReady：抖音/企微 true，小红书/快手 false', () => {
    const service = makeService({}, {}, {}, {}, {});
    expect(service.platformTouchReady('douyin')).toBe(true);
    expect(service.platformTouchReady('wechat-channel')).toBe(true);
    expect(service.platformTouchReady('xiaohongshu')).toBe(false);
    expect(service.platformTouchReady('kuaishou')).toBe(false);
  });

  it('growthAutoExecutionCapability：小红书 keyword → 不可无人值守（触达未接入，可手动确认）', () => {
    const service = makeService({}, {}, {}, {}, {});
    const cap = service.growthAutoExecutionCapability(
      makeConfig({ platform: 'xiaohongshu', mode: 'keyword' }),
    );
    expect(cap.ready).toBe(false);
    expect(cap.reason).toContain('手动确认执行');
  });
});

describe('GrowthService P1-2（失败回退可追责）', () => {
  it('RPA driver 失败 → 返回结构化 fallback（来源/执行 ID/原因）', async () => {
    const registry = {
      get: jest.fn().mockReturnValue({
        displayName: '小红书RPA',
        capabilities: jest.fn().mockResolvedValue({
          runtimeReady: true,
          actions: [{ action: 'discover-keyword', supported: false }],
        }),
      }),
    };
    const service = makeService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      registry as never,
    );
    const config = makeConfig({ platform: 'xiaohongshu', mode: 'keyword' });
    const resp = await (service as any).tryFetchCandidatesWithRpaDriver(
      config,
      10,
    );
    expect(resp.ok).toBe(false);
    expect(resp.fallback).toMatchObject({
      attempted: false,
      source: 'legacy-adapter',
      fallbackAllowed: true,
      reasonCode: 'unsupported_action',
    });
    expect(resp.fallback.message).toContain('回退本地适配器');
  });
});

describe('GrowthService 策略诊断推荐模式（P2 复核）', () => {
  it('来源词偏少 → 诊断推荐 recommended（推荐流泛发现补充）', () => {
    const service = makeService();
    const diagnostics = (service as any).strategyDiagnostics({
      sourceKeywords: ['装修'],
      demandKeywords: ['多少钱'],
      excludeKeywords: [],
      commentTemplates: ['a', 'b', 'c'],
      privateMessageTemplates: ['x'],
      scoringRules: [{ label: '需求明确', keywords: ['想'], score: 25 }],
      defaultDailyLimit: 20,
      defaultRiskMode: 'confirm-first',
      scenario: '本地装修获客',
      industry: '装修',
      name: '装修获客策略',
      id: 'strategy-1',
    });
    expect(diagnostics.recommendedModes).toContain('recommended');
    expect(diagnostics.suggestions.join('')).toContain('推荐流发现');
  });

  it('来源词充足 → 不推荐 recommended（有明确关键词来源优先关键词/目标账号）', () => {
    const service = makeService();
    const diagnostics = (service as any).strategyDiagnostics({
      sourceKeywords: ['装修', '全屋定制', '旧房翻新', '同城家装'],
      demandKeywords: ['多少钱'],
      excludeKeywords: ['招聘'],
      commentTemplates: ['a', 'b', 'c'],
      privateMessageTemplates: ['x'],
      scoringRules: [{ label: '需求明确', keywords: ['想'], score: 25 }],
      defaultDailyLimit: 20,
      defaultRiskMode: 'confirm-first',
      scenario: '本地装修获客',
      industry: '装修',
      name: '装修获客策略',
      id: 'strategy-2',
    });
    expect(diagnostics.recommendedModes).not.toContain('recommended');
    expect(diagnostics.recommendedModes).toContain('target-account');
  });
});

describe('GrowthService 桥接分段失败标注（P0-5 复核）', () => {
  it('bridgeAndEnrich 返回 failedSegments → lead.enrichmentStatus=failed + enrichmentFailure 明细（禁假闭环）', async () => {
    const leadBridge = {
      bridgeAndEnrich: jest.fn().mockResolvedValue({
        sourceInteractionEventId: null,
        identityId: null,
        dedupeKey: null,
        eventId: null,
        scoreSnapshotId: null,
        scoreTotal: null,
        scoreRisk: null,
        scoreIdentityConfidence: null,
        scoreConfidence: null,
        scoreReasons: null,
        failedSegments: ['interaction_event', 'scoring'],
        suppressed: false,
        qualification: null,
      }),
    };
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, leadBridge);
    const leads = [{ id: 'lead-1', enrichmentStatus: undefined }] as any;

    await (service as any).bridgeLeadsToUnified(
      { accountId: 'acct-1' },
      leads,
      { userId: 'user-1', tenantId: 'tenant-1' },
    );

    expect(leads[0].enrichmentStatus).toBe('failed');
    expect(leads[0].enrichmentFailure).toBe('interaction_event,scoring');
  });

  it('bridgeAndEnrich 无失败段 → enrichmentStatus=ok', async () => {
    const leadBridge = {
      bridgeAndEnrich: jest.fn().mockResolvedValue({
        eventId: 'event-1',
        identityId: 'id-1',
        dedupeKey: 'k',
        scoreSnapshotId: 's1',
        scoreTotal: 80,
        failedSegments: [],
        suppressed: false,
        qualification: null,
      }),
    };
    const service = makeService({}, {}, {}, {}, {}, undefined, undefined, leadBridge);
    const leads = [{ id: 'lead-2', enrichmentStatus: undefined }] as any;

    await (service as any).bridgeLeadsToUnified(
      { accountId: 'acct-1' },
      leads,
      { userId: 'user-1', tenantId: 'tenant-1' },
    );

    expect(leads[0].enrichmentStatus).toBe('ok');
    expect(leads[0].enrichmentFailure).toBeUndefined();
  });
});

describe('GrowthService CRM 资格门禁（P0-6 复核）', () => {
  it('跟进成功但线索缺可归因身份 → blocked 留人工池（不标 contacted）', () => {
    const service = makeService();
    const leads = [
      {
        id: 'lead-low',
        nickname: '仅昵称用户',
        sourceText: '这个价格怎么算？',
        status: 'new',
        evidenceUrls: [],
        missingFields: ['externalUserId', 'profileUrl'],
      },
    ] as any;
    const execution = {
      status: 'success',
      results: [
        {
          targetName: '仅昵称用户',
          targetText: '这个价格怎么算？',
          ok: true,
          replyText: '可以交流',
          evidence: [{ url: 'https://evidence.local/shot.png' }],
        },
      ],
    } as any;

    (service as any).applyExecutionToLeads(leads, execution);

    // P0-6 复核：缺身份字段 → blocked（不 contacted，不触发自动转 CRM）
    expect(leads[0].status).toBe('blocked');
    expect(leads[0].notes?.[0]?.text).toContain('留人工池');
  });

  it('跟进成功且有真实身份 → contacted（可归因，可转 CRM）', () => {
    const service = makeService();
    const leads = [
      {
        id: 'lead-ok',
        nickname: '装修用户',
        sourceText: '怎么收费？',
        externalUserId: 'douyin-user-ok-1',
        profileUrl: 'https://www.douyin.com/user/ok-1',
        sourceUrl: 'https://www.douyin.com/video/1',
        status: 'new',
        evidenceUrls: [],
        missingFields: [],
      },
    ] as any;
    const execution = {
      status: 'success',
      results: [
        {
          targetName: '装修用户',
          targetText: '怎么收费？',
          ok: true,
          replyText: '可以交流',
          evidence: [{ url: 'https://evidence.local/shot.png' }],
        },
      ],
    } as any;

    (service as any).applyExecutionToLeads(leads, execution);

    expect(leads[0].status).toBe('contacted');
  });

  it('isCrmCaptureEligibleLead：enrichmentStatus=failed → 不转 CRM', () => {
    const service = makeService();
    const eligible = (service as any).isCrmCaptureEligibleLead({
      status: 'contacted',
      externalUserId: 'u1',
      profileUrl: 'https://www.douyin.com/user/u1',
      sourceUrl: 'https://www.douyin.com/video/1',
      enrichmentStatus: 'failed',
      missingFields: [],
    });
    expect(eligible).toBe(false);
  });

  it('isCrmCaptureEligibleLead：suppressed → 不转 CRM', () => {
    const service = makeService();
    const eligible = (service as any).isCrmCaptureEligibleLead({
      status: 'contacted',
      externalUserId: 'u1',
      profileUrl: 'https://www.douyin.com/user/u1',
      sourceUrl: 'https://www.douyin.com/video/1',
      suppressed: true,
      missingFields: [],
    });
    expect(eligible).toBe(false);
  });
});

describe('GrowthService 评论获客证据与去重（P1-10 复核）', () => {
  function makeRegistry(driver?: Record<string, unknown>) {
    return { get: jest.fn().mockReturnValue(driver ?? null) } as any;
  }

  function makeCommentDriver(executeItems: unknown) {
    return {
      displayName: '快手RPA',
      driverVersion: '1.0.0',
      capabilities: jest.fn().mockResolvedValue({
        platform: 'kuaishou',
        runtimeReady: true,
        actions: [{ action: 'read-comments', supported: true }],
      }),
      openSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'ks-c-1', platform: 'kuaishou' }),
      closeSession: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({
        stepName: 'read-comments',
        status: 'success',
        reasonCode: 'ok',
        items: executeItems,
        attempt: 1,
        durationMs: 10,
        driverVersion: '1.0.0',
      }),
    } as any;
  }

  it('读评论 → 线索带来源内容证据 + 身份字段 + 归因链（不传 []）', async () => {
    const driver = makeCommentDriver([
      {
        authorName: '装修用户',
        text: '这个价格怎么算？',
        externalUserId: 'ks-user-1',
        profileUrl: 'https://www.kuaishou.com/profile/ks-user-1',
        externalEventId: 'comment-1',
        externalContentId: 'v1',
        occurredAt: new Date().toISOString(),
      },
    ]);
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      {}, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });

    const leads = await (service as any).fetchCommentUsersAsLeads(
      config,
      [{ sourceUrl: 'https://www.kuaishou.com/short-video/v1' }],
      10,
    );

    expect(leads).toHaveLength(1);
    // P1-10 复核：证据透传（来源内容 URL）+ 身份字段 + 归因链
    expect(leads[0].evidenceUrls).toContain(
      'https://www.kuaishou.com/short-video/v1',
    );
    expect(leads[0]).toMatchObject({
      externalUserId: 'ks-user-1',
      profileUrl: 'https://www.kuaishou.com/profile/ks-user-1',
      sourceArticleId: 'v1',
      contentId: 'v1',
    });
  });

  it('同一用户不同内容上相同评论 → 不去重合并（复合去重键含内容 URL）', async () => {
    const driver = makeCommentDriver([
      {
        authorName: '装修用户',
        text: '这个价格怎么算？',
        externalUserId: 'ks-user-1',
        externalContentId: 'v1',
        sourceUrl: 'https://www.kuaishou.com/short-video/v1',
      },
      {
        authorName: '装修用户',
        text: '这个价格怎么算？',
        externalUserId: 'ks-user-1',
        externalContentId: 'v2',
        sourceUrl: 'https://www.kuaishou.com/short-video/v2',
      },
    ]);
    const registry = makeRegistry(driver);
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      {}, registry,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    // 两个不同内容来源（driver.execute 返回两条不同 externalContentId + sourceUrl 的评论）
    const sourceUrl = 'https://www.kuaishou.com/short-video/v1';

    const leads = await (service as any).fetchCommentUsersAsLeads(
      config,
      [{ sourceUrl }, { sourceUrl: 'https://www.kuaishou.com/short-video/v2' }],
      10,
    );

    // P1-10 复核：复合键（url+externalUserId+nickname+text）下，
    // 同一用户在不同内容上发相同评论 → 不合并（2 条），避免弱去重误合。
    expect(leads).toHaveLength(2);
  });
});

describe('GrowthService 跟进结果匹配（P1-17 复核）', () => {
  it('相同昵称两条线索 → 按 index 精确匹配，不把结果写错线索', () => {
    const service = makeService();
    const leads = [
      {
        id: 'lead-a',
        nickname: '装修用户',
        sourceText: '这个价格怎么算？',
        externalUserId: 'user-a',
        profileUrl: 'https://www.douyin.com/user/a',
        sourceUrl: 'https://www.douyin.com/video/1',
        status: 'new',
        evidenceUrls: [],
        missingFields: [],
      },
      {
        id: 'lead-b',
        nickname: '装修用户',
        sourceText: '什么时候能交付？',
        externalUserId: 'user-b',
        profileUrl: 'https://www.douyin.com/user/b',
        sourceUrl: 'https://www.douyin.com/video/2',
        status: 'new',
        evidenceUrls: [],
        missingFields: [],
      },
    ] as any;
    const execution = {
      status: 'success',
      results: [
        {
          index: 0,
          targetName: '装修用户',
          targetText: '这个价格怎么算？',
          ok: true,
          replyText: '可以交流',
          evidence: [{ url: 'https://evidence.local/a.png' }],
        },
        {
          index: 1,
          targetName: '装修用户',
          targetText: '什么时候能交付？',
          ok: false,
          replyText: '',
          evidence: [],
        },
      ],
    } as any;

    (service as any).applyExecutionToLeads(leads, execution);

    // P1-17 复核：index 精确匹配——lead-a 命中 result[0]（contacted），lead-b 命中 result[1]（blocked）
    expect(leads[0].status).toBe('contacted');
    expect(leads[1].status).toBe('blocked');
    expect(leads[0].evidenceUrls).toContain('https://evidence.local/a.png');
    expect(leads[1].evidenceUrls).not.toContain('https://evidence.local/a.png');
  });
});

describe('GrowthService 保存层统一 dedupeKey 与归因字段（P1-11 复核）', () => {
  it('保存 Lead 用统一 dedupeKey（lead:sha256，非 lead:growth:{id}）+ 归因/质量字段落库', async () => {
    const leadUpsert = jest.fn().mockResolvedValue({ id: 'lead-1' });
    const tx = { lead: { upsert: leadUpsert } };
    const service = makeService({
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    });
    const now = new Date().toISOString();
    const store = makeStore({
      leads: [
        {
          id: 'lead-g1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          platform: 'kuaishou',
          sourceType: 'auto-acquisition',
          sourceAccountId: 'ks-shared',
          sourceTaskId: 'config-1',
          sourceArticleId: 'v-123',
          sourcePublishRecordId: 'pub-1',
          sourceInteractionEventId: 'evt-1',
          contentId: 'v-123',
          nickname: '装修用户',
          externalUserId: 'ks-user-9',
          profileUrl: 'https://www.kuaishou.com/profile/9',
          sourceText: '这个价格怎么算？',
          sourceUrl: 'https://www.kuaishou.com/short-video/v-123',
          matchedKeywords: [],
          score: 80,
          scoreReasons: [],
          status: 'contacted',
          enrichmentStatus: 'failed',
          enrichmentFailure: 'scoring',
          identityConfidence: 90,
          missingFields: [],
          evidenceUrls: [],
          notes: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    await service.saveStoreToDatabase(store, {
      scope: { userId: 'user-1', tenantId: 'tenant-1' },
      collections: ['leads'],
    });

    expect(leadUpsert).toHaveBeenCalledTimes(1);
    const call = leadUpsert.mock.calls[0][0];
    // P1-11 复核：统一 dedupeKey（对齐 LeadRepository 规则，不再硬编码 lead:growth:{id}）
    expect(call.create.dedupeKey).toMatch(/^lead:[0-9a-f]{64}$/);
    expect(call.create.dedupeKey).not.toContain('lead:growth:');
    // P1-11 复核：归因链上游 + 账号 + 质量字段落库
    expect(call.create).toMatchObject({
      sourceAccountId: 'ks-shared',
      sourceArticleId: 'v-123',
      sourcePublishRecordId: 'pub-1',
      sourceInteractionEventId: 'evt-1',
      enrichmentStatus: 'failed',
      identityConfidence: 90,
      missingFields: [],
    });
    // 同一 externalUserId 时与 LeadRepository.dedupeKeyOf 完全一致
    const { LeadRepository } = require('../leads/lead.repository');
    expect(call.create.dedupeKey).toBe(
      LeadRepository.dedupeKeyOf({
        platform: 'kuaishou',
        externalUserId: 'ks-user-9',
        nickname: '装修用户',
        sourceText: '这个价格怎么算？',
      }),
    );
  });

  it('无 externalUserId 时 dedupeKey 走 nick+text 规则（与统一侧一致）', async () => {
    const leadUpsert = jest.fn().mockResolvedValue({ id: 'lead-2' });
    const tx = { lead: { upsert: leadUpsert } };
    const service = makeService({
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    });
    const now = new Date().toISOString();
    const store = makeStore({
      leads: [
        {
          id: 'lead-g2',
          userId: 'user-1',
          tenantId: 'tenant-1',
          platform: 'douyin',
          sourceType: 'auto-acquisition',
          sourceTaskId: 'config-2',
          nickname: '仅昵称用户',
          sourceText: '怎么联系',
          matchedKeywords: [],
          score: 60,
          scoreReasons: [],
          status: 'new',
          evidenceUrls: [],
          notes: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    await service.saveStoreToDatabase(store, {
      scope: { userId: 'user-1', tenantId: 'tenant-1' },
      collections: ['leads'],
    });

    const call = leadUpsert.mock.calls[0][0];
    expect(call.create.dedupeKey).toMatch(/^lead:[0-9a-f]{64}$/);
    expect(call.create.enrichmentStatus).toBeUndefined();
    expect(call.create.identityConfidence).toBeUndefined();
  });
});

describe('GrowthService 无来源 URL 候选（P1-12 复核）', () => {
  it('微信 manual-import 纯文本候选 → sourceUrl=undefined + missingFields 含 sourceUrl（人工待补，不冒充来源）', async () => {
    const service = makeService();
    const config = makeConfig({
      platform: 'wechat',
      mode: 'manual-import',
      sourceInputs: ['王老板（装修公司，微信昵称老王）'],
    });

    const resp = (service as any).fetchCandidatesWithPlatformAdapter(config);

    expect(resp.ok).toBe(true);
    expect(resp.candidates[0].sourceUrl).toBeUndefined();
    const lead = (service as any).createLeadFromCandidate(
      config.userId,
      config,
      resp.candidates[0],
      0,
      [],
    );
    // P1-12 复核：无来源内容证据 → 显式标注缺失，只能人工待补
    expect(lead.missingFields).toContain('sourceUrl');
    // P0-6 门禁兜底：不进 CRM
    expect((service as any).isCrmCaptureEligibleLead({ ...lead, status: 'contacted' })).toBe(false);
  });

  it('视频号 manual-import URL 文本 → sourceUrl 保留为来源证据', async () => {
    const service = makeService();
    const config = makeConfig({
      platform: 'wechat-channel',
      mode: 'manual-import',
      sourceInputs: ['https://channels.weixin.qq.com/video/abc123'],
    });

    const resp = (service as any).fetchCandidatesWithPlatformAdapter(config);

    expect(resp.candidates[0].sourceUrl).toBe(
      'https://channels.weixin.qq.com/video/abc123',
    );
    const lead = (service as any).createLeadFromCandidate(
      config.userId,
      config,
      resp.candidates[0],
      0,
      [],
    );
    expect(lead.missingFields).not.toContain('sourceUrl');
  });
});

describe('GrowthService 合成 RPA 记录审计标注（P1-14 复核）', () => {
  it('persistRpaExecution 合成路径 → source=growth-synthesis（不冒充 driver 真实执行）', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'rpa-synth-1' });
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      { create, findOne: jest.fn() } as never,
    );
    const now = new Date().toISOString();
    const config = makeConfig({ platform: 'kuaishou' });
    const run = {
      id: 'run-1',
      status: 'success',
      candidateCount: 3,
      selectedCount: 2,
      contactedCount: 1,
      evidenceUrls: ['https://evidence.local/a.png'],
    } as any;

    const ok = await (service as any).persistRpaExecution(
      config,
      run,
      {
        status: 'success',
        message: '获客完成',
        candidateCount: 3,
        selectedCount: 2,
        contactedCount: 1,
        evidenceUrls: ['https://evidence.local/a.png'],
      },
      'tenant-1',
      null,
    );

    expect(ok).toBe(true);
    // P1-14 复核：合成记录显式标注 source，审计可区分真实浏览器执行
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'growth-synthesis',
        status: 'success',
        runId: 'run-1',
      }),
    );
  });

  it('persistRpaExecution 有 driver 真实记录 + 成功 → 跳过合成（不重复留痕）', async () => {
    const create = jest.fn();
    const service = makeService(
      {}, {}, {}, {}, {},
      undefined, undefined, undefined, undefined,
      { create, findOne: jest.fn() } as never,
    );
    const config = makeConfig({ platform: 'kuaishou' });
    const run = { id: 'run-2', status: 'success' } as any;

    const ok = await (service as any).persistRpaExecution(
      config,
      run,
      { status: 'success', message: 'ok', candidateCount: 1, selectedCount: 1, contactedCount: 1 },
      'tenant-1',
      'driver-record-1',
    );

    expect(ok).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
