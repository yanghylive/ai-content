import { UnauthorizedException } from '@nestjs/common';
import { VideoController } from './video.controller';

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
