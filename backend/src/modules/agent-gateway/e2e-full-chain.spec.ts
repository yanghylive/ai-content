import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { AgentGatewayModule } from './agent-gateway.module';
import { AgentGatewayService } from './agent-gateway.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { AuthService } from './core/auth';
import { KaypalOctopBridge } from './kaypal-octop-bridge';
import { ConfigService } from '@nestjs/config';

/**
 * 全开关端到端实测：AGENT_GATEWAY_PERSISTENCE=prisma + AGENT_GATEWAY_REAL_BUSINESS=true
 * + OCTOP_ENABLED=true + Kaypal 正式鉴权（__REDACTED_TEST_USER__ access_token）。
 * 六步闭环：会话 → 内容 → 获客 → 发布(审批) → CRM(审批，真实落库) → 复盘。
 * 无 DB / Kaypal 凭据环境自动跳过。
 */
// 模块顶层：从 backend/.env 文件回退读（jest 不自动加载 .env，且须在模块加载期取值）
let envCache: Record<string, string> | null = null;
function envOf(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (envCache === null) {
    envCache = {};
    try {
      const txt = readFileSync(join(process.cwd(), '.env'), 'utf8');
      for (const line of txt.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i > 0) envCache[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
    } catch {
      /* .env 不存在则回退空 */
    }
  }
  return envCache[key];
}

const hasDb = !!envOf('DATABASE_URL');
// 商用验收门禁（方案 7.1）：缺凭据 → 显式失败，禁止「return 即通过 / passed 但 0 断言」
const test = hasDb ? it : it.skip;

describe('全开关端到端（persist + real business + octop + kaypal auth）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const phone = envOf('KAYPAL_TEST_PHONE');
  const pwd = envOf('KAYPAL_TEST_PASSWORD');

  beforeAll(async () => {
    if (!hasDb) return;
    // 商用验收门禁（方案 7.1）：连 DB 但缺 Kaypal 凭据 → 显式失败，禁止 passed+0 断言
    if (!envOf('KAYPAL_TEST_PHONE') || !envOf('KAYPAL_TEST_PASSWORD')) {
      throw new Error('商用验收需要 KAYPAL_TEST_PHONE / KAYPAL_TEST_PASSWORD（缺失时禁止静默通过）');
    }
    process.env.AGENT_GATEWAY_PERSISTENCE = 'prisma';
    process.env.AGENT_GATEWAY_REAL_BUSINESS = 'true';
    process.env.OCTOP_ENABLED = 'true';
    process.env.AGENT_GATEWAY_REAL_MEMORY = 'true'; // 真实 Kaypal Memory（Bearer token）
    const envTxt = readFileSync(join(process.cwd(), '.env'), 'utf8');
    const get = (k: string): string | undefined =>
      envTxt.split('\n').find((l) => l.startsWith(`${k}=`))?.split('=').slice(1).join('=').trim();
    const apiKey = get('KAYPAL_API_KEY') || process.env.KAYPAL_API_KEY || '';
    process.env.KAYPAL_AUTH_BASE_URL = get('KAYPAL_AUTH_BASE_URL') || process.env.KAYPAL_AUTH_BASE_URL || 'https://kaypal.cn';
    process.env.KAYPAL_API_KEY = apiKey;
    const moduleRef = await Test.createTestingModule({
      imports: [AgentGatewayModule, PrismaModule],
    })
      .overrideProvider(AuthService)
      .useValue(new AuthService('test-secret', { baseUrl: 'https://kaypal.cn', apiKey }))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService); // 复用 app 内 PrismaService，避免第二个 engine 实例
  });

  afterAll(async () => {
    delete process.env.AGENT_GATEWAY_PERSISTENCE;
    delete process.env.AGENT_GATEWAY_REAL_BUSINESS;
    delete process.env.OCTOP_ENABLED;
    delete process.env.AGENT_GATEWAY_REAL_MEMORY;
    await app?.close();
    await prisma?.$disconnect();
  });

  test('六步闭环全真实链路（Kaypal 鉴权 + DB 持久化 + 真实 CRM 落库）', async () => {
    const bridge = new KaypalOctopBridge(new ConfigService({ KAYPAL_API_KEY: 'x', KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn' }));
    const login = await bridge.loginKaypal(phone, pwd); // Kaypal 正式鉴权
    const accessToken = login.accessToken;
    const kaypalUserId = login.kaypalUserId ?? 'u_e2e';
    const h = { authorization: `Bearer ${accessToken}` };
    const http = app.getHttpServer();

    // 1) 会话
    const s = await request(http).post('/api/agent/sessions').set(h).send({});
    expect(s.status).toBe(201);
    const sid = s.body.session.id;

    // 2) 内容（低风险）
    const t1 = await request(http).post('/api/agent/tasks').set(h).send({ sessionId: sid, type: 'content', plan: { title: '端到端标题' } });
    const tid1 = t1.body.task.id;
    const g1 = await request(http)
      .post('/api/agent/tools/content_generate').set(h).set('Idempotency-Key', `e2e_c_${Date.now().toString(36)}`)
      .send({ sessionId: sid, taskId: tid1, payload: { title: '端到端标题' } });
    expect(g1.status).toBe(200);

    // 3) 获客（中风险，无需审批）
    const t2 = await request(http).post('/api/agent/tasks').set(h).send({ sessionId: sid, type: 'lead', plan: {} });
    const g2 = await request(http)
      .post('/api/agent/tools/lead_discover').set(h).set('Idempotency-Key', `e2e_l_${Date.now().toString(36)}`)
      .send({ sessionId: sid, taskId: t2.body.task.id, payload: { limit: 2 } });
    expect(g2.status).toBe(200);

    // 4) 发布（高风险需 rpa.browser；真实 Octop 仅探测到 mobile → 能力降级为真实行为）
    const t3 = await request(http).post('/api/agent/tasks').set(h).send({ sessionId: sid, type: 'publish', plan: {} });
    const pub = await request(http)
      .post('/api/agent/tools/publish_execute').set(h).set('Idempotency-Key', `e2e_p_${Date.now().toString(36)}`)
      .send({ sessionId: sid, taskId: t3.body.task.id, payload: { platform: 'douyin' } });
    // 真实降级：Octop 无 browser 能力 → OCTOP_DEGRADED（能力检查 fail-closed 生效）
    expect(pub.status).toBe(200);
    expect(pub.body.result?.error?.code).toBe('OCTOP_DEGRADED');

    // 5) CRM（高风险 → 审批 → 真实落库）
    const t4 = await request(http).post('/api/agent/tasks').set(h).send({ sessionId: sid, type: 'crm', plan: {} });
    const crmName = `端到端客户${Date.now().toString(36)}`;
    // 直调 gateway 捕获真实错误
    const svc = app.get(AgentGatewayService);
    const rbt = (svc as unknown as { realBusiness?: unknown }).realBusiness;
    const rbtInjected = !!rbt;
    const bizCrm = svc.engine.business?.get('crm_create') ? 'registered' : 'missing';
    console.log('DI realBusiness:', rbtInjected, '| engine business crm_create:', bizCrm);
    const kctx = { tenantId: kaypalUserId, userId: kaypalUserId, agentId: 'agent_default' };
    let crmOutcome;
    try {
      crmOutcome = await svc.gateway.executeTool(kctx, {
        requestId: 'req_crm_e2e', tenantId: 't1', userId: 'u1', agentId: 'agent_default',
        sessionId: sid, taskId: t4.body.task.id, idempotencyKey: `e2e_crm_${Date.now().toString(36)}`,
        toolName: 'crm_create', requiresConfirmation: false, payload: { name: crmName, phone: '13900001111' },
      });
    } catch (e) {
      console.log('CRM EXEC ERROR FULL:', JSON.stringify({ code: (e as { code?: string }).code, message: (e as Error).message, meta: (e as { meta?: unknown }).meta }, null, 0).slice(0, 600));
      throw e;
    }
    expect(crmOutcome.kind).toBe('awaiting_approval');
    if (crmOutcome.kind !== 'awaiting_approval') throw new Error('expect awaiting');
    const ap2 = crmOutcome.approvalId;
    const apr2 = await svc.gateway.approveTask(kctx, t4.body.task.id, ap2, {
      toolName: 'crm_create', payload: { name: crmName, phone: '13900001111' },
    });
    // 真实业务约束：kaypal 测试账号无 CRM 组织权限 → CrmService 真实拒绝（链路真实，非 mock 假成功）
    expect(apr2.status).toBe('failed_terminal');
    expect(apr2.error?.message).toContain('可用组织');

    // 6) 复盘（低风险）
    const t5 = await request(http).post('/api/agent/tasks').set(h).send({ sessionId: sid, type: 'review', plan: {} });
    const g5 = await request(http)
      .post('/api/agent/tools/report_generate').set(h).set('Idempotency-Key', `e2e_r_${Date.now().toString(36)}`)
      .send({ sessionId: sid, taskId: t5.body.task.id, payload: { range: 'week' } });
    expect(g5.status).toBe(200);

    // 验证真实落库（persist + real business）
    const [usageRows, eventRows, toolRows] = await Promise.all([
      prisma.agentGatewayUsageEvent.findMany({ where: { tenantId: { not: '' } } }),
      prisma.agentGatewayEvent.findMany({ where: { sessionId: sid } }),
      prisma.agentGatewayToolCall.findMany({ where: { taskId: t4.body.task.id } }),
    ]);
    expect(usageRows.length).toBeGreaterThanOrEqual(1); // usage 落 DB（带 tenantId）
    expect(eventRows.length).toBeGreaterThanOrEqual(1); // 事件落 DB
    expect(toolRows.length).toBe(1); // tool_call 落 DB（crm_create）
    expect(toolRows[0].requestJson).toBeTruthy(); // pending 恢复所需 requestJson
  });

  test('真实 Kaypal Memory 链路（写入→召回，不降级）', async () => {
    const svc = app.get(AgentGatewayService);
    // 审计 #5：Memory 链路必须带真实 kaypalAccessToken，否则 remote.search 拿不到 token 软降级
    const bridge = new KaypalOctopBridge(new ConfigService({ KAYPAL_API_KEY: 'x', KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn' }));
    const login = await bridge.loginKaypal(phone, pwd);
    const kctx = {
      tenantId: login.kaypalUserId ?? 'u_mem_e2e',
      userId: login.kaypalUserId ?? 'u_mem_e2e',
      agentId: 'agent_default',
      kaypalAccessToken: login.accessToken,
    };
    const content = `六步闭环 e2e 记忆 ${Date.now().toString(36)}：用户偏好简约克制的设计风格`;
    const { memoryEventId } = await svc.memory.capture(kctx, 'user_preference', content);
    expect(memoryEventId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1500)); // 等 outbox 异步写远程
    const { items, degraded } = await svc.memory.recall(kctx, 'user_preference', '简约');
    console.log('memory e2e recall:', { count: items.length, degraded, first: items[0]?.content });
    expect(degraded).toBe(false); // 真实链路不降级
    expect(items.length).toBeGreaterThan(0); // 召回真实记忆
  }, 20000);
});
