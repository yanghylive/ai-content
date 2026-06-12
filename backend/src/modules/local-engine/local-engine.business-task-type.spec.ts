import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService business task type routing', () => {
  const service = Object.create(LocalEngineService.prototype) as any;

  it('routes generic comment tasks to wechat channel when platform type is video channel', () => {
    expect(
      service.resolveBusinessTaskType('comments', {
        platformType: 2,
        platformName: '视频号',
      }),
    ).toBe('wechat-channel-comment-reply');
  });

  it('routes generic message tasks to wechat channel when platform name is video channel', () => {
    expect(
      service.resolveBusinessTaskType('messages', {
        platformName: '视频号',
      }),
    ).toBe('wechat-channel-direct-message-reply');
  });

  it('keeps generic comment and message tasks on douyin by default', () => {
    expect(service.resolveBusinessTaskType('comments', {})).toBe(
      'douyin-comment-reply',
    );
    expect(service.resolveBusinessTaskType('messages', {})).toBe(
      'douyin-direct-message-reply',
    );
  });
});
