import { KaypalAuthClient } from './kaypal-auth.client';

describe('KaypalAuthClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: jest.fn((name: string) =>
          name.toLowerCase() === 'content-type' ? 'application/json' : null,
        ),
      },
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as Response;

  it('normalizes desktop verification url to configured Kaypal origin', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        device_code: 'device-code',
        user_code: 'KAYPAL',
        verification_url:
          'https://0dbaef16d7a7:3000/api/desktop-auth/authorize?device_code=device-code&user_code=KAYPAL',
        expires_in: 600,
        interval: 2,
      }),
    } as unknown as Response);

    const client = new KaypalAuthClient({
      get: jest.fn((key: string) => {
        if (key === 'KAYPAL_AUTH_BASE_URL') {
          return 'https://test.kaypal.cn';
        }
        return '';
      }),
    } as any);

    const result = await client.startDesktopAuth({
      deviceId: 'device-1',
      deviceName: 'AI 内容工作台',
      platform: 'darwin',
    });

    expect(result.verification_url).toBe(
      'https://test.kaypal.cn/api/desktop-auth/authorize?device_code=device-code&user_code=KAYPAL',
    );
  });

  it('rejects an incomplete desktop authorization response without a user code', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        device_code: 'device-code',
        verification_url:
          'https://test.kaypal.cn/api/desktop-auth/authorize?device_code=device-code',
        expires_in: 600,
        interval: 2,
      }),
    ) as jest.Mock;

    const client = new KaypalAuthClient({
      get: jest.fn((key: string) =>
        key === 'KAYPAL_AUTH_BASE_URL' ? 'https://test.kaypal.cn' : '',
      ),
    } as any);

    await expect(
      client.startDesktopAuth({
        deviceId: 'windows-device-1',
        deviceName: 'Kaypal AI (Windows)',
        platform: 'windows',
      }),
    ).rejects.toThrow('Kaypal 授权返回数据不完整');
  });

  it('reads real billing balance through the configured server API key', async () => {
    global.fetch = jest.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === '/api/subscriptions/current') {
        return Promise.resolve(
          jsonResponse({
            subscription: { plan: 'ADVANCED', status: 'active' },
          }),
        );
      }
      if (url.pathname === '/api/billing/balance') {
        expect(url.searchParams.get('user_id')).toBe('kaypal-user-1');
        expect(
          (init?.headers as Record<string, string>)['x-kaypal-api-key'],
        ).toBe('server-key');
        expect(
          (init?.headers as Record<string, string>)['x-kaypal-user-id'],
        ).toBe('kaypal-user-1');
        return Promise.resolve(
          jsonResponse({ balance: 77, userId: 'kaypal-user-1' }),
        );
      }
      throw new Error(`unexpected url: ${url.toString()}`);
    }) as jest.Mock;

    const client = new KaypalAuthClient({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_BILLING_API_KEY: 'server-key',
        };
        return values[key] || '';
      }),
    } as any);

    await expect(
      client.getCloudBilling('desktop-token', { userId: 'kaypal-user-1' }),
    ).resolves.toEqual({
      subscription: expect.objectContaining({ plan: 'ADVANCED' }),
      balance: {
        balance: 77,
        userId: 'kaypal-user-1',
        raw: { balance: 77, userId: 'kaypal-user-1' },
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('deductCloudBilling 用服务端 key 调 kaypal deduct 接口（统一接 kaypal 积分）', async () => {
    let capturedBody: Record<string, unknown> = {};
    global.fetch = jest.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === '/api/billing/deduct') {
        capturedBody = JSON.parse(String(init?.body || '{}'));
        expect(
          (init?.headers as Record<string, string>)['x-kaypal-api-key'],
        ).toBe('server-key');
        return Promise.resolve(
          jsonResponse({
            id: 'deduct-1',
            amount: 15,
            balanceAfter: 985,
            success: true,
          }),
        );
      }
      throw new Error(`unexpected url: ${url.toString()}`);
    }) as jest.Mock;

    const client = new KaypalAuthClient({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_BILLING_API_KEY: 'server-key',
        };
        return values[key] || '';
      }),
    } as any);

    const result = await client.deductCloudBilling({
      userId: 'kaypal-user-1',
      serviceType: 'ai_content_workbench',
      resourceType: 'platform_action',
      idempotencyKey: 'ai-content:publish:confirm-1',
      metadata: { articlePublishes: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.balanceAfter).toBe(985);
    expect(capturedBody).toMatchObject({
      user_id: 'kaypal-user-1',
      service_type: 'ai_content_workbench',
      resource_type: 'platform_action',
      metadata: expect.objectContaining({
        source: 'ai-content-workbench',
        billingMode: 'cloud',
        idempotencyKey: 'ai-content:publish:confirm-1',
        articlePublishes: 2,
      }),
    });
  });

  it('deductCloudBilling 无服务端 key 时返回 ok:false（旁路不抛异常）', async () => {
    const client = new KaypalAuthClient({
      get: jest.fn(() => ''),
    } as any);

    const result = await client.deductCloudBilling({
      userId: 'kaypal-user-1',
      serviceType: 'ai_content_workbench',
      resourceType: 'platform_action',
    });

    expect(result.ok).toBe(false);
  });

  it('quoteCloudBilling 调 kaypal quote 接口返回预估积分 + 人民币', async () => {
    let capturedBody: Record<string, unknown> = {};
    global.fetch = jest.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === '/api/billing/quote') {
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return Promise.resolve(
          jsonResponse({
            userId: 'kaypal-user-1',
            serviceType: 'ai_content_workbench',
            resourceType: 'video_generation',
            quote: {
              managed: true,
              amount: 10,
              estimatedCostCny: 0.1,
              category: 'ai',
              pricingBasis: 'duration',
              inputs: { durationSeconds: 5 },
            },
          }),
        );
      }
      throw new Error(`unexpected url: ${url.toString()}`);
    }) as jest.Mock;

    const client = new KaypalAuthClient({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn',
          KAYPAL_BILLING_API_KEY: 'server-key',
        };
        return values[key] || '';
      }),
    } as any);

    const result = await client.quoteCloudBilling({
      userId: 'kaypal-user-1',
      serviceType: 'ai_content_workbench',
      resourceType: 'video_generation',
      metadata: { durationSeconds: 5 },
    });

    expect(result.ok).toBe(true);
    expect(result.quote).toMatchObject({
      managed: true,
      amount: 10,
      estimatedCostCny: 0.1,
    });
    expect(capturedBody).toMatchObject({
      user_id: 'kaypal-user-1',
      resource_type: 'video_generation',
      metadata: expect.objectContaining({ durationSeconds: 5 }),
    });
  });

  it('quoteCloudBilling 无服务端 key 时返回 ok:false', async () => {
    const client = new KaypalAuthClient({
      get: jest.fn(() => ''),
    } as any);

    const result = await client.quoteCloudBilling({
      userId: 'kaypal-user-1',
      serviceType: 'ai_content_workbench',
      resourceType: 'image_generation',
    });

    expect(result.ok).toBe(false);
  });
});
