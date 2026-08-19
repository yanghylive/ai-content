import { BadRequestException, ConflictException } from '@nestjs/common';
import { RpaController } from './rpa.controller';
import { RpaDriverRegistry } from './rpa-driver-registry.service';
import { RpaExecutionStore } from './rpa-execution-store.service';

/**
 * RpaController 复核#4 修复 + P0-1/P0-2：
 * - createExecution 真正执行（openSession → create → 首个动作 → appendStep → finalize）
 * - unsupported 拒绝创建（不降级假 sessionId + running）
 * - finalize 成功终态强制证据守卫（P0-1）
 * - 账号锁/真实会话关闭/close_failed（P0-2）
 */
function makeRegistry(driver?: Record<string, unknown>) {
  return { get: jest.fn().mockReturnValue(driver ?? null) } as any;
}

function makeReadyDriver(overrides: Record<string, unknown> = {}) {
  const { execute: executeOverride, ...rest } = overrides;
  return {
    capabilities: jest.fn().mockResolvedValue({
      platform: 'kuaishou',
      displayName: '快手RPA',
      runtimeReady: true,
      driverVersion: '1.0.0',
      actions: [
        { action: 'discover-keyword', supported: true },
        { action: 'discover-account-works', supported: true },
        { action: 'read-comments', supported: true },
        // P1 复核：replyComment 独立记录测试需要触达能力
        { action: 'reply-comment', supported: true },
        { action: 'send-direct-message', supported: true },
      ],
    }),
    openSession: jest
      .fn()
      .mockResolvedValue({ sessionId: 'ks-real-1', platform: 'kuaishou' }),
    execute:
      typeof executeOverride === 'function'
        ? executeOverride
        : jest.fn().mockResolvedValue(
            executeOverride ?? {
              stepName: 'discover-keyword',
              status: 'success',
              reasonCode: 'ok',
              attempt: 1,
              durationMs: 10,
              driverVersion: '1.0.0',
              items: [{ title: '装修案例', url: 'https://kuaishou.com/v/1' }],
            },
          ),
    closeSession: jest.fn().mockResolvedValue(undefined),
    ...rest,
  } as any;
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    create: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
    createWithLock: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
    findOne: jest.fn().mockResolvedValue({
      id: 'rpa-1',
      platform: 'kuaishou',
      sessionId: 'ks-real-1',
      accountId: 'ks-1',
      steps: [],
      pageFingerprint: null,
      status: 'running',
    }),
    appendStep: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
    finalize: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
    transition: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
    hasActiveExecution: jest.fn().mockResolvedValue(false),
    ...overrides,
  } as any;
}

function makeController(
  registry: Record<string, unknown>,
  store: Record<string, unknown>,
  prisma: Record<string, unknown> = {
    // fail-closed 归属校验：默认返回归属测试用户（user-1）的授权账号 → 校验放行
    exposureAccount: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ userId: 'user-1', status: 'active' }),
    },
    tenantMember: { findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }) },
  },
) {
  return new RpaController(
    registry as RpaDriverRegistry,
    store as RpaExecutionStore,
    prisma as never,
    undefined,
  ) as any;
}

const owner = { userId: 'user-1', tenantId: 'tenant-1' };

describe('RpaController 复核#4（真执行 + 证据守卫 + 会话控制）', () => {

  it('createExecution：driver 就绪 → openSession + create + 执行首个动作 + finalize success（带证据）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    const result = await controller.createExecution(
      { authUser: { id: 'user-1' } },
      { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
    );

    expect(driver.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'discover-keyword',
        input: expect.objectContaining({ keyword: '装修' }),
      }),
    );
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success' }),
      { internal: true },
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success' }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'rpa-1' }));
  });

  it('createExecution：driver 不存在 → 抛 BadRequestException（不再降级 running）', async () => {
    const store = makeStore();
    const controller = makeController(makeRegistry(null), store);

    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'wechat-channel', accountId: 'wx-1', mode: 'keyword' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('createExecution：driver 运行时未就绪 → 抛 BadRequestException', async () => {
    const driver = {
      capabilities: jest.fn().mockResolvedValue({
        platform: 'kuaishou',
        runtimeReady: false,
        actions: [{ action: 'discover-keyword', supported: false }],
      }),
      openSession: jest.fn(),
    } as any;
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.create).not.toHaveBeenCalled();
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('createExecution：动作执行失败 → finalize failed（如实，不伪装成功）', async () => {
    const driver = makeReadyDriver({
      execute: {
        stepName: 'discover-keyword',
        status: 'failed',
        reasonCode: 'parse_failed',
        message: '搜索页未解析',
        attempt: 1,
        durationMs: 10,
        driverVersion: '1.0.0',
      },
    });
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await controller.createExecution(
      { authUser: { id: 'user-1' } },
      { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
    );

    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'failed', reasonCode: 'parse_failed' }),
      { internal: true },
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'failed', reasonCode: 'parse_failed' }),
    );
  });

  it('createExecution：execute 抛错 → finalize failed（network_error）', async () => {
    const driver = makeReadyDriver({
      execute: jest.fn().mockRejectedValue(new Error('session died')),
    });
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await controller.createExecution(
      { authUser: { id: 'user-1' } },
      { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
    );

    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'failed', reasonCode: 'network_error' }),
    );
  });

  it('video-link 模式 → 动作映射 read-comments（内容 URL 输入）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await controller.createExecution(
      { authUser: { id: 'user-1' } },
      {
        platform: 'kuaishou',
        accountId: 'ks-1',
        mode: 'video-link',
        sourceUrl: 'https://www.kuaishou.com/video/1',
      },
    );

    expect(driver.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'read-comments',
        input: expect.objectContaining({
          contentUrl: 'https://www.kuaishou.com/video/1',
        }),
      }),
    );
  });

  it('finalize 端点不接受客户端 evidence（证据只能服务端写入）；门禁校验交给 store', async () => {
    const store = makeStore({
      findOne: jest.fn().mockResolvedValue({
        id: 'rpa-1',
        platform: 'kuaishou',
        sessionId: 'ks-real-1',
        steps: [],
        pageFingerprint: null,
        status: 'failed',
      }),
    });
    const controller = makeController(makeRegistry(null), store);

    const result = await controller.finalize(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      // 客户端传 evidence 会被忽略（请求体不再接收）
      { status: 'success', reasonCode: 'ok', evidence: [{ fake: true }] } as never,
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success', reasonCode: 'ok' }),
    );
    // 客户端 evidence 未透传（请求体不再接收）
    expect(store.finalize.mock.calls.at(-1)[2].evidence).toBeUndefined();
    expect(result).toBeDefined();
  });

  it('finalize 成功终态有成功步骤 → 放行', async () => {
    const store = makeStore({
      findOne: jest.fn().mockResolvedValue({
        id: 'rpa-1',
        platform: 'kuaishou',
        steps: [{ stepName: 'discover-keyword', status: 'success' }],
        pageFingerprint: 'abc123',
        status: 'running',
      }),
    });
    const controller = makeController(makeRegistry(null), store);

    await controller.finalize(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      { status: 'success', reasonCode: 'ok' },
    );

    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('finalize 失败终态不要求证据 → 放行', async () => {
    const store = makeStore();
    const controller = makeController(makeRegistry(null), store);

    await controller.finalize(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      { status: 'failed', reasonCode: 'parse_failed' },
    );

    expect(store.finalize).toHaveBeenCalled();
  });

  it('pause → 关闭真实 driver 会话（冻结执行）+ 状态迁移', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await controller.pause(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      {},
    );

    expect(driver.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ks-real-1' }),
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'paused',
      expect.anything(),
    );
  });

  it('cancel → 关闭真实 driver 会话（防已取消继续发送）+ 状态迁移', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);

    await controller.cancel({ authUser: { id: 'user-1' } }, 'rpa-1');

    expect(driver.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ks-real-1' }),
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'cancelled',
      expect.anything(),
    );
  });

  it('resume：paused + 断点 → 真续跑 read-comments → success 终态（P0-3）', async () => {
    const driver = makeReadyDriver({
      openSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'ks-real-2', platform: 'kuaishou' }),
      execute: jest.fn().mockResolvedValue({
        stepName: 'read-comments',
        status: 'success',
        reasonCode: 'ok',
        attempt: 1,
        durationMs: 10,
        driverVersion: '1.0.0',
        items: [{ id: 'c1', text: '怎么收费' }],
      }),
    });
    const store = makeStore();
    store.findOne.mockResolvedValueOnce({
      id: 'rpa-1',
      platform: 'kuaishou',
      sessionId: 'ks-real-1',
      accountId: 'ks-1',
      steps: [{ stepName: 'discover-keyword', status: 'success' }],
      pageFingerprint: null,
      status: 'paused',
      resumeStep: 'read-comments',
      inputJson: { contentUrl: 'https://kuaishou.com/v/1', limit: 20 },
    });
    const controller = makeController(makeRegistry(driver), store);

    const result = await controller.resume({ authUser: { id: 'user-1' } }, 'rpa-1');

    expect(driver.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'read-comments',
        input: expect.objectContaining({ contentUrl: 'https://kuaishou.com/v/1' }),
      }),
    );
    // 恢复成功走 store.finalize（业务步骤证据门禁，不绕过）
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success', resumeStep: null, reasonCode: 'ok' }),
    );
    // 关闭会话在 finally 中执行
    expect(driver.closeSession).toHaveBeenCalled();
  });

  it('resume：断点续跑 execute 返回 failed → transition(paused, resume_failed)，断点保留不 finalize（状态机不死路）', async () => {
    const driver = makeReadyDriver({
      openSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'ks-real-3', platform: 'kuaishou' }),
      execute: jest.fn().mockResolvedValue({
        stepName: 'read-comments',
        status: 'failed',
        reasonCode: 'network_error',
        message: '页面加载超时',
        attempt: 1,
        durationMs: 5,
        driverVersion: '1.0.0',
      }),
    });
    const store = makeStore({
      transition: jest.fn().mockResolvedValue({
        id: 'rpa-1',
        status: 'paused',
        resumeStep: 'read-comments',
      }),
    });
    store.findOne.mockResolvedValueOnce({
      id: 'rpa-1',
      platform: 'kuaishou',
      sessionId: 'ks-real-1',
      accountId: 'ks-1',
      steps: [{ stepName: 'discover-keyword', status: 'success' }],
      pageFingerprint: null,
      status: 'paused',
      resumeStep: 'read-comments',
      inputJson: { contentUrl: 'https://kuaishou.com/v/1', limit: 20 },
    });
    const controller = makeController(makeRegistry(driver), store);

    const result = await controller.resume(
      { authUser: { id: 'user-1' } },
      'rpa-1',
    );

    // 失败步骤如实记录（internal 服务端步骤）
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({
        stepName: 'read-comments',
        status: 'failed',
        reasonCode: 'network_error',
      }),
      { internal: true },
    );
    // P0 复核（全面审查）：恢复失败转 paused（不是 failed 终态）——断点保留，
    // 可再次发起 resume，状态机不死路
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'paused',
      expect.objectContaining({
        reasonCode: 'resume_failed',
        resumeStep: 'read-comments',
      }),
    );
    // 失败路径不走 finalize（成功终态只能由真实业务成功 + 证据门禁达成）
    expect(store.finalize).not.toHaveBeenCalled();
    // 返回 transition 后的 paused 记录（断点仍在）
    expect(result).toMatchObject({
      status: 'paused',
      resumeStep: 'read-comments',
    });
    // finally 中真实会话被释放
    expect(driver.closeSession).toHaveBeenCalled();
  });

  it('resume：状态非 paused/needs-human → 400（不能从 running 恢复）', async () => {
    const store = makeStore();
    store.findOne.mockResolvedValueOnce({
      id: 'rpa-1',
      platform: 'kuaishou',
      sessionId: 'ks-real-1',
      accountId: 'ks-1',
      steps: [],
      pageFingerprint: null,
      status: 'running',
      resumeStep: null,
    });
    const controller = makeController(makeRegistry(null), store);
    await expect(
      controller.resume({ authUser: { id: 'user-1' } }, 'rpa-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resume：无断点（resumeStep 空）→ 400', async () => {
    const store = makeStore();
    store.findOne.mockResolvedValueOnce({
      id: 'rpa-1',
      platform: 'kuaishou',
      sessionId: 'ks-real-1',
      accountId: 'ks-1',
      steps: [],
      pageFingerprint: null,
      status: 'paused',
      resumeStep: null,
    });
    const controller = makeController(makeRegistry(null), store);
    await expect(
      controller.resume({ authUser: { id: 'user-1' } }, 'rpa-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('createExecution：账号有活动执行 → ConflictException（account_busy）', async () => {
    const store = makeStore({ hasActiveExecution: jest.fn().mockResolvedValue(true) });
    const controller = makeController(makeRegistry(null), store);
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.hasActiveExecution).toHaveBeenCalledWith(
      expect.anything(),
      'kuaishou',
      'ks-1',
    );
  });

  it('pause：closeSession 失败 → transition reconcile_required（P0-7 不写目标状态 paused）', async () => {
    const driver = makeReadyDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('browser gone'));
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);
    await controller.pause(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      {},
    );
    // P0-7 复核：浏览器未确认停止 → 不能写 paused，转 reconcile_required
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'close_failed' }),
    );
    // 关闭失败步骤落审计
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({
        stepName: 'close-session',
        status: 'failed',
        reasonCode: 'close_failed',
      }),
      { internal: true },
    );
  });

  it('pause：closeSession 成功 → 正常写 paused', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);
    await controller.pause(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      {},
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'paused',
      expect.objectContaining({ reasonCode: 'user_paused' }),
    );
  });

  it('cancel：closeSession 失败 → reconcile_required（不写 cancelled）', async () => {
    const driver = makeReadyDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('browser gone'));
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);
    await controller.cancel(
      { authUser: { id: 'user-1' } },
      'rpa-1',
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'close_failed' }),
    );
  });

  it('manual-takeover：closeSession 失败 → reconcile_required（不写 needs-human）', async () => {
    const driver = makeReadyDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('browser gone'));
    const store = makeStore();
    const controller = makeController(makeRegistry(driver), store);
    await controller.manualTakeover(
      { authUser: { id: 'user-1' } },
      'rpa-1',
      {},
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'close_failed' }),
    );
  });
});

describe('账号归属 fail-closed 校验（复核 P0/P1）', () => {
  function makeControllerWithPrisma(
    registry: Record<string, unknown>,
    store: Record<string, unknown>,
    prisma: Record<string, unknown>,
  ) {
    return new RpaController(
      registry as RpaDriverRegistry,
      store as RpaExecutionStore,
      prisma as never,
      undefined,
    ) as any;
  }

  it('账号未纳管（无授权记录）→ createExecution 阻断', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const prisma = {
      exposureAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const controller = makeControllerWithPrisma(
      makeRegistry(driver),
      store,
      prisma,
    );
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'other-account', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('账号归属他人且非同租户 → createExecution 阻断', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const prisma = {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'other-user', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const controller = makeControllerWithPrisma(
      makeRegistry(driver),
      store,
      prisma,
    );
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'other-account', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('授权表查询异常 → fail-closed 阻断（不放行）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const prisma = {
      exposureAccount: {
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const controller = makeControllerWithPrisma(
      makeRegistry(driver),
      store,
      prisma,
    );
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('账号归属他人但同租户成员 → 放行', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const prisma = {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'teammate-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }) },
    };
    const controller = makeControllerWithPrisma(
      makeRegistry(driver),
      store,
      prisma,
    );
    const result = await controller.createExecution(
      { authUser: { id: 'user-1', tenantId: 'tenant-1' } },
      { platform: 'kuaishou', accountId: 'teammate-acct', mode: 'keyword', keyword: '装修' },
    );
    expect(driver.openSession).toHaveBeenCalled();
  });

  it('replyComment 账号不归属 → 阻断（防越权触达）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const prisma = {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'other-user', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const controller = makeControllerWithPrisma(
      makeRegistry(driver),
      store,
      prisma,
    );
    await expect(
      controller.replyComment(
        { authUser: { id: 'user-1' } },
        {
          platform: 'kuaishou',
          accountId: 'other-acct',
          contentUrl: 'https://www.kuaishou.com/short-video/1',
          targetText: '怎么收费',
          replyText: '可以交流',
          dryRun: true,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('replyComment 成功 → 创建独立执行记录（绑定本次 runId）+ finalize 成功（P1 复核：不再写「最新一条」其他任务）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    const result = await controller.replyComment(
      { authUser: { id: 'user-1' } },
      {
        platform: 'kuaishou',
        accountId: 'ks-1',
        contentUrl: 'https://www.kuaishou.com/short-video/1',
        targetText: '怎么收费',
        replyText: '可以交流',
        dryRun: false,
      },
    );

    // P1 复核：独立执行记录走 createWithLock（统一原子锁），绑定 reply runId
    expect(store.createWithLock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'kuaishou',
        accountId: 'ks-1',
        mode: 'reply-comment',
        runId: expect.stringMatching(/^rpa-reply-/),
        status: 'running',
      }),
    );
    // 成功：appendStep success + finalize success + 证据
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ stepName: 'reply-comment', status: 'success' }),
      { internal: true },
    );
    expect(store.finalize).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({ status: 'success', reasonCode: 'ok' }),
    );
    expect(result).toMatchObject({
      platform: 'kuaishou',
      dryRun: false,
      sent: true,
      rpaRecordId: 'rpa-1',
    });
  });

  it('replyComment 关闭失败 → 步骤写入本回复自己的记录、转 reconcile_required，且接口返回 sent:false（P1 复核：不污染其他任务、不谎报成功）', async () => {
    const driver = makeReadyDriver();
    driver.closeSession = jest
      .fn()
      .mockRejectedValue(new Error('close session timeout'));
    const store = makeStore();
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    const result = await controller.replyComment(
      { authUser: { id: 'user-1' } },
      {
        platform: 'kuaishou',
        accountId: 'ks-1',
        contentUrl: 'https://www.kuaishou.com/short-video/1',
        targetText: '怎么收费',
        replyText: '可以交流',
        dryRun: false,
      },
    );

    // P1 复核：close-session 失败步骤写到本次回复自己的记录（rpa-1），不是「最新一条」
    expect(store.appendStep).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      expect.objectContaining({
        stepName: 'close-session',
        status: 'failed',
        reasonCode: 'close_failed',
      }),
      { internal: true },
    );
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'session_close_failed' }),
    );
    // P1 复核：关闭失败 → 接口不能返回 sent:true（后台已转 reconcile_required）
    expect(result).toMatchObject({
      sent: false,
      status: 'reconcile_required',
      message: expect.stringContaining('人工核对'),
    });
  });

  it('replyComment 执行记录创建失败 → 阻断外发（driver.execute 不被调用，无审计外发禁止）（P0 复核）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore({
      createWithLock: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      controller.replyComment(
        { authUser: { id: 'user-1' } },
        {
          platform: 'kuaishou',
          accountId: 'ks-1',
          contentUrl: 'https://www.kuaishou.com/short-video/1',
          targetText: '怎么收费',
          replyText: '可以交流',
          dryRun: false,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // P0 复核：审计记录创建失败 → 不执行真实回复（无审计外发禁止）
    expect(driver.execute).not.toHaveBeenCalled();
    expect(driver.closeSession).toHaveBeenCalled();
  });

  it('replyComment 审计终态写失败 → 不返回 sent:true，转 reconcile_required 后抛错（P0 复核）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    store.appendStep = jest.fn().mockResolvedValue({ id: 'rpa-1' });
    store.finalize = jest.fn().mockRejectedValue(new Error('evidence write failed'));
    store.transition = jest.fn().mockResolvedValue({ id: 'rpa-1' });
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      controller.replyComment(
        { authUser: { id: 'user-1' } },
        {
          platform: 'kuaishou',
          accountId: 'ks-1',
          contentUrl: 'https://www.kuaishou.com/short-video/1',
          targetText: '怎么收费',
          replyText: '可以交流',
          dryRun: false,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 回复确实执行了，但审计终态写失败 → 转 reconcile_required（audit_write_failed），不返回 sent:true
    expect(driver.execute).toHaveBeenCalled();
    expect(store.transition).toHaveBeenCalledWith(
      'rpa-1',
      expect.anything(),
      'reconcile_required',
      expect.objectContaining({ reasonCode: 'audit_write_failed' }),
    );
  });

  it('replyComment driver 成功但 finalize 降级 reconcile_required（无回读证据）→ 接口 sent:false（P0-4 最终状态以审计为准）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    store.appendStep = jest.fn().mockResolvedValue({ id: 'rpa-1' });
    // finalize 返回 reconcile_required（证据不足被门禁降级，driver 虽报 success）
    store.finalize = jest
      .fn()
      .mockResolvedValue({ id: 'rpa-1', status: 'reconcile_required' });
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    const result = await controller.replyComment(
      { authUser: { id: 'user-1' } },
      {
        platform: 'kuaishou',
        accountId: 'ks-1',
        contentUrl: 'https://www.kuaishou.com/short-video/1',
        targetText: '怎么收费',
        replyText: '可以交流',
        dryRun: false,
      },
    );

    // P0-4 复核：driver 报 success 但审计无回读证据 → sent:false + reconcile_required
    expect(result.sent).toBe(false);
    expect(result.status).toBe('reconcile_required');
    expect(result.message).toContain('人工核对');
  });

  it('replyComment finalize 返回 success → sent:true（有证据闭环）', async () => {
    const driver = makeReadyDriver();
    const store = makeStore();
    store.appendStep = jest.fn().mockResolvedValue({ id: 'rpa-1' });
    store.finalize = jest.fn().mockResolvedValue({ id: 'rpa-1', status: 'success' });
    const controller = makeControllerWithPrisma(makeRegistry(driver), store, {
      exposureAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', status: 'active' }),
      },
      tenantMember: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    const result = await controller.replyComment(
      { authUser: { id: 'user-1' } },
      {
        platform: 'kuaishou',
        accountId: 'ks-1',
        contentUrl: 'https://www.kuaishou.com/short-video/1',
        targetText: '怎么收费',
        replyText: '可以交流',
        dryRun: false,
      },
    );

    expect(result.sent).toBe(true);
    expect(result.status).toBe('success');
  });
});

describe('RpaController 证据字节 hash（P1-1 复核）', () => {
  it('screenshotPath 指向真实文件 → sha256 = 文件字节 hash（可复验捕获物）', async () => {
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const tmp = '/tmp/p11-evidence-test.png';
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    fs.writeFileSync(tmp, bytes);
    try {
      const controller = makeController(makeRegistry(makeReadyDriver()), makeStore());
      const ev = (controller as any).stepEvidence(
        { screenshotPath: tmp },
        { executionId: 'e-1', accountId: 'a-1', platform: 'kuaishou' },
      );
      const shot = ev.find((e: any) => e.type === 'rpa-screenshot');
      // P1-1 复核：真实文件字节 sha256（不再是 URL+时间字符串 hash）
      expect(shot.sha256).toBe(
        crypto.createHash('sha256').update(bytes).digest('hex'),
      );
      expect(shot.sha256).toHaveLength(64);
      expect(shot.executionId).toBe('e-1');
      expect(shot.accountId).toBe('a-1');
      expect(shot.platform).toBe('kuaishou');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('rpa-items 证据补 sha256 = 发现结果序列化字节 hash（不再无 hash）', async () => {
    const crypto = require('node:crypto');
    const controller = makeController(makeRegistry(makeReadyDriver()), makeStore());
    const items = [{ externalContentId: 'c1', url: 'https://example.com/v/1' }];
    const ev = (controller as any).stepEvidence({ items }, {});
    const itemsEv = ev.find((e: any) => e.type === 'rpa-items');
    expect(itemsEv.sha256).toBe(
      crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex'),
    );
  });

  it('非文件证据（fingerprint）→ 内容序列化字节 hash + metadata 标注', async () => {
    const controller = makeController(makeRegistry(makeReadyDriver()), makeStore());
    const ev = (controller as any).stepEvidence(
      { pageFingerprint: 'fp-abc-123' },
      {},
    );
    const fp = ev.find((e: any) => e.type === 'rpa-fingerprint');
    expect(fp.sha256).toHaveLength(64);
    expect(fp.metadata?.source).toBe('capture-content');
  });
});

describe('RpaController preflight 门禁（P1-5 复核）', () => {
  function makeProbeDriver(probe: Record<string, unknown>) {
    return {
      capabilities: jest.fn().mockResolvedValue({
        platform: 'kuaishou',
        displayName: '快手RPA',
        runtimeReady: true,
        driverVersion: '1.0.0',
        accountProbe: { accountId: 'ks-1', checkedAt: new Date().toISOString(), reasonCode: null, ...probe },
        actions: [{ action: 'discover-keyword', supported: true }],
      }),
      openSession: jest.fn().mockResolvedValue({ sessionId: 's1', platform: 'kuaishou' }),
      execute: jest.fn().mockResolvedValue({
        stepName: 'discover-keyword', status: 'success', reasonCode: 'ok',
        attempt: 1, durationMs: 5, driverVersion: '1.0.0',
        items: [{ externalContentId: 'c1', url: 'https://kuaishou.com/v/1' }],
      }),
      closeSession: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  it('createExecution：probe busy=true → 拒绝创建（account_busy）', async () => {
    const driver = makeProbeDriver({ loggedIn: true, browserReady: true, pageInteractive: true, busy: true });
    const controller = makeController(makeRegistry(driver), makeStore());
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toThrow('account_busy');
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('createExecution：browserReady=false → 拒绝创建（browser_not_ready）', async () => {
    const driver = makeProbeDriver({ loggedIn: true, browserReady: false, pageInteractive: true });
    const controller = makeController(makeRegistry(driver), makeStore());
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toThrow('browser_not_ready');
    expect(driver.openSession).not.toHaveBeenCalled();
  });

  it('createExecution：pageInteractive=false → 拒绝创建（page_not_interactive）', async () => {
    const driver = makeProbeDriver({ loggedIn: true, browserReady: true, pageInteractive: false });
    const controller = makeController(makeRegistry(driver), makeStore());
    await expect(
      controller.createExecution(
        { authUser: { id: 'user-1' } },
        { platform: 'kuaishou', accountId: 'ks-1', mode: 'keyword', keyword: '装修' },
      ),
    ).rejects.toThrow('page_not_interactive');
  });

  it('listCapabilities：账号有活动执行 → probe.busy=true 注入（前端可见账号忙碌）', async () => {
    const driver = makeProbeDriver({ loggedIn: true, browserReady: true, pageInteractive: true });
    const store = makeStore();
    store.hasActiveExecution = jest.fn().mockResolvedValue(true);
    const controller = makeController(makeRegistry(driver), store);

    const caps = await controller.listCapabilities(
      { authUser: { id: 'user-1', tenantId: 'tenant-1' } },
      'kuaishou',
      'ks-1',
    );
    expect(caps[0].accountProbe.busy).toBe(true);
  });

  it('listCapabilities：无活动执行 → probe.busy=false', async () => {
    const driver = makeProbeDriver({ loggedIn: true, browserReady: true, pageInteractive: true });
    const store = makeStore();
    store.hasActiveExecution = jest.fn().mockResolvedValue(false);
    const controller = makeController(makeRegistry(driver), store);

    const caps = await controller.listCapabilities(
      { authUser: { id: 'user-1', tenantId: 'tenant-1' } },
      'kuaishou',
      'ks-1',
    );
    expect(caps[0].accountProbe.busy).toBe(false);
  });
});
