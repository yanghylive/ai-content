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
    prisma.growthTaskDraft.findFirst.mockResolvedValue(draftRow({ draftHash: null }));
    growth.createConfig.mockResolvedValue({ id: 'cfg-1' });
    prisma.growthTaskDraft.update.mockResolvedValue(
      draftRow({ status: 'confirmed', actorUserId: 'u-1', riskSummary: '意图 find_leads：1 项中风险动作需确认后执行', configId: 'cfg-1' }),
    );
    const draft = await svc.confirmDraft('u-1', 'd1', {});
    expect(draft.status).toBe('confirmed');
    expect(draft.configId).toBe('cfg-1');
    expect(growth.createConfig).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ mode: 'draft-only', riskMode: 'confirm-first', status: 'disabled' }),
    );
    expect(prisma.growthTaskDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorUserId: 'u-1', riskSummary: expect.any(String), confirmedAt: expect.any(Date) }),
      }),
    );
  });

  it('executeDraft：report 意图直接标记执行（不建配置）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ intent: 'report', configId: null, status: 'confirmed' }),
    );
    prisma.growthTaskDraft.update.mockResolvedValue(draftRow({ intent: 'report', status: 'executed' }));
    const draft = await svc.executeDraft('u-1', 'd1');
    expect(draft.status).toBe('executed');
    expect(growth.executeConfig).not.toHaveBeenCalled();
  });

  it('executeDraft：find_leads 走配置 execute（补偿创建+执行）', async () => {
    const { svc, prisma, growth } = makeService({});
    prisma.growthTaskDraft.findFirst.mockResolvedValue(
      draftRow({ intent: 'find_leads', configId: null, status: 'confirmed' }),
    );
    growth.createConfig.mockResolvedValue({ id: 'cfg-2' });
    growth.executeConfig.mockResolvedValue({ ok: true });
    prisma.growthTaskDraft.update.mockResolvedValue(draftRow({ status: 'executed' }));
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
