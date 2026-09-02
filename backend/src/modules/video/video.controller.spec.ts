import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

/**
 * 2026-09-01（复核第六轮 P2）：认证上下文失败必须 401 的回归测试。
 */
describe('VideoController resolveUserId（复核第六轮）', () => {
  function makeController(ctx: unknown) {
    return new VideoController(
      {} as never,
      {} as never,
      { get: () => ctx } as never,
      {} as never,
    ) as unknown as { resolveUserId(): string };
  }

  it('认证上下文读取异常 → 抛 401（不返回 undefined）', () => {
    const broken = new VideoController(
      {} as never,
      {} as never,
      {
        get: () => {
          throw new Error('context broken');
        },
      } as never,
      {} as never,
    ) as unknown as { resolveUserId(): string };
    expect(() => broken.resolveUserId()).toThrow(UnauthorizedException);
  });

  it('无用户上下文 → 抛 401', () => {
    expect(() => makeController(undefined).resolveUserId()).toThrow(
      UnauthorizedException,
    );
    expect(() => makeController({ user: {} }).resolveUserId()).toThrow(
      UnauthorizedException,
    );
    expect(() => makeController({ user: { id: '   ' } }).resolveUserId()).toThrow(
      UnauthorizedException,
    );
  });

  it('正常认证上下文 → 返回用户 id', () => {
    expect(makeController({ user: { id: 'user-1' } }).resolveUserId()).toBe(
      'user-1',
    );
  });
});

/**
 * 2026-09-02（复核第七轮 P1）：migrate-owner 真实控制器集成测试——
 * 直接调 controller.migrateProjectOwner，验证管理员判定已接入控制器
 * （旧 bug：controller 内联 role !== 'admin' && role !== 'SUPER_ADMIN'
 * 会拒绝 super_admin / kaypalRole 超管，service helper 测试全绿是假绿）。
 */
describe('VideoController migrateProjectOwner（复核第七轮）', () => {
  function makeController(user: unknown) {
    const prisma = { migrateStudioProjectOwner: jest.fn().mockResolvedValue(undefined) };
    // 真实 VideoService（判定逻辑必须走真实现，否则测的是复制品=假绿）
    const service = new VideoService(
      {} as never,
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
    );
    return {
      controller: new VideoController(
        service as never,
        {} as never,
        { get: () => ({ user }) } as never,
        prisma as never,
      ),
      prisma,
    };
  }

  it.each([
    ['本地 admin', { role: 'admin' }],
    ['本地 super_admin（小写）', { role: 'super_admin' }],
    ['kaypalRole SUPER_ADMIN', { role: 'operator', kaypalRole: 'SUPER_ADMIN' }],
    [
      'kaypalPlatformRole SUPER_ADMIN',
      { role: 'operator', kaypalPlatformRole: 'SUPER_ADMIN' },
    ],
  ])('%s 可迁移', async (_label, user) => {
    const { controller, prisma } = makeController(user);
    const result = await controller.migrateProjectOwner('proj-1', {
      userId: 'user-x',
    });
    expect(result.success).toBe(true);
    expect(prisma.migrateStudioProjectOwner).toHaveBeenCalledWith(
      'proj-1',
      'user-x',
    );
  });

  it('普通用户拒绝（403）', async () => {
    const { controller, prisma } = makeController({ role: 'operator' });
    await expect(
      controller.migrateProjectOwner('proj-1', { userId: 'user-x' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.migrateStudioProjectOwner).not.toHaveBeenCalled();
  });
});
