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
});
