import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './core/auth';
import { KaypalOctopBridge } from './kaypal-octop-bridge';

/**
 * P0-2 Kaypal 正式鉴权测试：
 * - 真实 kaypal.cn access_token（__REDACTED_TEST_USER__ 登录）→ AuthService.verify 派生租户身份
 * - 伪造 token → AUTH_INVALID
 * - HMAC 令牌向后兼容
 * 无 KAYPAL 测试凭据环境自适应跳过。
 */
describe('Kaypal 正式 JWT 鉴权（P0-2）', () => {
  const envTxt = readFileSync(join(process.cwd(), '.env'), 'utf8');
  const get = (k: string): string | undefined =>
    envTxt.split('\n').find((l) => l.startsWith(`${k}=`))?.split('=').slice(1).join('=').trim();
  const apiKey = get('KAYPAL_API_KEY') || process.env.KAYPAL_API_KEY;
  const phone = process.env.KAYPAL_TEST_PHONE;
  const pwd = process.env.KAYPAL_TEST_PASSWORD;
  const hasCreds = !!(phone && pwd && apiKey);
  const kaypalCfg = { baseUrl: 'https://kaypal.cn', apiKey: apiKey ?? 'x' };

  it('HMAC 令牌仍兼容（向后兼容）', async () => {
    const auth = new AuthService('secret');
    const t = auth.issue({ tenantId: 't1', userId: 'u1', agentId: 'a1' });
    const ctx = await auth.verify(t);
    expect(ctx.tenantId).toBe('t1');
  });

  it('伪造 Kaypal token → AUTH_INVALID', async () => {
    const auth = new AuthService('hmac-secret', kaypalCfg);
    await expect(auth.verify('eyJhbGciOiJIUzI1NiJ9.fake.signature')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
  });

  it('Kaypal 正式 access_token → verify 派生租户身份', async () => {
    if (!hasCreds) return;
    const bridge = new KaypalOctopBridge(
      new ConfigService({ KAYPAL_API_KEY: apiKey, KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn' }),
    );
    const { accessToken } = await bridge.loginKaypal(phone!, pwd!);
    const auth = new AuthService('hmac-secret', kaypalCfg);
    const ctx = await auth.verify(accessToken);
    expect(ctx.tenantId).toBeTruthy();
    expect(ctx.userId).toBeTruthy();
  });
});
