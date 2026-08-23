import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AgentGatewayModule } from './agent-gateway.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { AuthService } from './core/auth';

describe('AgentGatewayController（Nest 接线，首批冻结接口）', () => {
  let app: INestApplication;
  let auth: AuthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AgentGatewayModule, PrismaModule],
    })
      .overrideProvider(AuthService)
      .useValue(new AuthService('test-secret'))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // 与 main.ts 一致 → /api/agent/*
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    auth = moduleRef.get(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  const tA = () => auth.issue({ tenantId: 't1', userId: 'u1', agentId: 'a1' });
  const authA = () => ({ authorization: `Bearer ${tA()}` });

  it('缺 token → 401（全局错误格式 + code=UNAUTHORIZED）', async () => {
    const res = await request(app.getHttpServer()).post('/api/agent/sessions').send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.success).toBe(false);
  });

  it('签名 token 建会话 → 任务 → lead_discover 闭环 succeeded', async () => {
    const s = await request(app.getHttpServer()).post('/api/agent/sessions').set(authA()).send({});
    expect(s.status).toBe(201);
    const sid = s.body.session.id;

    const t = await request(app.getHttpServer()).post('/api/agent/tasks').set(authA()).send({ sessionId: sid, type: 'lead', plan: {} });
    expect(t.status).toBe(202);
    const tid = t.body.task.id;

    const run = await request(app.getHttpServer())
      .post('/api/agent/tools/lead_discover')
      .set(authA())
      .set('Idempotency-Key', 'idem_nest1')
      .send({ sessionId: sid, taskId: tid, payload: { limit: 3 } });
    expect(run.status).toBe(200);
    expect(run.body.result.status).toBe('succeeded');
    expect(run.body.result.data?.count).toBe(3);
  });

  it('跨租户 resume → 403 FORBIDDEN', async () => {
    const s = await request(app.getHttpServer()).post('/api/agent/sessions').set(authA()).send({});
    const sid = s.body.session.id;
    const tB = auth.issue({ tenantId: 't2', userId: 'u2', agentId: 'a2' });
    const r = await request(app.getHttpServer())
      .post(`/api/agent/sessions/${sid}/resume`)
      .set({ authorization: `Bearer ${tB}` })
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN');
  });

  it('高风险发布缺 Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const s = await request(app.getHttpServer()).post('/api/agent/sessions').set(authA()).send({});
    const sid = s.body.session.id;
    const t = await request(app.getHttpServer()).post('/api/agent/tasks').set(authA()).send({ sessionId: sid, type: 'publish', plan: {} });
    const tid = t.body.task.id;

    const r = await request(app.getHttpServer())
      .post('/api/agent/tools/publish_execute')
      .set(authA())
      .send({ sessionId: sid, taskId: tid, payload: { platform: 'douyin' } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('capabilities 需鉴权：无 token → 401，带 token → 200', async () => {
    const no = await request(app.getHttpServer()).get('/api/agent/octop/capabilities');
    expect(no.status).toBe(401);
    const ok = await request(app.getHttpServer()).get('/api/agent/octop/capabilities').set(authA());
    expect(ok.status).toBe(200);
    expect(ok.body.capabilities.browser.available).toBe(true);
  });

  it('DTO 运行时校验：createTask 缺 sessionId → 400（P1-7）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/agent/tasks')
      .set(authA())
      .send({ type: 'lead' }); // 缺 sessionId
    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  it('记忆 add/search 闭环', async () => {
    await request(app.getHttpServer())
      .post('/api/memory/add')
      .set(authA())
      .send({ scope: 'user_preference', content: 'Nest 接线记忆' });
    const r = await request(app.getHttpServer())
      .post('/api/memory/search')
      .set(authA())
      .send({ scope: 'user_preference', query: 'Nest' });
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(1);
  });
});
