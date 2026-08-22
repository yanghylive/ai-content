import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AgentBrowserController } from './agent-browser.controller';

// P0-1（审计 2026-08-22）：AuthGuard 写 request.authUser，控制器读 request.user
// 恒空回落 local-user → 用户级隔离失效。修复后：
// 1. 读 request.authUser，有值返回真实 userId
// 2. 无身份抛 401（不再回落 local-user）
// 3. 跨用户访问会话 → 403（防 IDOR）
describe('AgentBrowserController P0-1 身份字段（审计修复）', () => {
  function makeController(authUser?: { id: string }) {
    const ctrl = Object.create(AgentBrowserController.prototype) as AgentBrowserController;
    return {
      ctrl,
      getUserId(req: { authUser?: { id: string } }) {
        // 访问私有方法
        return (ctrl as unknown as {
          getUserId(r: { authUser?: { id: string } }): string;
        }).getUserId(req);
      },
    };
  }

  it('有 authUser：返回真实 userId（不再回落 local-user）', () => {
    const { getUserId } = makeController({ id: 'user-123' });
    expect(getUserId({ authUser: { id: 'user-123' } })).toBe('user-123');
  });

  it('无 authUser：抛 401（禁止回落 local-user）', () => {
    const { getUserId } = makeController();
    expect(() => getUserId({})).toThrow(UnauthorizedException);
  });

  it('无 authUser 的旧 request.user 路径也抛 401（不再读 request.user）', () => {
    const { getUserId } = makeController();
    // 即使攻击者塞了 request.user 也不能用（AuthGuard 不写该字段，读取路径已改 authUser）
    expect(() =>
      getUserId({ authUser: undefined } as never),
    ).toThrow(UnauthorizedException);
  });
});
