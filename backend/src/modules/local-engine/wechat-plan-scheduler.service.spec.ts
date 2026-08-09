import { WechatPlanSchedulerService } from './wechat-plan-scheduler.service';

describe('WechatPlanSchedulerService', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');

  function task(overrides: Record<string, unknown> = {}) {
    return {
      id: 'wechat-plan-1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      taskType: 'WECHAT_GROUP_BROADCAST',
      sendMode: 'auto-send',
      status: 'QUEUED',
      stage: null,
      sessionId: null,
      currentTarget: '客户甲',
      batchTargets: [
        {
          id: 'target-1',
          targetName: '客户甲',
          status: 'queued',
        },
      ],
      events: [],
      config: {
        type: 'wechat-group-broadcast',
        planName: '午间跟进',
        planStatus: 'scheduled',
        planTime: '2026-07-10T11:59:00.000Z',
        sourceText: '给客户甲发送预约提醒',
        riskLevel: 'low',
        safetyBoundary: {
          commercialExecutionAllowed: true,
          requestedCommercialExecution: true,
        },
        metadata: {
          skill_id: 'wechat.group.broadcast',
          agent_s_instruction: '给客户甲发送预约提醒',
        },
      },
      createdBy: 'user-1',
      updatedAt: new Date('2026-07-10T11:58:00.000Z'),
      ...overrides,
    };
  }

  function setup(input: {
    queued?: ReturnType<typeof task>[];
    running?: ReturnType<typeof task>[];
    events?: Array<Record<string, unknown>>;
    connected?: boolean;
  }) {
    const interactionTask = {
      findMany: jest.fn(async ({ where }: { where: { status: unknown } }) =>
        where.status === 'QUEUED' ? input.queued || [] : input.running || [],
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    };
    const prisma = { interactionTask };
    const agentS = {
      ensureRunning: jest.fn(async () => ({
        connected: input.connected !== false,
        lastError: input.connected === false ? 'Agent-S 未连接' : undefined,
      })),
      createSession: jest.fn(async () => ({
        session: { session_id: 'agent-session-1' },
      })),
      runTask: jest.fn(async () => ({ accepted: true })),
      getEvents: jest.fn(async () => ({
        session_id: 'agent-session-1',
        after_seq: 0,
        next_seq: 1,
        events: input.events || [],
      })),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'WECHAT_PLAN_SCHEDULER_ENABLED' ? 'true' : undefined,
      ),
    };
    const service = new WechatPlanSchedulerService(
      config as never,
      prisma as never,
      agentS as never,
    );
    return { service, interactionTask, agentS };
  }

  it('dispatches a due authorized plan through Agent-S', async () => {
    const { service, interactionTask, agentS } = setup({ queued: [task()] });

    await expect(service.runOnce(now)).resolves.toEqual({
      dispatched: 1,
      reconciled: 0,
    });

    expect(agentS.ensureRunning).toHaveBeenCalled();
    expect(agentS.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'wechat.group.broadcast',
        metadata: expect.objectContaining({
          interaction_task_id: 'wechat-plan-1',
          tenant_id: 'tenant-a',
          user_id: 'user-a',
        }),
      }),
    );
    expect(agentS.runTask).toHaveBeenCalledWith(
      'agent-session-1',
      expect.objectContaining({ requires_approval: false }),
    );
    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'wechat-plan-1',
          tenantId: 'tenant-a',
          userId: 'user-a',
        },
        data: expect.objectContaining({
          sessionId: 'agent-session-1',
          status: 'RUNNING',
        }),
      }),
    );
  });

  it('keeps the plan queued for a bounded retry when Agent-S is offline', async () => {
    const { service, interactionTask } = setup({
      queued: [task()],
      connected: false,
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUEUED',
          stage: 'agent-s-scheduled-retry',
          config: expect.objectContaining({
            planStatus: 'scheduled',
            scheduler: expect.objectContaining({ attempts: 1 }),
          }),
        }),
      }),
    );
  });

  it('does not mark Agent-S completion as delivered without readback', async () => {
    const running = task({
      status: 'RUNNING',
      stage: 'agent-s-scheduled-running',
      sessionId: 'agent-session-1',
    });
    const { service, interactionTask } = setup({
      running: [running],
      events: [
        {
          seq: 1,
          event_type: 'RunCompleted',
          status: 'completed',
          payload: {},
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BLOCKED',
          config: expect.objectContaining({
            failureReason: expect.stringContaining('没有返回完整'),
          }),
        }),
      }),
    );
  });

  it('marks a plan complete only when Agent-S returns delivery readback', async () => {
    const running = task({
      status: 'RUNNING',
      stage: 'agent-s-scheduled-running',
      sessionId: 'agent-session-1',
    });
    const { service, interactionTask } = setup({
      running: [running],
      events: [
        {
          seq: 1,
          event_type: 'DeliveryReadbackCompleted',
          status: 'completed',
          payload: {
            readbackText: '客户甲 已收到预约提醒',
            completedTargets: ['客户甲'],
          },
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          config: expect.objectContaining({
            planStatus: 'completed',
            readbackRefs: expect.arrayContaining([
              'readbackText:客户甲 已收到预约提醒',
            ]),
          }),
        }),
      }),
    );
  });

  it('keeps per-target success and failure instead of marking a partial batch complete', async () => {
    const running = task({
      status: 'RUNNING',
      stage: 'agent-s-immediate-running',
      sessionId: 'agent-session-1',
      batchTargets: [
        { id: 'target-1', targetName: '客户甲', status: 'queued' },
        { id: 'target-2', targetName: '客户乙', status: 'queued' },
      ],
    });
    const { service, interactionTask } = setup({
      running: [running],
      events: [
        {
          seq: 1,
          session_id: 'agent-session-1',
          event_type: 'SkillTargetCompleted',
          status: 'running',
          message: '客户甲已发送',
          payload: {
            target: '客户甲',
            screenshotPath: '/tmp/customer-a.png',
            readback: { matched: true, actualText: '客户甲已发送' },
          },
        },
        {
          seq: 2,
          session_id: 'agent-session-1',
          event_type: 'SkillTargetFailed',
          status: 'running',
          message: '客户乙发送失败',
          payload: { target: '客户乙', error: '目标窗口未找到' },
        },
        {
          seq: 3,
          session_id: 'agent-session-1',
          event_type: 'SkillFailed',
          status: 'failed',
          message: '部分对象失败',
          payload: {},
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          batchTargets: [
            expect.objectContaining({
              targetName: '客户甲',
              status: 'completed',
              evidenceEventIds: expect.arrayContaining([
                'agent-s:agent-session-1:1',
              ]),
            }),
            expect.objectContaining({
              targetName: '客户乙',
              status: 'failed',
              failureReason: '目标窗口未找到',
              evidenceEventIds: expect.arrayContaining([
                'agent-s:agent-session-1:2',
              ]),
            }),
          ],
          batchSummary: expect.objectContaining({ completed: 1, failed: 1 }),
        }),
      }),
    );
  });

  it('absorbs late readback for a paused task instead of leaving it eligible for duplicate resume', async () => {
    const paused = task({
      status: 'PAUSED',
      stage: 'agent-s-immediate-running',
      sessionId: 'agent-session-1',
      batchTargets: [
        {
          id: 'target-1',
          targetName: '客户甲',
          status: 'failed',
          failureReason: '暂停发生在执行中，发送状态不确定。',
        },
        { id: 'target-2', targetName: '客户乙', status: 'queued' },
      ],
    });
    const { service, interactionTask } = setup({
      running: [paused],
      events: [
        {
          seq: 1,
          session_id: 'agent-session-1',
          event_type: 'SkillTargetCompleted',
          status: 'running',
          message: '客户甲已发送并回读',
          payload: {
            target: '客户甲',
            readback: { matched: true, actualText: '客户甲已收到' },
          },
        },
        {
          seq: 2,
          session_id: 'agent-session-1',
          event_type: 'SkillCancelled',
          status: 'cancelled',
          message: '任务已暂停',
          payload: { preserveCompletedTargets: true },
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAUSED',
          batchTargets: [
            expect.objectContaining({
              targetName: '客户甲',
              status: 'completed',
            }),
            expect.objectContaining({
              targetName: '客户乙',
              status: 'queued',
            }),
          ],
        }),
      }),
    );
  });

  it('records friend acceptance with no matching test request as no-target', async () => {
    const running = task({
      taskType: 'WECHAT_FRIEND_ACCEPT',
      status: 'RUNNING',
      stage: 'agent-s-immediate-running',
      sessionId: 'agent-session-1',
      batchTargets: [
        { id: 'friend-scan', targetName: '新的好友申请', status: 'queued' },
      ],
      config: {
        type: 'wechat-friend-accept',
        planName: '测试好友申请',
        planStatus: 'sending',
        metadata: { skill_id: 'wechat.friend.accept' },
      },
    });
    const { service, interactionTask } = setup({
      running: [running],
      events: [
        {
          seq: 1,
          session_id: 'agent-session-1',
          event_type: 'SkillCompleted',
          status: 'completed',
          message: '当前没有待处理的微信对象。',
          payload: {
            noTarget: true,
            screenshotPath: '/tmp/friend-scan.png',
          },
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'NO_TARGET',
          batchTargets: [expect.objectContaining({ status: 'no_target' })],
          config: expect.objectContaining({
            status: 'no_target',
            nextAction: expect.stringContaining('未执行微信写入'),
          }),
        }),
      }),
    );
  });

  it('skips rows that do not have an explicit tenant and user scope', async () => {
    const { service, interactionTask, agentS } = setup({
      queued: [task({ tenantId: '', userId: '' })],
    });

    await expect(service.runOnce(now)).resolves.toEqual({
      dispatched: 0,
      reconciled: 0,
    });

    expect(agentS.createSession).not.toHaveBeenCalled();
    expect(interactionTask.updateMany).not.toHaveBeenCalled();
    expect(interactionTask.update).not.toHaveBeenCalled();
  });

  it('dispatches only the due Moments item with its own content and settings', async () => {
    const moments = task({
      taskType: 'WECHAT_MOMENTS_PUBLISH',
      batchTargets: [
        { id: 'moment-1', targetName: '朋友圈明细 1', status: 'queued' },
        { id: 'moment-2', targetName: '朋友圈明细 2', status: 'queued' },
      ],
      config: {
        type: 'wechat-moments-publish',
        planName: '朋友圈计划',
        planStatus: 'scheduled',
        planTime: '2026-07-10T11:59:00.000Z',
        sourceText: '发布朋友圈',
        riskLevel: 'high',
        safetyBoundary: {
          commercialExecutionAllowed: true,
          requestedCommercialExecution: true,
        },
        metadata: {
          skill_id: 'wechat.moments.publish',
          agent_s_instruction: '逐条发布朋友圈',
          wechat_moments_details: [
            {
              content: '第一条文案',
              attachments: ['/tmp/first.png'],
              additionalComment: '第一条评论',
              visibility: '公开',
              scheduledPublishTime: '2026-07-10T11:59:00.000Z',
              status: 'pending',
            },
            {
              content: '第二条文案',
              attachments: ['/tmp/second.png'],
              additionalComment: '第二条评论',
              visibility: '私密',
              scheduledPublishTime: '2026-07-10T13:00:00.000Z',
              status: 'pending',
            },
          ],
        },
      },
    });
    const { service, agentS } = setup({ queued: [moments] });

    await service.runOnce(now);

    expect(agentS.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenant_id: 'tenant-a',
          user_id: 'user-a',
          wechat_moments_content: '第一条文案',
          wechat_moments_asset_path: '/tmp/first.png',
          wechat_moments_additional_comment: '第一条评论',
          wechat_moments_visibility: '公开',
          wechat_moments_details: [
            expect.objectContaining({ content: '第一条文案' }),
          ],
        }),
      }),
    );
    expect(agentS.runTask).toHaveBeenCalledWith(
      'agent-session-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenant_id: 'tenant-a',
          user_id: 'user-a',
          wechat_moments_content: '第一条文案',
        }),
      }),
    );
  });

  it('settles a failed Moments item without cancelling later items', async () => {
    const running = task({
      taskType: 'WECHAT_MOMENTS_PUBLISH',
      status: 'RUNNING',
      stage: 'agent-s-scheduled-running',
      sessionId: 'agent-session-1',
      config: {
        type: 'wechat-moments-publish',
        planName: '朋友圈计划',
        planStatus: 'sending',
        scheduler: { momentsItemIndex: 0, momentsItemTarget: '朋友圈明细 1' },
        metadata: {
          skill_id: 'wechat.moments.publish',
          wechat_moments_details: [
            {
              content: '第一条文案',
              attachments: ['/tmp/first.png'],
              scheduledPublishTime: '2026-07-10T11:59:00.000Z',
              status: 'pending',
            },
            {
              content: '第二条文案',
              attachments: ['/tmp/second.png'],
              scheduledPublishTime: '2026-07-10T13:00:00.000Z',
              status: 'pending',
            },
          ],
        },
      },
    });
    const { service, interactionTask } = setup({
      running: [running],
      events: [
        {
          seq: 1,
          event_type: 'RunFailed',
          status: 'failed',
          message: '第一条可见范围不支持自动设置。',
          payload: {},
        },
      ],
    });

    await service.runOnce(now);

    expect(interactionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'wechat-plan-1',
          tenantId: 'tenant-a',
          userId: 'user-a',
        },
        data: expect.objectContaining({
          sessionId: null,
          status: 'QUEUED',
          config: expect.objectContaining({
            planStatus: 'scheduled',
            metadata: expect.objectContaining({
              wechat_moments_details: [
                expect.objectContaining({
                  content: '第一条文案',
                  status: 'failed',
                }),
                expect.objectContaining({
                  content: '第二条文案',
                  status: 'pending',
                }),
              ],
            }),
          }),
        }),
      }),
    );
  });
});
