import { ConfigService } from '@nestjs/config';
import { KaypalOctopBridge } from './kaypal-octop-bridge';

describe('KaypalOctopBridge（kaypal.cn 用户 → Octop 代理桥）', () => {
  const cfg = new ConfigService({ KAYPAL_API_KEY: 'test-key', KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn' });

  afterEach(() => {
    delete process.env.OCTOP_SETUP_PASSWORD;
    delete process.env.OCTOP_ACCESS_TOKEN;
  });

  it('未配置 Octop 凭据 → loginOctop 抛错并提示配置', async () => {
    const b = new KaypalOctopBridge(cfg);
    await expect(b.loginOctop()).rejects.toThrow(/OCTOP_SETUP_PASSWORD/);
  });

  it('配置 OCTOP_ACCESS_TOKEN → 直接可用（免登录）', async () => {
    process.env.OCTOP_ACCESS_TOKEN = 'direct-token';
    const b = new KaypalOctopBridge(cfg);
    const r = await b.loginOctop();
    expect(r.token).toBe('direct-token');
  });

  it('未配置 KAYPAL_API_KEY → loginKaypal 抛错', async () => {
    const b = new KaypalOctopBridge(new ConfigService({}));
    await expect(b.loginKaypal('18230326666', 'x')).rejects.toThrow(/KAYPAL_API_KEY/);
  });

  it('端到端（可选）：env 提供 KAYPAL 测试账号 + Octop 凭据时实测', async () => {
    const phone = process.env.KAYPAL_TEST_PHONE;
    const pwd = process.env.KAYPAL_TEST_PASSWORD;
    const apiKey = process.env.KAYPAL_API_KEY;
    if (!phone || !pwd || !apiKey || !process.env.OCTOP_SETUP_PASSWORD) {
      return; // 无测试凭据环境自适应跳过
    }
    const b = new KaypalOctopBridge(
      new ConfigService({ KAYPAL_API_KEY: apiKey, KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn' }),
    );
    const r = await b.authenticate(phone, pwd);
    expect(r.kaypal.accessToken).toBeTruthy();
    expect(r.octop.token).toBeTruthy();
  });
});
