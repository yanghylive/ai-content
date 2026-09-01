import { Test } from '@nestjs/testing';
import { AgentGatewayModule } from '../agent-gateway.module';
import { AgentGatewayService } from '../agent-gateway.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../core/auth';
import { TenantContext, ToolRequest } from '../core/types';

/**
 * 真实内容工具（《商用缺口修复方案》2.2）：
 * - content_generate 真实落库（真实 contentId，不伪造）
 * - content_review 真实审核（不达标抛 CONTENT_REVIEW_FAILED）
 * - lead_normalize 真实清洗（手机号/微信号/置信度）
 * - publish/interaction 阻断假成功（TOOL_EXECUTION_FAILED，不再 Mock 成功）
 * 需要 DB（AGENT_GATEWAY_REAL_BUSINESS=true）。
 */
const hasDb = process.env.DATABASE_URL?.startsWith('postgres');
const test = hasDb ? it : it.skip;

describe('RealContentTools（真实内容工具 + 阻断假成功）', () => {
  let svc: AgentGatewayService;
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule>>;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!hasDb) return;
    process.env.AGENT_GATEWAY_REAL_BUSINESS = 'true';
    moduleRef = await Test.createTestingModule({
      imports: [AgentGatewayModule, PrismaModule],
    })
      .overrideProvider(AuthService)
      .useValue(new AuthService('test-secret'))
      .compile();
    svc = moduleRef.get(AgentGatewayService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    delete process.env.AGENT_GATEWAY_REAL_BUSINESS;
    await moduleRef?.close();
  });

  function req(sessionId: string, taskId: string, toolName: string, payload: Record<string, unknown>): ToolRequest {
    return {
      requestId: `req_${toolName}_${Date.now().toString(36)}`,
      tenantId: 't1',
      userId: 'u1',
      agentId: 'a1',
      sessionId,
      taskId,
      idempotencyKey: `k_${toolName}_${Date.now().toString(36)}`,
      toolName,
      requiresConfirmation: false,
      payload,
    };
  }

  test('content_generate 真实落库：返回真实 contentId + article 表有行', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'content', {});
    const content = `真实内容落库验证 ${Date.now().toString(36)}：这里是正文内容`;
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, 'content_generate', { title: '真实标题', content }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.status).toBe('succeeded');
      const cid = out.result.data?.contentId as string;
      expect(cid).toBeTruthy();
      // 真实落库验证：article 表存在该行
      const row = await prisma.article.findUnique({ where: { id: cid } });
      expect(row).toBeTruthy();
      expect(row?.content).toBe(content);
      expect(out.result.data?.version).toBe(1);
      expect(out.result.data?.checksum).toBeTruthy(); // 真实内容算出的 checksum
    }
    // 清理
    const cid2 = (out.kind === 'result' ? out.result.data?.contentId : null) as string | null;
    if (cid2) await prisma.article.delete({ where: { id: cid2 } }).catch(() => undefined);
  });

  test('content_generate 空内容 → 抛错（禁止伪造）', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'content', {});
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, 'content_generate', { title: 'x', content: '' }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.error?.code).toBe('INVALID_PLAN');
      expect(out.result.status).toBe('failed_terminal'); // retryable=false → terminal
    }
  });

  test('content_review 真实审核：执行并返回审核结构（不伪造）', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'review', {});
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, 'content_review', {
      title: '装修避坑指南',
      content: '装修前一定要先量房，确认水电位置，再定预算。以下是三个关键步骤……（正文内容足够长以通过结构检查）',
      generatedImageCount: 1,
      aiFlavorScore: 5,
    }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      // 审核是真实执行的：要么通过（succeeded 带结构），要么不达标（failed_retryable + CONTENT_REVIEW_FAILED）
      expect(['succeeded', 'failed_retryable']).toContain(out.result.status);
      if (out.result.status === 'succeeded') {
        expect(out.result.data?.threshold).toBe(70);
        expect(out.result.data?.score).toBeGreaterThanOrEqual(0);
      } else {
        expect(out.result.error?.code).toBe('CONTENT_REVIEW_FAILED');
      }
    }
  });

  test('lead_normalize 真实清洗：手机号/微信号规范化 + 置信度', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    const task = svc.gateway.createTask(ctx, session.id, 'lead', {});
    const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, 'lead_normalize', {
      leads: [
        { phone: '138 0013 8000', nickname: '张三', sourceUrl: 'https://xhs.example/p/1' },
        { phone: '12345', wechat: 'wx_abc', externalUserId: 'u_123' }, // 手机号非法→空，微信号合法
        { phone: '', wechat: '', externalUserId: '', nickname: '' }, // 全空→低置信
      ],
    }));
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.result.status).toBe('succeeded');
      const normalized = out.result.data?.normalized as Array<Record<string, unknown>>;
      expect(normalized).toHaveLength(3);
      expect(normalized[0].phone).toBe('13800138000'); // 规范化
      expect(normalized[0].confidence).toBeGreaterThan(50); // phone+昵称+URL
      expect(normalized[1].phone).toBe(''); // 非法手机号清空
      expect(normalized[1].wechat).toBe('wx_abc'); // 微信保留
      expect(normalized[1].confidence).toBeGreaterThanOrEqual(60); // wechat 25 + externalUserId 35
      expect(normalized[2].confidence).toBe(0); // 全空
      expect(normalized[0].dedupeKey).toBe('strong:13800138000'); // 手机号最强标识
    }
  });

  test('阻断假成功：publish_execute / interaction_reply_execute 不再 Mock 成功', async () => {
    const ctx: TenantContext = { tenantId: 't1', userId: 'u1', agentId: 'a1' };
    const session = await svc.gateway.createSession(ctx);
    for (const tool of ['publish_execute', 'interaction_reply_execute']) {
      const task = svc.gateway.createTask(ctx, session.id, tool === 'publish_execute' ? 'publish' : 'interaction', {});
      const out = await svc.gateway.executeTool(ctx, req(session.id, task.id, tool, { platform: 'douyin' }));
      // publish_execute 是高风险 → 先走审批；审批通过后执行才报"禁止假成功"
      if (out.kind === 'awaiting_approval') {
        const approved = await svc.gateway.approveTask(ctx, task.id, out.approvalId, {
          toolName: tool,
          payload: { platform: 'douyin' },
        });
        expect(approved.error?.code).toBe('TOOL_EXECUTION_FAILED');
        // 拒绝假成功的根因在 details.reason（message 是通用文案）
        expect(JSON.stringify(approved.error?.details ?? {})).toContain('禁止假成功');
      } else {
        expect(out.kind).toBe('result');
        if (out.kind === 'result') {
          expect(out.result.error?.code).toBe('TOOL_EXECUTION_FAILED');
          expect(out.result.error?.message).toContain('禁止假成功');
        }
      }
    }
  });
});
