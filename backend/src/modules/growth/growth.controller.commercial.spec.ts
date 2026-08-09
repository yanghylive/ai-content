import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AiEmployeeService } from '../ai-employee/ai-employee.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

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

function scheduleEnableConfirmation() {
  return {
    confirmed: true,
    confirmedAction: 'schedule-enable',
    confirmedRiskLevel: 'high',
  };
}

function batchTouchConfirmation() {
  return {
    confirmed: true,
    confirmedAction: 'batch-touch',
    confirmedRiskLevel: 'high',
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: 'config-commercial-remediate',
    userId: 'local-user',
    tenantId: 'tenant-commercial',
    mode: 'keyword',
    taskName: '商用闭环自动获客任务',
    platform: 'douyin',
    accountId: 'douyin-1',
    accountName: '大壮抖音号',
    sourceInputs: ['装修'],
    includeKeywords: ['多少钱'],
    excludeKeywords: [],
    blacklistNicknames: [],
    commentTemplates: ['可以交流一下。'],
    privateMessageTemplates: [],
    dailyLimit: 1,
    perTargetLimit: 1,
    deduplicate: true,
    scheduleEnabled: false,
    beginTime: '00:00',
    riskMode: 'auto',
    status: 'enabled',
    exposureCount: 0,
    exposureDate: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('GrowthController commercial API acceptance', () => {
  let app: INestApplication;
  let service: any;
  let store: any;
  let aiEmployee: {
    findDouyinHotVideoLeads: jest.Mock;
    planDouyinFollowUp: jest.Mock;
    executeDouyinFollowUp: jest.Mock;
  };
  let autoUpload: {
    listAccounts: jest.Mock;
    getAccountHealth: jest.Mock;
  };
  const originalGrowthExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;
  const originalGrowthSchedulerDaemon = process.env.GROWTH_SCHEDULER_DAEMON;
  const originalGrowthSchedulerRealDaemonAllowed =
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;

  beforeEach(async () => {
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    process.env.GROWTH_SCHEDULER_DAEMON = 'true';
    delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    store = makeStore();
    const candidate = {
      text: '最近想装修改造，想问一下本地大概多少钱？',
      targetName: '本地装修咨询客户',
      profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-commercial-api',
      sourceUrl: 'https://www.douyin.com/video/654321',
      videoUrl: 'https://www.douyin.com/video/654321',
      videoTitle: '旧房翻新避坑',
      kind: 'hot-video-comment',
      score: 92,
      reason: '明确询价和本地需求',
    };
    const target = {
      ...candidate,
      index: 0,
      sourceText:
        '目标：本地装修咨询客户\n最近想装修改造，想问一下本地大概多少钱？',
      commentReplyText: '我这边刚好有本地旧房翻新案例，可以交流一下。',
      commentTaskEnabled: true,
      messageTaskEnabled: false,
      followUpActions: ['comment'],
    };
    aiEmployee = {
      findDouyinHotVideoLeads: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: '已采集到 1 条高意向评论。',
        candidates: [candidate],
        evidence: [
          {
            type: 'json',
            label: '候选采集',
            url: 'https://evidence.local/api-candidates.json',
          },
        ],
      }),
      planDouyinFollowUp: jest.fn().mockResolvedValue({
        sourceLabel: '抖音',
        sourceText: '装修',
        accountName: '大壮抖音号',
        targets: [target],
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
            replyText: target.commentReplyText,
            ok: true,
            status: 'success',
            message: '发送成功且回读一致',
            evidence: [
              {
                type: 'screenshot',
                label: '评论发送回读',
                url: 'https://evidence.local/api-send.png',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ],
      }),
    };
    autoUpload = {
      listAccounts: jest.fn().mockResolvedValue([
        {
          id: 'douyin-1',
          type: 3,
          platform: '抖音',
          profileName: '大壮抖音号',
          status: 1,
        },
      ]),
      getAccountHealth: jest
        .fn()
        .mockResolvedValue({ issues: [], checkedAt: new Date().toISOString() }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [GrowthController],
      providers: [
        GrowthService,
        { provide: AiEmployeeService, useValue: aiEmployee },
        { provide: AutoUploadService, useValue: autoUpload },
        { provide: PrismaService, useValue: {} },
        { provide: RuntimeOrchestrator, useValue: {} },
      ],
    }).compile();

    service = moduleFixture.get(GrowthService) as any;
    service.migrateLocalStoreToDatabase = jest.fn(async () => undefined);
    service.loadStore = jest.fn(async () => store);
    service.saveStore = jest.fn(async (next: any) => {
      store = next;
    });
    service.resolveGrowthTenantId = jest
      .fn()
      .mockResolvedValue('tenant-commercial');

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    if (originalGrowthExecutionEnabled === undefined) {
      delete process.env.GROWTH_EXECUTION_ENABLED;
    } else {
      process.env.GROWTH_EXECUTION_ENABLED = originalGrowthExecutionEnabled;
    }
    if (originalGrowthSchedulerDaemon === undefined) {
      delete process.env.GROWTH_SCHEDULER_DAEMON;
    } else {
      process.env.GROWTH_SCHEDULER_DAEMON = originalGrowthSchedulerDaemon;
    }
    if (originalGrowthSchedulerRealDaemonAllowed === undefined) {
      delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    } else {
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED =
        originalGrowthSchedulerRealDaemonAllowed;
    }
  });

  it('reports runtime switches for live commercial gates', async () => {
    const response = await request(app.getHttpServer())
      .get('/growth/runtime-status')
      .expect(200);

    expect(response.body).toMatchObject({
      executionEnabled: true,
      schedulerDaemonEnabled: true,
      schedulerDaemonArmed: false,
      mode: 'live-execution',
    });
  });

  it('only arms the scheduler daemon when real daemon execution is explicitly allowed', async () => {
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';

    const response = await request(app.getHttpServer())
      .get('/growth/runtime-status')
      .expect(200);

    expect(response.body).toMatchObject({
      executionEnabled: true,
      schedulerDaemonEnabled: true,
      schedulerDaemonArmed: true,
      mode: 'live-execution',
    });
  });

  it('reports commercial readiness blockers without triggering external execution', async () => {
    const response = await request(app.getHttpServer())
      .get('/growth/commercial-readiness')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'blocked',
      runtime: {
        executionEnabled: true,
        schedulerDaemonEnabled: true,
        schedulerDaemonArmed: false,
      },
      accounts: {
        total: 1,
        onlineNormal: 1,
      },
      plan: {
        readyCount: 0,
        itemCount: 0,
      },
    });
    expect(
      response.body.blockers.map((item: { code: string }) => item.code),
    ).toEqual(
      expect.arrayContaining([
        'scheduler-daemon-not-armed',
        'no-ready-auto-task',
      ]),
    );
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
    expect(autoUpload.listAccounts).toHaveBeenCalledWith({
      validate: true,
      force: true,
    });
  });

  it('requires explicit confirmation before commercial readiness remediation can enable auto scheduling', async () => {
    store = makeStore({
      configs: [makeConfig()],
    });

    const response = await request(app.getHttpServer())
      .post('/growth/commercial-readiness/remediate')
      .send({})
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(store.configs[0].scheduleEnabled).toBe(false);
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('remediates eligible real-account tasks into the background schedule without executing them', async () => {
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    store = makeStore({
      configs: [makeConfig()],
    });

    const response = await request(app.getHttpServer())
      .post('/growth/commercial-readiness/remediate')
      .send({ riskConfirmation: scheduleEnableConfirmation() })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'changed',
      changedCount: 1,
      refreshedAccountCount: 1,
      enabledConfigIds: ['config-commercial-remediate'],
      requiresHumanLogin: false,
      readiness: {
        runtime: {
          executionEnabled: true,
          schedulerDaemonArmed: true,
        },
        plan: {
          readyCount: 1,
        },
      },
    });
    expect(store.configs[0]).toMatchObject({
      id: 'config-commercial-remediate',
      scheduleEnabled: true,
      status: 'enabled',
      riskMode: 'auto',
    });
    const auditsResponse = await request(app.getHttpServer())
      .get('/growth/commercial-readiness/audits?limit=5')
      .expect(200);
    expect(auditsResponse.body[0]).toMatchObject({
      action: 'commercial-readiness-remediate',
      status: 'changed',
      runtime: {
        executionEnabled: true,
        schedulerDaemonArmed: true,
      },
      accounts: {
        total: 1,
        onlineNormal: 1,
        blocked: 0,
      },
      plan: {
        readyCount: 1,
        itemCount: 1,
      },
      blockers: [],
      result: {
        changedCount: 1,
      },
    });
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('keeps remediation blocked instead of faking readiness when the account needs human login', async () => {
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    autoUpload.listAccounts.mockResolvedValue([
      {
        id: 'douyin-1',
        type: 3,
        platform: '抖音',
        profileName: '大壮抖音号',
        status: 0,
      },
    ]);
    store = makeStore({
      configs: [makeConfig()],
    });

    const response = await request(app.getHttpServer())
      .post('/growth/commercial-readiness/remediate')
      .send({ riskConfirmation: scheduleEnableConfirmation() })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'blocked',
      changedCount: 0,
      requiresHumanLogin: true,
      readiness: {
        status: 'blocked',
      },
    });
    expect(
      response.body.readiness.blockers.map(
        (item: { code: string }) => item.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        'no-online-normal-account',
        'no-ready-auto-task',
      ]),
    );
    const auditsResponse = await request(app.getHttpServer())
      .get('/growth/commercial-readiness/audits?limit=5')
      .expect(200);
    expect(auditsResponse.body[0]).toMatchObject({
      action: 'commercial-readiness-remediate',
      status: 'blocked',
      accounts: {
        total: 1,
        onlineNormal: 0,
        blocked: 1,
      },
      plan: {
        readyCount: 0,
      },
      result: {
        changedCount: 0,
      },
    });
    expect(
      auditsResponse.body[0].blockers.map(
        (item: { code: string }) => item.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        'no-online-normal-account',
        'no-ready-auto-task',
      ]),
    );
    expect(store.configs[0].scheduleEnabled).toBe(false);
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before enabling scheduled automatic external execution', async () => {
    const response = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '未确认自动执行任务',
        mode: 'keyword',
        platform: 'douyin',
        accountId: 'douyin-1',
        accountName: '大壮抖音号',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱'],
        commentTemplates: ['可以交流一下。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: true,
        beginTime: '00:00',
        riskMode: 'auto',
      })
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(store.configs).toHaveLength(0);
  });

  it('requires explicit confirmation before running true external acquisition execution APIs', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '执行闸口验收任务',
        mode: 'keyword',
        platform: 'douyin',
        accountId: 'douyin-1',
        accountName: '大壮抖音号',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱'],
        commentTemplates: ['可以交流一下。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: true,
        beginTime: '00:00',
        riskMode: 'auto',
        riskConfirmation: scheduleEnableConfirmation(),
      })
      .expect(201);

    const executeResponse = await request(app.getHttpServer())
      .post(`/growth/acquisition/configs/${createResponse.body.id}/execute`)
      .expect(400);
    expect(executeResponse.body.message).toContain('后端风控要求人工确认');

    const scheduleRunResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/schedule/run')
      .send({ limit: 5 })
      .expect(400);
    expect(scheduleRunResponse.body.message).toContain('后端风控要求人工确认');
    expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('runs a confirm-first task once only after batch-touch confirmation', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '确认后执行获客任务',
        mode: 'keyword',
        platform: 'douyin',
        accountId: 'douyin-1',
        accountName: '大壮抖音号',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱'],
        commentTemplates: ['可以交流一下。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: false,
        beginTime: '00:00',
        riskMode: 'confirm-first',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/growth/acquisition/configs/${createResponse.body.id}/preflight`)
      .expect(200);

    const blocked = await request(app.getHttpServer())
      .post(`/growth/acquisition/configs/${createResponse.body.id}/execute`)
      .send({})
      .expect(400);
    expect(blocked.body.message).toContain('后端风控要求人工确认');
    expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();

    const executed = await request(app.getHttpServer())
      .post(`/growth/acquisition/configs/${createResponse.body.id}/execute`)
      .send({ riskConfirmation: batchTouchConfirmation() })
      .expect(201);
    expect(executed.body.run).toMatchObject({
      status: 'success',
      contactedCount: 1,
    });
    expect(aiEmployee.findDouyinHotVideoLeads).toHaveBeenCalledTimes(1);
    expect(aiEmployee.executeDouyinFollowUp).toHaveBeenCalledTimes(1);
  });

  it('executes the full commercial acquisition API flow and persists visible business results', async () => {
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';
    const createResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '装修客户自动获客 API 商用验收',
        mode: 'keyword',
        platform: 'douyin',
        accountId: 'douyin-1',
        accountName: '大壮抖音号',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱', '本地'],
        excludeKeywords: ['招聘'],
        blacklistNicknames: ['广告号'],
        commentTemplates: ['我这边刚好有本地旧房翻新案例，可以交流一下。'],
        privateMessageTemplates: ['我可以先发你一份避坑清单，你看完再决定。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: true,
        beginTime: '00:00',
        riskMode: 'auto',
        riskConfirmation: scheduleEnableConfirmation(),
      })
      .expect(201);
    const configId = createResponse.body.id;
    expect(configId).toBeTruthy();

    const preflightResponse = await request(app.getHttpServer())
      .get(`/growth/acquisition/configs/${configId}/preflight`)
      .expect(200);
    expect(preflightResponse.body).toMatchObject({
      allowed: true,
      summary: expect.stringContaining('真实执行器'),
      remainingToday: 1,
    });

    const schedulePlanResponse = await request(app.getHttpServer())
      .get('/growth/acquisition/schedule-plan')
      .expect(200);
    expect(schedulePlanResponse.body).toMatchObject({
      readyCount: 1,
      items: [
        expect.objectContaining({
          configId,
          status: 'ready',
          remainingToday: 1,
        }),
      ],
    });

    const runResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/schedule/run')
      .send({ limit: 5, riskConfirmation: batchTouchConfirmation() })
      .expect(201);
    expect(runResponse.body).toMatchObject({
      executedCount: 1,
      results: [
        expect.objectContaining({
          run: expect.objectContaining({
            status: 'success',
            candidateCount: 1,
            selectedCount: 1,
            contactedCount: 1,
            evidenceUrls: expect.arrayContaining([
              'https://evidence.local/api-candidates.json',
              'https://evidence.local/api-send.png',
            ]),
          }),
          leads: [
            expect.objectContaining({
              status: 'contacted',
              sourceTaskId: configId,
              sourceRunId: expect.any(String),
              latestReply: '我这边刚好有本地旧房翻新案例，可以交流一下。',
            }),
          ],
        }),
      ],
    });
    const auditsResponse = await request(app.getHttpServer())
      .get('/growth/commercial-readiness/audits?limit=5')
      .expect(200);
    expect(auditsResponse.body[0]).toMatchObject({
      action: 'acquisition-schedule-run',
      status: 'ready',
      runtime: {
        executionEnabled: true,
        schedulerDaemonArmed: true,
      },
      accounts: {
        total: 1,
        onlineNormal: 1,
      },
      plan: {
        readyCount: 1,
        itemCount: 1,
      },
      blockers: [],
      result: {
        executedCount: 1,
        requestedLimit: 5,
        trigger: 'manual',
      },
    });

    const runsResponse = await request(app.getHttpServer())
      .get('/growth/acquisition/runs')
      .expect(200);
    expect(runsResponse.body).toHaveLength(1);
    expect(runsResponse.body[0]).toMatchObject({
      configId,
      status: 'success',
      leadIds: [store.leads[0].id],
    });

    const leadsResponse = await request(app.getHttpServer())
      .get('/growth/leads')
      .expect(200);
    expect(leadsResponse.body).toHaveLength(1);
    expect(leadsResponse.body[0]).toMatchObject({
      sourceTaskId: configId,
      sourceRunId: runsResponse.body[0].id,
      status: 'contacted',
    });

    const exhaustedPlanResponse = await request(app.getHttpServer())
      .get('/growth/acquisition/schedule-plan')
      .expect(200);
    expect(exhaustedPlanResponse.body.items[0]).toMatchObject({
      configId,
      status: 'exhausted',
      remainingToday: 0,
    });

    const secondRunResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/schedule/run')
      .send({ limit: 5, riskConfirmation: batchTouchConfirmation() })
      .expect(201);
    expect(secondRunResponse.body.executedCount).toBe(0);
    expect(aiEmployee.executeDouyinFollowUp).toHaveBeenCalledTimes(1);

    const reportsResponse = await request(app.getHttpServer())
      .get('/growth/reports?range=7d')
      .expect(200);
    expect(reportsResponse.body.overview).toMatchObject({
      todayLeadCount: 1,
      todayContactedCount: 1,
      activeConfigCount: 1,
    });
    expect(reportsResponse.body.funnel).toMatchObject({
      candidates: 1,
      selected: 1,
      contacted: 1,
    });
    expect(reportsResponse.body.taskPerformance[0]).toMatchObject({
      configId,
      runCount: 1,
      contactedCount: 1,
    });
    expect(store.configs[0]).toMatchObject({
      id: configId,
      exposureCount: 1,
      tenantId: 'tenant-commercial',
    });
    expect(store.runs).toHaveLength(1);
    expect(store.leads).toHaveLength(1);
  });

  it('blocks true API execution when the executable account cannot be verified', async () => {
    autoUpload.listAccounts.mockResolvedValue([]);
    const createResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '缺失账号阻断验收',
        mode: 'keyword',
        platform: 'douyin',
        accountId: 'missing-account',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱'],
        commentTemplates: ['可以交流一下。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: true,
        beginTime: '00:00',
        riskMode: 'auto',
        riskConfirmation: scheduleEnableConfirmation(),
      })
      .expect(201);

    const preflightResponse = await request(app.getHttpServer())
      .get(`/growth/acquisition/configs/${createResponse.body.id}/preflight`)
      .expect(200);
    expect(preflightResponse.body).toMatchObject({
      allowed: false,
      account: expect.objectContaining({
        accountId: 'missing-account',
        accountName: '抖音',
        loginStatus: 'expired',
        riskStatus: 'needs-human',
      }),
      blockers: expect.arrayContaining([
        '账号未在线或需要人工验证。',
        '账号风险状态为 needs-human。',
      ]),
    });
    expect(preflightResponse.body.account.recommendation).toContain(
      '发布中心-平台账号',
    );

    const executeResponse = await request(app.getHttpServer())
      .post(`/growth/acquisition/configs/${createResponse.body.id}/execute`)
      .send({ riskConfirmation: batchTouchConfirmation() })
      .expect(201);
    expect(executeResponse.body.run).toMatchObject({
      status: 'skipped',
      failureReason: 'account_not_logged_in',
      message: '账号 抖音 未登录或已过期，已阻止自动获客执行。',
    });
    expect(executeResponse.body.leads).toHaveLength(0);
    expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();

    const reportsResponse = await request(app.getHttpServer())
      .get('/growth/reports?range=7d')
      .expect(200);
    expect(reportsResponse.body.bottlenecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'danger',
          title: '账号健康正在限制获客执行',
        }),
      ]),
    );
    expect(
      reportsResponse.body.bottlenecks.some(
        (item: { title?: string }) => item.title === '当前增长链路没有明显阻塞',
      ),
    ).toBe(false);
  });

  it('does not treat account-only platforms as executable automatic acquisition', async () => {
    autoUpload.listAccounts.mockResolvedValue([
      {
        id: 'xhs-1',
        type: 1,
        platform: '小红书',
        profileName: '小红书门店号',
        status: 1,
      },
    ]);
    const createResponse = await request(app.getHttpServer())
      .post('/growth/acquisition/configs')
      .send({
        taskName: '小红书账号纳管不能冒充自动获客',
        mode: 'keyword',
        platform: 'xiaohongshu',
        accountId: 'xhs-1',
        sourceInputs: ['装修'],
        includeKeywords: ['多少钱'],
        commentTemplates: ['可以交流一下。'],
        dailyLimit: 1,
        perTargetLimit: 1,
        scheduleEnabled: true,
        beginTime: '00:00',
        riskMode: 'auto',
        riskConfirmation: scheduleEnableConfirmation(),
      })
      .expect(201);

    const planResponse = await request(app.getHttpServer())
      .get('/growth/acquisition/schedule-plan')
      .expect(200);
    expect(planResponse.body.readyCount).toBe(0);
    expect(planResponse.body.items[0]).toMatchObject({
      configId: createResponse.body.id,
      status: 'blocked',
    });
    expect(planResponse.body.items[0].reason).toContain(
      '增长自动触达执行器未接入',
    );

    const preflightResponse = await request(app.getHttpServer())
      .get(`/growth/acquisition/configs/${createResponse.body.id}/preflight`)
      .expect(200);
    expect(preflightResponse.body.allowed).toBe(false);
    expect(preflightResponse.body.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('增长自动触达执行器未接入'),
      ]),
    );

    const executeResponse = await request(app.getHttpServer())
      .post(`/growth/acquisition/configs/${createResponse.body.id}/execute`)
      .send({ riskConfirmation: batchTouchConfirmation() })
      .expect(201);
    expect(executeResponse.body.run).toMatchObject({
      status: 'skipped',
      failureReason: 'engine_unavailable',
    });
    expect(executeResponse.body.run.message).toContain(
      '增长自动触达执行器未接入',
    );
    expect(aiEmployee.findDouyinHotVideoLeads).not.toHaveBeenCalled();
    expect(aiEmployee.executeDouyinFollowUp).not.toHaveBeenCalled();
  });
});
