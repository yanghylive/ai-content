import {
  checkPlatformPreflight,
  normalizePublishTags,
  PlatformPreflightService,
} from './platform-preflight.service';

describe('normalizePublishTags', () => {
  it('strips #, dedupes, truncates to cap', () => {
    expect(
      normalizePublishTags(['#抖音', '抖音', '#小红书', '美食'], 3),
    ).toEqual(['抖音', '小红书', '美食']);
    expect(normalizePublishTags(['#a', '#a', '#b', '#c', '#d'], 3)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('handles empty input', () => {
    expect(normalizePublishTags(undefined, 5)).toEqual([]);
    expect(normalizePublishTags([], 5)).toEqual([]);
  });
});

describe('checkPlatformPreflight', () => {
  it('passes valid douyin content', () => {
    const result = checkPlatformPreflight({
      platform: 'douyin',
      title: '测试视频',
      content: '正文内容',
      tags: ['抖音', '美食'],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects douyin with too many tags', () => {
    const result = checkPlatformPreflight({
      platform: 'douyin',
      title: '测试',
      content: '正文',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('话题'))).toBe(true);
  });

  it('rejects over-length title', () => {
    const result = checkPlatformPreflight({
      platform: 'xiaohongshu',
      title: '超长标题'.repeat(10), // 40 chars > 20
      content: '正文',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('标题'))).toBe(true);
  });

  it('rejects wechat-channel content below 100 chars', () => {
    const result = checkPlatformPreflight({
      platform: 'wechat-channel',
      title: '标题',
      content: '太短',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('100'))).toBe(true);
  });

  it('rejects forbidden words', () => {
    const result = checkPlatformPreflight({
      platform: 'douyin',
      title: '加我微信',
      content: '正文',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('敏感词'))).toBe(true);
  });

  it('ignores tags for platforms without tag support', () => {
    const result = checkPlatformPreflight({
      platform: 'wechat-channel',
      title: '标题',
      content: '正文'.repeat(60),
      tags: ['话题'],
    });
    expect(result.valid).toBe(true);
    expect(result.suggestions.some((s) => s.includes('不支持话题'))).toBe(true);
  });

  it('treats unknown platform as valid', () => {
    const result = checkPlatformPreflight({
      platform: 'unknown-platform',
      title: '',
      content: '',
    });
    expect(result.valid).toBe(true);
  });
});

describe('PlatformPreflightService', () => {
  it('delegates to checkPlatformPreflight', () => {
    const service = new PlatformPreflightService();
    const result = service.check({
      platform: 'kuaishou',
      title: '标题',
      content: '正文',
    });
    expect(result.platform).toBe('kuaishou');
    expect(result.platformName).toBe('快手');
  });
});
