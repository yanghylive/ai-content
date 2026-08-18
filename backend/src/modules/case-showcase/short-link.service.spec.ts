import {
  isLoopbackOrPrivateHost,
  isSafeRedirectTarget,
  ShortLinkService,
  SHORT_CODE_DEFAULT_LENGTH,
  SHORT_LINK_REDIRECT_STATUS,
} from './short-link.service';

describe('short-link.service（短链跳转 + 防开放重定向）', () => {
  let service: ShortLinkService;
  let prisma: {
    showcaseShortLink: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      showcaseShortLink: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new ShortLinkService(prisma as never);
  });

  describe('isSafeRedirectTarget / isLoopbackOrPrivateHost（开放重定向 + SSRF 兜底）', () => {
    it.each([
      'https://www.jiuzhang.com/demo',
      'http://example.com/path?x=1',
      'https://sub.domain.example.cn/a/b',
    ])('放行合法 http/https 公网地址：%s', (url) => {
      expect(isSafeRedirectTarget(url)).toBe(true);
    });

    it.each([
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com/file',
      'file:///etc/passwd',
      '//evil.com/path',
      'not-a-url',
      '',
      'http://',
      'https://localhost/admin',
      'http://127.0.0.1:3000/internal',
      'http://10.0.0.5/private',
      'http://172.16.3.4/private',
      'http://192.168.1.1/private',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/cgnat',
      'http://[::1]/loopback',
      'http://[fe80::1]/link-local',
      'http://[fd00::1]/ula',
      'http://[::ffff:127.0.0.1]/mapped-loopback',
    ])('拒绝非 http/https 或回环/私网目标：%s', (url) => {
      expect(isSafeRedirectTarget(url)).toBe(false);
    });

    it('域名包含 localhost 字样但非本机回环时放行', () => {
      // localhost.evil.com 是公网域名，不应被私网规则误伤
      expect(isSafeRedirectTarget('https://localhost.evil.com')).toBe(true);
    });

    it('isLoopbackOrPrivateHost 正确识别回环/私网主机', () => {
      expect(isLoopbackOrPrivateHost('localhost')).toBe(true);
      expect(isLoopbackOrPrivateHost('api.localhost')).toBe(true);
      expect(isLoopbackOrPrivateHost('127.0.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('10.0.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('172.31.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('192.168.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('169.254.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('::1')).toBe(true);
      expect(isLoopbackOrPrivateHost('::ffff:10.0.0.1')).toBe(true);
      expect(isLoopbackOrPrivateHost('example.com')).toBe(false);
      expect(isLoopbackOrPrivateHost('8.8.8.8')).toBe(false);
    });
  });

  describe('resolveShortLink', () => {
    it('不存在的短码返回 not_found', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue(null);
      await expect(service.resolveShortLink('unknown')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'not_found',
      });
    });

    it('空短码返回 not_found 且不查库', async () => {
      await expect(service.resolveShortLink('  ')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'not_found',
      });
      expect(prisma.showcaseShortLink.findUnique).not.toHaveBeenCalled();
    });

    it('停用短链返回 disabled', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue({
        id: 'sl-1',
        status: 'disabled',
        validUntil: null,
        targetUrl: 'https://example.com',
      });
      await expect(service.resolveShortLink('abc123')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'disabled',
      });
    });

    it('过期短链返回 expired', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue({
        id: 'sl-1',
        status: 'active',
        validUntil: new Date(Date.now() - 1000),
        targetUrl: 'https://example.com',
      });
      await expect(service.resolveShortLink('abc123')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'expired',
      });
    });

    it('目标为空或非法时返回 invalid_target，绝不跳转', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue({
        id: 'sl-1',
        status: 'active',
        validUntil: null,
        targetUrl: 'javascript:alert(1)',
      });
      await expect(service.resolveShortLink('abc123')).resolves.toEqual({
        kind: 'unavailable',
        reason: 'invalid_target',
      });
      expect(prisma.showcaseShortLink.update).not.toHaveBeenCalled();
    });

    it('合法短链返回 302 跳转目标并原子自增 openCount + lastOpenAt', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue({
        id: 'sl-1',
        status: 'active',
        validUntil: null,
        targetUrl: 'https://www.jiuzhang.com/demo',
      });
      prisma.showcaseShortLink.update.mockResolvedValue({});

      await expect(service.resolveShortLink('abc123')).resolves.toEqual({
        kind: 'redirect',
        url: 'https://www.jiuzhang.com/demo',
        statusCode: SHORT_LINK_REDIRECT_STATUS,
      });

      expect(prisma.showcaseShortLink.update).toHaveBeenCalledWith({
        where: { id: 'sl-1' },
        data: {
          openCount: { increment: 1 },
          lastOpenAt: expect.any(Date),
        },
      });
    });

    it('openCount 自增失败不影响合法跳转（容错）', async () => {
      prisma.showcaseShortLink.findUnique.mockResolvedValue({
        id: 'sl-1',
        status: 'active',
        validUntil: null,
        targetUrl: 'https://www.jiuzhang.com/demo',
      });
      prisma.showcaseShortLink.update.mockRejectedValue(
        new Error('db unavailable'),
      );

      await expect(service.resolveShortLink('abc123')).resolves.toEqual({
        kind: 'redirect',
        url: 'https://www.jiuzhang.com/demo',
        statusCode: SHORT_LINK_REDIRECT_STATUS,
      });
    });
  });

  describe('generateShortCode（随机短码不可顺序猜测）', () => {
    it('默认长度 8，字符集为 URL 安全 base64url', () => {
      const code = service.generateShortCode();
      expect(code).toHaveLength(SHORT_CODE_DEFAULT_LENGTH);
      expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/);
    });

    it('多次生成不重复且无顺序可猜规律', () => {
      const codes = new Set(
        Array.from({ length: 200 }, () => service.generateShortCode()),
      );
      expect(codes.size).toBe(200);
    });

    it('支持自定义长度并钳制到 4..16', () => {
      expect(service.generateShortCode(10)).toHaveLength(10);
      expect(service.generateShortCode(2)).toHaveLength(4);
      expect(service.generateShortCode(999)).toHaveLength(16);
    });
  });
});
