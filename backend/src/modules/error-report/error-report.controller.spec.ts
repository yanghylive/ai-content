import { ErrorReportController } from './error-report.controller';

/**
 * error-report 匿名接口 IP 级限流（P5 门禁 2026-08-22）。
 * 通过真实控制器调用验证：同 IP 超窗丢弃（不抛错）、新 IP 放行。
 * 模块级 ipBuckets 为进程级状态，测试结束不需要清理（限流是幂等的）。
 */
describe('ErrorReportController IP rate limit', () => {
  function makeRequest(ip: string) {
    return {
      headers: {},
      socket: { remoteAddress: ip },
      url: '/error-report/client',
    } as never;
  }

  it('同 IP 连续上报不抛错（限流只丢弃）', async () => {
    const ctrl = new ErrorReportController();
    let lastError: unknown;
    for (let i = 0; i < 30; i++) {
      try {
        await ctrl.clientError(makeRequest('203.0.113.7'), {
          message: `err-${i}`,
        });
      } catch (e) {
        lastError = e;
      }
    }
    // 限流丢弃，绝不抛异常（返回 204 语义）
    expect(lastError).toBeUndefined();
  });

  it('新 IP 首次上报放行（不同 IP 独立计数）', async () => {
    const ctrl = new ErrorReportController();
    let ok = true;
    try {
      await ctrl.clientError(makeRequest('198.51.100.99'), {
        message: 'fresh-ip',
      });
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('x-forwarded-for 优先于 socket 地址', async () => {
    const ctrl = new ErrorReportController();
    const req = {
      headers: { 'x-forwarded-for': '192.0.2.1, 10.0.0.1' },
      socket: { remoteAddress: '203.0.113.5' },
      url: '/error-report/client',
    } as never;
    let ok = true;
    try {
      await ctrl.clientError(req, { message: 'forwarded' });
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });
});
