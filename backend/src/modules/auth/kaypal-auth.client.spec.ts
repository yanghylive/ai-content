import { KaypalAuthClient } from './kaypal-auth.client';

describe('KaypalAuthClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

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
});
