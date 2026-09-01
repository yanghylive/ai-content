import { RuntimeOrchestrator } from './runtime-orchestrator.service';
import { ExecutorRouter } from '../executor-router';
import type { AuthRequestContextService } from '../../../common/auth-request-context.service';
import type { ConfigService } from '@nestjs/config';
import type { KaypalAuthClient } from '../../auth/kaypal-auth.client';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../executor.interface';

function makeTask(overrides: Partial<ExecutorTask> = {}): ExecutorTask {
  return {
    relatedId: 'task-1',
    relatedType: 'interaction-task',
    type: 'wechat-reply-draft',
    platform: 'wechat-desktop',
    accountId: 1,
    payload: {},
    ...overrides,
  };
}

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
  billing: {
    covered: true,
    scope: 'unit-test',
  },
};

const billableCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeResult(
  overrides: Partial<RuntimeExecutionResult> = {},
): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: 'test',
    runtime: { mode: 'agent-s', executor: 'desktop-agent-s' },
    evidence: [],
    ...overrides,
  };
}

function makeRouterMock(
  overrides: {
    routeResult?: RuntimeExecutionResult;
    healthCheckResult?: Array<{ id: string; ok: boolean; details?: string }>;
  } = {},
) {
  return {
    route: jest.fn().mockResolvedValue(overrides.routeResult ?? makeResult()),
    healthCheck: jest.fn().mockResolvedValue(
      overrides.healthCheckResult ?? [
        { id: 'agent-s', ok: true, details: 'mocked' },
        { id: 'local-runtime', ok: false, details: 'mocked' },
      ],
    ),
  } as unknown as ExecutorRouter;
}

describe('RuntimeOrchestrator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function makeAuthContextMock(
    overrides: Partial<{
      kaypalUserId: string;
      kaypalDesktopAccessToken: string;
    }> = {},
  ) {
    return {
      get: jest.fn(() => ({
        user: {
          kaypalUserId: overrides.kaypalUserId ?? 'cloud-user-1',
          kaypalDesktopAccessToken:
            overrides.kaypalDesktopAccessToken ?? 'cloud-token-1',
        },
      })),
    } as unknown as AuthRequestContextService;
  }

  function makeConfigMock(overrides: Record<string, string> = {}) {
    return {
      get: jest.fn(
        (key: string) =>
          overrides[key] ??
          (key === 'KAYPAL_AUTH_BASE_URL'
            ? 'https://test.kaypal.cn'
            : key === 'KAYPAL_API_KEY' || key === 'KAYPAL_AI_PROXY_API_KEY'
              ? 'server-api-key-1'
              : undefined),
      ),
    } as unknown as ConfigService;
  }

  function mockBillingFetch() {
    const fetchMock = jest.fn(async (url: URL | string) => {
      const pathname =
        url instanceof URL ? url.pathname : new URL(String(url)).pathname;
      if (pathname === '/api/billing/reserve') {
        return new Response(
          JSON.stringify({
            id: 'reserve-1',
            billing: {
              amount: 30,
              balanceAfter: 970,
              policyVersion: 'commercial-credit-v1-2026-06-29',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (pathname === '/api/billing/capture') {
        return new Response(
          JSON.stringify({
            id: 'tx-1',
            billing: {
              amount: 18,
              balanceAfter: 982,
              policyVersion: 'commercial-credit-v1-2026-06-29',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (pathname === '/api/billing/release') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected path' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    return fetchMock;
  }

  function makeKaypalClientMock(overrides: { refreshThrows?: string } = {}) {
    return {
      refreshDesktopAuthToken: jest.fn(async () => {
        if (overrides.refreshThrows) {
          throw new Error(overrides.refreshThrows);
        }
        return {
          access_token: 'fresh-token-1',
          refresh_token: 'fresh-refresh-token-1',
          expires_in: 3600,
          token_type: 'Bearer' as const,
          user_id: 'cloud-user-1',
          device_id: 'device-1',
        };
      }),
    } as unknown as jest.Mocked<KaypalAuthClient>;
  }

  describe('execute', () => {
    it('委派给 ExecutorRouter.route() 并返结果', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(router);

      const result = await orchestrator.execute(
        makeTask({ relatedId: 'orch-1' }),
        baseCtx,
      );

      expect(router.route).toHaveBeenCalledTimes(1);
      expect(router.route).toHaveBeenCalledWith(
        expect.objectContaining({ relatedId: 'orch-1' }),
        baseCtx,
      );
      expect(result.ok).toBe(true);
    });

    it('Router 返 reject result 时透传', async () => {
      const router = makeRouterMock({
        routeResult: makeResult({
          ok: false,
          status: 'failed',
          reasonCode: 'runtime_unavailable',
          userMessage: 'no executor',
        }),
      });
      const orchestrator = new RuntimeOrchestrator(router);

      const result = await orchestrator.execute(makeTask(), baseCtx);

      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('runtime_unavailable');
    });

    it('真实动作先冻结云端积分，执行后结算', async () => {
      const billingFetch = mockBillingFetch();
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        makeAuthContextMock(),
        makeConfigMock(),
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'platform-publish-image-text',
          platform: 'douyin',
          relatedId: 'publish-1',
          payload: { contentKind: 'article', targetCount: 2 },
        }),
        billableCtx,
      );

      expect(router.route).toHaveBeenCalledTimes(1);
      expect(billingFetch).toHaveBeenCalledTimes(2);
      expect(result.billing).toMatchObject({
        status: 'charged',
        amount: 18,
        reservationId: 'reserve-1',
        transactionId: 'tx-1',
        balanceAfter: 982,
      });

      const reserveBody = JSON.parse(
        (billingFetch.mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, any>;
      expect(reserveBody).toMatchObject({
        user_id: 'cloud-user-1',
        service_type: 'runtime_automation',
        resource_type: 'platform_action',
      });
      expect(reserveBody.metadata).toMatchObject({
        idempotencyKey:
          'ai-content:runtime:platform-publish-image-text:interaction-task:publish-1',
        taskType: 'platform-publish-image-text',
        articlePublishes: 2,
      });
    });

    it('视频换脸按服务端计费金额冻结和结算', async () => {
      const billingFetch = mockBillingFetch();
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        makeAuthContextMock(),
        makeConfigMock(),
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'video-face-swap',
          platform: 'mixed',
          relatedId: 'face-swap-1',
          relatedType: 'agent-session',
          payload: {
            mode: 'face_swap',
            durationSeconds: 95,
            outputName: 'brand-video.mp4',
            processors: ['face_swapper'],
            billingAmount: 48,
            estimatedCostPoints: 48,
            acceptedCostPoints: 48,
          },
        }),
        billableCtx,
      );

      expect(router.route).toHaveBeenCalledTimes(1);
      expect(result.billing?.status).toBe('charged');

      const reserveBody = JSON.parse(
        (billingFetch.mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, any>;
      const captureBody = JSON.parse(
        (billingFetch.mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, any>;

      expect(reserveBody).toMatchObject({
        amount: 48,
        resource_type: 'runtime_automation',
      });
      expect(reserveBody.metadata).toMatchObject({
        taskType: 'video-face-swap',
        mode: 'runtime_task',
        operationMode: 'face_swap',
        durationSeconds: 95,
        outputName: 'brand-video.mp4',
        billingAmount: 48,
        estimatedCostPoints: 48,
        acceptedCostPoints: 48,
        platformActions: 0,
      });
      expect(captureBody).toMatchObject({
        amount: 48,
        resource_type: 'runtime_automation',
      });
    });

    it('视频换脸缺少服务端计费金额时不执行真实动作', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        makeAuthContextMock(),
        makeConfigMock(),
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'video-face-swap',
          platform: 'mixed',
          relatedId: 'face-swap-no-price',
          relatedType: 'agent-session',
          payload: { mode: 'face_swap', durationSeconds: 60 },
        }),
        billableCtx,
      );

      expect(router.route).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('permission_missing');
      expect(result.billing).toMatchObject({
        status: 'failed',
        amount: 0,
      });
    });

    it('没有云端授权时拦截真实动作，不调用执行器', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(router);

      const result = await orchestrator.execute(
        makeTask({ type: 'platform-publish-video', platform: 'douyin' }),
        billableCtx,
      );

      expect(router.route).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe('permission_missing');
      expect(result.billing).toMatchObject({
        status: 'failed',
        amount: 0,
      });
    });

    it('后台任务身份 token 过期时先刷新再扣费', async () => {
      const billingFetch = mockBillingFetch();
      const kaypalClient = makeKaypalClientMock();
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        undefined,
        makeConfigMock(),
        kaypalClient,
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'wechat-contact-add',
          platform: 'wechat-desktop',
          relatedId: 'contact-add-1',
        }),
        {
          ...billableCtx,
          billing: {
            scope: 'task-queue',
            identity: {
              localUserId: 'operator-1',
              kaypalUserId: 'cloud-user-1',
              kaypalDesktopAccessToken: 'expired-token',
              kaypalDesktopRefreshToken: 'refresh-token-1',
              kaypalDesktopTokenExpiresAt: new Date(
                Date.now() - 1000,
              ).toISOString(),
              kaypalDesktopDeviceId: 'device-1',
              capturedAt: new Date().toISOString(),
            },
          },
        },
      );

      expect(result.billing?.status).toBe('charged');
      expect(kaypalClient.refreshDesktopAuthToken).toHaveBeenCalledWith({
        refreshToken: 'refresh-token-1',
        deviceId: 'device-1',
      });
      expect(
        (billingFetch.mock.calls[0][1] as RequestInit).headers,
      ).toMatchObject({
        Authorization: 'Bearer fresh-token-1',
      });
    });

    it('后台任务只保存 sessionId 时从会话元数据恢复云端扣费 token', async () => {
      const billingFetch = mockBillingFetch();
      const router = makeRouterMock();
      const prisma = {
        system: {
                userSession: {
                  findFirst: jest.fn(async () => ({
                    metadata: {
                      kaypalDesktopAccessToken: 'session-token-1',
                      kaypalDesktopRefreshToken: 'session-refresh-1',
                      kaypalDesktopDeviceId: 'session-device-1',
                      kaypalDesktopTokenExpiresAt: new Date(
                        Date.now() + 10 * 60_000,
                      ).toISOString(),
                    },
                    user: {
                      kaypalUserId: 'cloud-user-1',
                    },
                  })),
                  update: jest.fn(),
                },
        },
      };
      const orchestrator = new RuntimeOrchestrator(
        router,
        undefined,
        makeConfigMock(),
        undefined,
        prisma as never,
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'wechat-contact-add',
          platform: 'wechat-desktop',
          relatedId: 'contact-add-1',
        }),
        {
          ...billableCtx,
          billing: {
            scope: 'task-queue',
            identity: {
              sessionId: 'session-1',
              localUserId: 'operator-1',
              kaypalUserId: 'cloud-user-1',
              capturedAt: new Date().toISOString(),
            },
          },
        },
      );

      expect(result.billing?.status).toBe('charged');
      expect(prisma.system.userSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'session-1',
            userId: 'operator-1',
          }),
        }),
      );
      expect(
        (billingFetch.mock.calls[0][1] as RequestInit).headers,
      ).toMatchObject({
        Authorization: 'Bearer session-token-1',
      });
    });

    it('没有桌面 token 时可直接使用服务端 key 冻结和结算', async () => {
      const billingFetch = mockBillingFetch();
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        makeAuthContextMock({
          kaypalDesktopAccessToken: '',
        }),
        makeConfigMock({
          KAYPAL_API_KEY: 'server-api-key-1',
        }),
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'platform-publish-image-text',
          platform: 'douyin',
          relatedId: 'publish-server-key-1',
          payload: { contentKind: 'article', targetCount: 1 },
        }),
        billableCtx,
      );

      expect(result.billing?.status).toBe('charged');
      expect(billingFetch.mock.calls).toHaveLength(2);
      expect(
        (billingFetch.mock.calls[0][1] as RequestInit).headers,
      ).toMatchObject({
        'x-kaypal-api-key': 'server-api-key-1',
        'x-kaypal-user-id': 'cloud-user-1',
      });
    });

    it('桌面 token 失效时自动回退到服务端 key', async () => {
      const fetchMock = jest.fn(
        async (url: URL | string, init?: RequestInit) => {
          const pathname =
            url instanceof URL ? url.pathname : new URL(String(url)).pathname;
          const headers = new Headers(init?.headers);
          const isServerKey = headers.has('x-kaypal-api-key');
          const successPayload = (id: string) =>
            new Response(
              JSON.stringify({
                id,
                billing: {
                  amount: 18,
                  balanceAfter: 982,
                  policyVersion: 'commercial-credit-v1-2026-06-29',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );

          if (
            (pathname === '/api/billing/reserve' ||
              pathname === '/api/billing/capture') &&
            !isServerKey
          ) {
            return new Response(
              JSON.stringify({
                error: 'unauthorized',
                message: 'token expired',
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } },
            );
          }

          if (pathname === '/api/billing/reserve') {
            return successPayload('reserve-server-1');
          }
          if (pathname === '/api/billing/capture') {
            return successPayload('tx-server-1');
          }
          if (pathname === '/api/billing/release') {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ error: 'unexpected path' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      ) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock;

      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        makeAuthContextMock({
          kaypalDesktopAccessToken: 'expired-token-1',
        }),
        makeConfigMock({
          KAYPAL_API_KEY: 'server-api-key-1',
        }),
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'platform-publish-video',
          platform: 'douyin',
          relatedId: 'publish-fallback-1',
          payload: { contentKind: 'video', targetCount: 1 },
        }),
        billableCtx,
      );

      expect(result.billing?.status).toBe('charged');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject(
        {
          Authorization: 'Bearer expired-token-1',
        },
      );
      expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject(
        {
          'x-kaypal-api-key': 'server-api-key-1',
          'x-kaypal-user-id': 'cloud-user-1',
        },
      );
    });

    it('桌面 token 刷新失败时回退到服务端 key', async () => {
      const billingFetch = mockBillingFetch();
      const kaypalClient = makeKaypalClientMock({
        refreshThrows: 'refresh_token 无效或已过期',
      });
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(
        router,
        undefined,
        makeConfigMock({
          KAYPAL_API_KEY: 'server-api-key-1',
        }),
        kaypalClient,
      );

      const result = await orchestrator.execute(
        makeTask({
          type: 'platform-publish-image-text',
          platform: 'douyin',
          relatedId: 'publish-refresh-fallback-1',
          payload: { contentKind: 'article', targetCount: 1 },
        }),
        {
          ...billableCtx,
          billing: {
            scope: 'task-queue',
            identity: {
              localUserId: 'operator-1',
              kaypalUserId: 'cloud-user-1',
              kaypalDesktopAccessToken: 'expired-token',
              kaypalDesktopRefreshToken: 'refresh-token-1',
              kaypalDesktopTokenExpiresAt: new Date(
                Date.now() - 1000,
              ).toISOString(),
              kaypalDesktopDeviceId: 'device-1',
              capturedAt: new Date().toISOString(),
            },
          },
        },
      );

      expect(result.billing?.status).toBe('charged');
      expect(kaypalClient.refreshDesktopAuthToken).toHaveBeenCalledTimes(2);
      expect(billingFetch.mock.calls).toHaveLength(2);
      expect(
        (billingFetch.mock.calls[0][1] as RequestInit).headers,
      ).toMatchObject({
        'x-kaypal-api-key': 'server-api-key-1',
        'x-kaypal-user-id': 'cloud-user-1',
      });
    });
  });

  describe('healthCheck', () => {
    it('委派给 ExecutorRouter.healthCheck() 并返所有执行器状态', async () => {
      const router = makeRouterMock({
        healthCheckResult: [
          { id: 'agent-s', ok: true, details: 'ready' },
          { id: 'local-runtime', ok: true, details: 'engine up' },
        ],
      });
      const orchestrator = new RuntimeOrchestrator(router);

      const healths = await orchestrator.healthCheck();

      expect(router.healthCheck).toHaveBeenCalledTimes(1);
      expect(healths).toHaveLength(2);
      expect(healths[0].id).toBe('agent-s');
      expect(healths[1].id).toBe('local-runtime');
    });
  });

  describe('扣费覆盖契约', () => {
    it('上层已覆盖扣费时只委派给 ExecutorRouter', async () => {
      const router = makeRouterMock();
      const orchestrator = new RuntimeOrchestrator(router);

      // 多次调用都只走 Router
      await orchestrator.execute(makeTask(), baseCtx);
      await orchestrator.execute(makeTask(), baseCtx);
      await orchestrator.healthCheck();

      expect(router.route).toHaveBeenCalledTimes(2);
      expect(router.healthCheck).toHaveBeenCalledTimes(1);
    });
  });
});
