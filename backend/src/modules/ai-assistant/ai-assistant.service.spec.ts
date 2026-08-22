import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthService } from '../growth/growth.service';

function makeService(overrides: {
  prisma?: Partial<Record<string, jest.Mock>>;
  growth?: Partial<Record<string, jest.Mock>>;
}) {
  const prisma = {
    growthTaskDraft: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...(overrides.prisma || {}),
  };
  const growth = {
    createConfig: jest.fn(),
    executeConfig: jest.fn(),
    ...(overrides.growth || {}),
  };
  const svc = new AiAssistantService(prisma as never, growth as never, {
    resolveTenantId: jest.fn().mockResolvedValue('t-test'),
  } as never);
  return { svc, prisma, growth };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    intent: 'find_leads',
    goal: '帮我找最近一周对装修有需求的抖音用户',
    platform: 'douyin',
    accountId: null,
    configJson: { platform: 'douyin', includeKeywords: ['装修'] },
    plannedActions: [
      { type: 'discover_candidates', label: '发现抖音目标用户', risk: 'medium', requiresConfirmation: true },
    ],
    missingFields: [],
    readiness: 'needs-confirmation',
    blockers: [],
    draftHash: 'abc123',
    riskSummary: null,
    configId: null,
    status: 'draft',
    expiresAt: new Date(Date.now() + 60_000),
    confirmedAt: null,
    executedAt: null,
    ...overrides,
  };
}

describe('AiAssistantService（P3 任务草稿）', () => {
  it('parseIntent：中文关键词映射意图', () => {
    const { svc } = makeService({});
    expect(svc.parseIntent('帮我找最近有装修需求的抖音用户')).toBe('find_leads');
    expect(svc.parseIntent('帮我联系这些线索')).toBe('contact_leads');
    expect(svc.parseIntent('同步到 CRM 转客户')).toBe('sync_crm');
    expect(svc.parseIntent('出一份本周复盘报告')).toBe('report');
    expect(svc.parseIntent('跟进一下老客户')).toBe('follow_up');
  });

  it('parsePlatform：中文/英文别名映射平台', () => {
    const { svc } = makeService({});
    expect(svc.parsePlatform('抖音')).toBe('douyin');
    expect(svc.parsePlatform('小红书')).toBe('xiaohongshu');
    expect(svc.parsePlatform('快手用户')).toBe('kuaishou');
    expect(svc.parsePlatform('视频号')).toBe('wechat-channel');
    expect(svc.parsePlatform('douyin')).toBe('douyin');
    expect(svc.parsePlatform('没有平台')).toBeUndefined();
  });

  it('createDraft：NL 生成结构化草稿，缺失平台时 readiness=needs-input', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.create.mockResolvedValue(
      draftRow({ id: 'd1', platform: null, readiness: 'needs-input', missingFields: ['platform'] }),
    );
    const draft = await svc.createDraft('u-1', {
      naturalLanguage: '帮我找装修客户',
    });
    expect(draft.readiness).toBe('needs-input');
    expect(draft.missingFields).toContain('platform');
    expect(draft.draftHash).toEqual(expect.any(String)); // §7.3 草稿指纹暴露
    expect(prisma.growthTaskDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u-1',
          intent: 'find_leads',
          status: 'draft',
          draftHash: expect.any(String),
        }),
      }),
    );
  });

  it('createDraft：含平台+关键词时 readiness=needs-confirmation（发现动作中风险）', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.create.mockResolvedValue(
      draftRow({ id: 'd2', readiness: 'needs-confirmation' }),
    );
    const draft = await svc.createDraft('u-1', {
      naturalLanguage: '帮我找最近一周对「装修」有需求的抖音用户',
    });
    expect(draft.platform).toBe('douyin');
    expect(draft.readiness).toBe('needs-confirmation');
    expect(draft.plannedActions[0].risk).toBe('medium');
    expect(draft.plannedActions[0].requiresConfirmation).toBe(true);
  });

  it('confirmDraft：校验过期（ConflictException）', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    prisma.growthTaskDraft.update.mockResolvedValue(draftRow({}));
    await expect(
      svc.confirmDraft('u-1', 'draft-expired', {}),
    ).rejects.toThrow(ConflictException);
    expect(prisma.growthTaskDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
    );
  });

  it('confirmDraft：哈希不匹配拒绝（防篡改）', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ draftHash: 'original-hash', configJson: { platform: 'douyin', includeKeywords: ['篡改'] } }),
    );
    await expect(svc.confirmDraft('u-1', 'd1', {})).rejects.toThrow(ConflictException);
  });

  it('confirmDraft：成功保存操作者+风险摘要+创建配置（draft 态）', async () => {
    const { svc, prisma, growth } = makeService({});
    // 不设 draftHash（null 时跳过哈希校验），专注确认+配置创建断言
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(draftRow({ draftHash: null }))
      .mockResolvedValue(
        draftRow({ status: 'confirmed', actorUserId: 'u-1', riskSummary: '意图 find_leads：1 项中风险动作需确认后执行', configId: 'cfg-1' }),
      );
    growth.createConfig.mockResolvedValue({ id: 'cfg-1' });
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    const draft = await svc.confirmDraft('u-1', 'd1', {});
    expect(draft.status).toBe('confirmed');
    expect(draft.configId).toBe('cfg-1');
    expect(growth.createConfig).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ mode: 'draft-only', riskMode: 'confirm-first', status: 'disabled' }),
    );
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'draft' },
        data: expect.objectContaining({ actorUserId: 'u-1', riskSummary: expect.any(String), confirmedAt: expect.any(Date) }),
      }),
    );
  });

  it('executeDraft：report 意图直接标记执行（不建配置）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'report', configId: null, status: 'confirmed' }),
      )
      .mockResolvedValue(draftRow({ intent: 'report', status: 'executed' }));
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    const draft = await svc.executeDraft('u-1', 'd1');
    expect(draft.status).toBe('executed');
    expect(growth.executeConfig).not.toHaveBeenCalled();
  });

  it('executeDraft：find_leads 走配置 execute（补偿创建+执行）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'find_leads', configId: null, status: 'confirmed' }),
      )
      .mockResolvedValue(draftRow({ status: 'executed' }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-2' });
    growth.executeConfig.mockResolvedValue({ ok: true });
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    await svc.executeDraft('u-1', 'd1');
    expect(growth.executeConfig).toHaveBeenCalledWith('u-1', 'cfg-2', {
      confirmedExecution: true,
    });
  });

  it('getDraft：不存在抛 NotFound', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(null);
    await expect(svc.getDraft('u-1', 'nope')).rejects.toThrow(NotFoundException);
  });
});

describe('AiAssistantService P3 租户隔离', () => {
  it('resolveTenantId：tenantMember 有归属返回真实租户', async () => {
    const { AiAssistantService } = require('./ai-assistant.service');
    const svc = Object.create(AiAssistantService.prototype) as any;
    svc.prisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ tenantId: 't-real-123' }),
      },
    };
    const result = await svc.resolveTenantId('u-1');
    expect(result).toBe('t-real-123');
  });

  it('resolveTenantId：无 delegate 抛 Forbidden（fail-closed）', async () => {
    const { AiAssistantService } = require('./ai-assistant.service');
    const svc = Object.create(AiAssistantService.prototype) as any;
    svc.prisma = {};
    await expect(svc.resolveTenantId('u-1')).rejects.toThrow(
      '缺少租户上下文',
    );
  });

  it('resolveTenantId：DB 异常抛 Forbidden（fail-closed 不回落）', async () => {
    const { AiAssistantService } = require('./ai-assistant.service');
    const svc = Object.create(AiAssistantService.prototype) as any;
    svc.prisma = {
      tenantMember: {
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    await expect(svc.resolveTenantId('u-1')).rejects.toThrow('租户解析失败');
  });

  it('listDrafts：查询带 tenantId 条件（防跨租户读）', async () => {
    const { AiAssistantService } = require('./ai-assistant.service');
    const svc = Object.create(AiAssistantService.prototype) as any;
    const findMany = jest.fn().mockResolvedValue([]);
    svc.prisma = {
      growthTaskDraft: { findMany },
    };
    svc.toDto = (r: unknown) => r;
    svc.resolveTenantId = jest.fn().mockResolvedValue('t-real-1');
    await svc.listDrafts('u-1', 'draft');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u-1',
          tenantId: 't-real-1',
        }),
      }),
    );
  });

  it('resolveTenantId：DB 异常抛 Forbidden（fail-closed 不回落）', async () => {
    const { AiAssistantService } = require('./ai-assistant.service');
    const svc = Object.create(AiAssistantService.prototype) as any;
    svc.prisma = {
      tenantMember: {
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    await expect(svc.resolveTenantId('u-1')).rejects.toThrow('租户解析失败');
  });
});

describe('AiAssistantService P3 意图闭环（审计 2026-08-22）', () => {
  function draftRow(over: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      userId: 'u-1',
      tenantId: 't-test',
      status: 'confirmed',
      intent: 'report',
      goal: '测试',
      configId: null,
      configJson: {},
      platform: null,
      expiresAt: new Date(Date.now() + 3600_000),
      ...over,
    };
  }

  function makeService(overrides: {
    prisma?: Partial<Record<string, jest.Mock>>;
    growth?: Partial<Record<string, jest.Mock>>;
    leadConvert?: { convert: jest.Mock };
  }) {
    const prisma = {
      growthTaskDraft: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lead: { findMany: jest.fn() },
      crmTask: {
        create: jest.fn(),
        // P1（复查 2026-08-22）：follow_up 幂等查重——默认无既有任务
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...(overrides.prisma || {}),
    };
    const growth = {
      createConfig: jest.fn(),
      executeConfig: jest.fn(),
      // P1（复查第二轮）：confirmDraft 孤儿配置清理路径
      deleteConfig: jest.fn().mockResolvedValue({ ok: true }),
      ...(overrides.growth || {}),
    };
    const leadConvert = overrides.leadConvert ?? { convert: jest.fn() };
    const svc = new (require('./ai-assistant.service').AiAssistantService)(
      prisma as never,
      growth as never,
      { resolveTenantId: jest.fn().mockResolvedValue('t-test') } as never,
      leadConvert as never,
    );
    return { svc, prisma, growth, leadConvert };
  }

  it('sync_crm：未转线索批量转 CRM 客户', async () => {
    const { svc, prisma, leadConvert } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(draftRow({ intent: 'sync_crm', configId: null }))
      .mockResolvedValue(draftRow({ intent: 'sync_crm', status: 'executed' }));
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-1' },
      { id: 'lead-2' },
    ]);
    leadConvert.convert.mockResolvedValue({ ok: true });
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    await svc.executeDraft('u-1', 'd1');
    expect(leadConvert.convert).toHaveBeenCalledTimes(2);
    expect(leadConvert.convert).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        scope: { userId: 'u-1', tenantId: 't-test' },
      }),
    );
  });

  it('follow_up：创建 CRM 跟进任务（带 draftId 幂等键）', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'follow_up', configId: null, goal: '回访老客户' }),
      )
      .mockResolvedValue(draftRow({ intent: 'follow_up', status: 'executed' }));
    prisma.crmTask.create.mockResolvedValue({ id: 'task-1' });
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    const draft = await svc.executeDraft('u-1', 'd1');
    expect(draft.status).toBe('executed');
    expect(prisma.crmTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { metadata: { path: ['draftId'], equals: 'd1' } },
      }),
    );
    expect(prisma.crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'u-1',
          title: '回访老客户',
          metadata: { source: 'ai-assistant-draft', draftId: 'd1' },
        }),
      }),
    );
  });

  it('P1 follow_up 幂等：同 draftId 已建任务时不重复创建', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'follow_up', configId: null, goal: '回访老客户' }),
      )
      .mockResolvedValue(draftRow({ intent: 'follow_up', status: 'executed' }));
    // 幂等键命中：已存在任务
    prisma.crmTask.findFirst.mockResolvedValue({ id: 'task-existing' });
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    await svc.executeDraft('u-1', 'd1');
    expect(prisma.crmTask.create).not.toHaveBeenCalled();
  });

  it('P1 confirmDraft 并发：抢占失败方不创建配置（无孤儿配置）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ draftHash: null, intent: 'find_leads' }),
    );
    // 抢占失败（已被并发方确认）
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.confirmDraft('u-1', 'd1', {})).rejects.toThrow(
      ConflictException,
    );
    // 抢占失败 → 配置未创建（无孤儿）
    expect(growth.createConfig).not.toHaveBeenCalled();
  });

  it('P1 confirmDraft 配置创建失败：回滚 confirmed→draft，不留孤儿', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(draftRow({ draftHash: null, intent: 'find_leads' }))
      .mockResolvedValue(draftRow({ status: 'draft' }));
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    growth.createConfig.mockRejectedValue(new Error('配置创建失败'));
    await expect(svc.confirmDraft('u-1', 'd1', {})).rejects.toThrow(
      ConflictException,
    );
    // 回滚到 draft：updateMany 第二次调用 where status='confirmed' → data status='draft'
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'confirmed' },
        data: expect.objectContaining({ status: 'draft' }),
      }),
    );
  });

  it('P1 executeDraft 副作用已提交：不回滚 confirmed（防重试重复副作用）', async () => {
    const { svc, prisma } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'report', configId: null, status: 'confirmed' }),
      )
      .mockResolvedValue(draftRow({ intent: 'report', status: 'executing' }));
    // claim（confirmed→executing）成功；最终状态更新（executing→executed）失败
    prisma.growthTaskDraft.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(svc.executeDraft('u-1', 'd1')).rejects.toThrow(
      '副作用已执行',
    );
    // 不回滚 confirmed；置 error 终态
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'executing' },
        data: expect.objectContaining({ status: 'error' }),
      }),
    );
  });

  it('P1（复查第二轮）executing 陈旧回收：崩溃残留置 error（不静默重试）', async () => {
    const { svc, prisma } = makeService({});
    // executing 且 updatedAt 在 20 分钟前（超过 EXECUTING_STALE_MS=10min）
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({
        status: 'executing',
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      }),
    );
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    await expect(svc.executeDraft('u-1', 'd1')).rejects.toThrow(
      '执行中断的残留任务',
    );
    // 回收：executing → error（交人工核对）
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'executing' },
        data: expect.objectContaining({ status: 'error' }),
      }),
    );
  });

  it('P1（复查第二轮）executing 未超时：直接冲突拒绝（不回收）', async () => {
    const { svc, prisma } = makeService({});
    // executing 且 updatedAt 刚刚（未超时——正在执行）
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({
        status: 'executing',
        updatedAt: new Date(Date.now() - 30 * 1000),
      }),
    );
    await expect(svc.executeDraft('u-1', 'd1')).rejects.toThrow(
      '任务正在执行或已完成',
    );
    // 不做回收更新
    expect(prisma.growthTaskDraft.updateMany).not.toHaveBeenCalled();
  });

  it('P1（复查第二轮）confirmDraft configId 回写失败：删除孤儿配置并回滚草稿', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ draftHash: null, intent: 'find_leads' }),
      )
      .mockResolvedValue(draftRow({ status: 'draft' }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-orphan' });
    // 抢占成功；configId 回写失败（count=0）
    prisma.growthTaskDraft.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(svc.confirmDraft('u-1', 'd1', {})).rejects.toThrow(
      '配置关联草稿失败',
    );
    // 孤儿配置被清理
    expect(growth.deleteConfig).toHaveBeenCalledWith('u-1', 'cfg-orphan');
    // 草稿回滚 draft 允许重试
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'confirmed' },
        data: expect.objectContaining({ status: 'draft' }),
      }),
    );
  });

  it('P1（复查第三轮）configId 回写 throw：同样删除孤儿配置并回滚', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ draftHash: null, intent: 'find_leads' }),
      )
      .mockResolvedValue(draftRow({ status: 'draft' }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-throw' });
    // 抢占成功；configId 回写直接 throw（DB 异常——复查第三轮指出的漏网路径）
    prisma.growthTaskDraft.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db write failed'));
    await expect(svc.confirmDraft('u-1', 'd1', {})).rejects.toThrow(
      '配置关联草稿失败',
    );
    // 孤儿配置被清理（不只是 count!==1 才删）
    expect(growth.deleteConfig).toHaveBeenCalledWith('u-1', 'cfg-throw');
  });

  it('P1（复查第三轮）补偿创建立即关联：重试复用同一配置（不重复创建）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'find_leads', configId: null, status: 'confirmed' }),
      )
      .mockResolvedValue(draftRow({ status: 'executed' }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-comp' });
    growth.executeConfig.mockResolvedValue({ ok: true });
    // claim → 关联 configId → 终态
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    await svc.executeDraft('u-1', 'd1');
    // 配置创建后先关联草稿（重试时 configId 非空走复用分支，不再重建）
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'executing' },
        data: expect.objectContaining({ configId: 'cfg-comp' }),
      }),
    );
    expect(growth.executeConfig).toHaveBeenCalledWith('u-1', 'cfg-comp', {
      confirmedExecution: true,
    });
  });

  it('P1（复查第三轮）补偿创建关联失败：删除配置 + 冲突（不产生孤儿/重复配置）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ intent: 'find_leads', configId: null, status: 'confirmed' }),
    );
    growth.createConfig.mockResolvedValue({ id: 'cfg-unlinked' });
    // claim 成功；关联 configId 失败（count=0）
    prisma.growthTaskDraft.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(svc.executeDraft('u-1', 'd1')).rejects.toThrow(
      '补偿配置关联草稿失败',
    );
    // 未关联的配置被删除（下次重试补偿创建不会叠加）
    expect(growth.deleteConfig).toHaveBeenCalledWith('u-1', 'cfg-unlinked');
    // 未执行
    expect(growth.executeConfig).not.toHaveBeenCalled();
  });

  it('P1（复查第三轮）补偿配置已关联但执行失败：置 error 不回滚（防重复触达）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst
      .mockResolvedValueOnce(
        draftRow({ intent: 'find_leads', configId: null, status: 'confirmed' }),
      )
      .mockResolvedValue(draftRow({ status: 'error' }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-exec-fail' });
    // claim 成功；关联成功；执行失败 → 外层置 error
    prisma.growthTaskDraft.updateMany.mockResolvedValue({ count: 1 });
    growth.executeConfig.mockRejectedValue(new Error('触达中途失败'));
    await expect(svc.executeDraft('u-1', 'd1')).rejects.toThrow(
      '副作用可能已部分产生',
    );
    // 不回滚 confirmed；置 error 交人工核对（副作用可能已发生）
    expect(prisma.growthTaskDraft.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'd1', status: 'executing' },
        data: expect.objectContaining({ status: 'error' }),
      }),
    );
  });
});
