import {
  KaypalHostNotAllowedError,
  KaypalProviderResolver,
} from './kaypal-provider.resolver';

/**
 * Stage 1A 回归：网关单点化的 host 白名单必须无法绕过。
 *
 * @allow-direct-provider-fixtures
 * 本文件按设计包含厂商直连域名（api.openai.com / dashscope.aliyuncs.com 等），
 * 它们只作为「必须被拒绝的输入样本」出现——这是验证"禁直连"规则的唯一方式。
 * check-no-direct-provider 门禁按此标记放行本文件的域名字面量，但仍然会拦住
 * 任何真的把域名接成客户端的写法（new OpenAI( / baseURL: / axios.create( 等）。
 *
 * 修复前 ai-client.service.ts 用的是子串匹配 + 平台名/source 放行：
 *   baseUrl.includes('kaypal.cn') || platform.name.includes('Kaypal')
 *     || config.source === 'kaypal'
 * 三个口子都能让请求打到任意第三方域名（凭据外泄 / 绕过 kaypal 计费）。
 * 这里把每个口子都写成断言，防止回退。
 */
describe('KaypalProviderResolver host 白名单', () => {
  describe('合法：kaypal.cn 根域及其子域（生产在用的都要放行）', () => {
    const allowed = [
      'https://kaypal.cn',
      'https://kaypal.cn/api/ai',
      'https://test.kaypal.cn',
      'https://enterprise.kaypal.cn',
      'https://cases.kaypal.cn',
      'https://aicontent.vip.kaypal.cn',
      'https://kaypal.cn:8443/api/ai',
      'HTTPS://KAYPAL.CN/api/ai',
    ];
    it.each(allowed)('放行 %s', (url) => {
      expect(() => KaypalProviderResolver.assertAllowedUrl(url)).not.toThrow();
    });
  });

  describe('拒绝：子串匹配绕过（修复前会被放行）', () => {
    const bypasses = [
      // ① 后缀伪装：host 是 kaypal.cn.evil.com，但 includes('kaypal.cn') 为 true
      'https://kaypal.cn.evil.com/v1',
      // ② 查询串伪装：host 是 evil.com，但 includes('kaypal.cn') 为 true
      'https://evil.com/v1?x=kaypal.cn',
      // ③ 路径伪装
      'https://evil.com/kaypal.cn/v1',
      // ④ 用户名伪装：URL.host 是 evil.com
      'https://kaypal.cn@evil.com/v1',
      // ⑤ 前缀伪装
      'https://notkaypal.cn/v1',
      // ⑥ 换 TLD（生产不使用 kaypal.com）
      'https://kaypal.com/v1',
    ];
    it.each(bypasses)('拒绝 %s', (url) => {
      expect(() => KaypalProviderResolver.assertAllowedUrl(url)).toThrow(
        KaypalHostNotAllowedError,
      );
    });
  });

  describe('拒绝：第三方厂商直连域名', () => {
    const vendors = [
      'https://api.deepseek.com/v1',
      'https://api.openai.com/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://api.moonshot.cn/v1',
    ];
    it.each(vendors)('拒绝 %s', (url) => {
      expect(() => KaypalProviderResolver.assertAllowedUrl(url)).toThrow(
        KaypalHostNotAllowedError,
      );
    });
  });

  describe('拒绝：空值与非 URL', () => {
    const invalid = ['', '   ', 'kaypal.cn', 'not a url', '/api/ai'];
    it.each(invalid)('拒绝 %p', (url) => {
      expect(() => KaypalProviderResolver.assertAllowedUrl(url)).toThrow(
        KaypalHostNotAllowedError,
      );
    });
  });

  it('规范化：去掉尾部斜杠后返回', () => {
    expect(KaypalProviderResolver.assertAllowedUrl('https://kaypal.cn/api/ai//')).toBe(
      'https://kaypal.cn/api/ai',
    );
  });

  describe('逃生阀 KAYPAL_EXTRA_ALLOWED_HOSTS', () => {
    it('默认不放行本地回环', () => {
      expect(KaypalProviderResolver.isAllowedHost('127.0.0.1', '')).toBe(false);
    });

    it('显式配置后放行（私有化部署 / 本地网关代理）', () => {
      expect(
        KaypalProviderResolver.isAllowedHost('127.0.0.1', '127.0.0.1,localhost'),
      ).toBe(true);
      expect(() =>
        KaypalProviderResolver.assertAllowedUrl(
          'http://127.0.0.1:15441/v1',
          '127.0.0.1',
        ),
      ).not.toThrow();
    });

    it('逃生阀不影响其它域名', () => {
      expect(
        KaypalProviderResolver.isAllowedHost('api.deepseek.com', '127.0.0.1'),
      ).toBe(false);
    });
  });

  it('错误信息包含实际 host，便于定位配置错误', () => {
    try {
      KaypalProviderResolver.assertAllowedUrl('https://kaypal.cn.evil.com/v1');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KaypalHostNotAllowedError);
      expect((error as KaypalHostNotAllowedError).host).toBe('kaypal.cn.evil.com');
      expect((error as Error).message).toContain('kaypal.cn.evil.com');
    }
  });
});
