import { PlatformAdapterRegistry } from './platform-adapter.registry';
import type {
  PlatformAdapter,
  PlatformCapability,
} from './platform-adapter.interface';

function makeCapability(
  overrides: Partial<PlatformCapability> = {},
): PlatformCapability {
  return {
    platform: 'douyin',
    displayName: '抖音',
    contentKinds: ['video'],
    executionModes: ['browser-session'],
    supportsSchedule: true,
    supportsDraft: false,
    supportsCover: true,
    supportsReadback: true,
    supportsAccountDetection: true,
    riskLevel: 'high',
    adapterVersion: '1',
    ...overrides,
  } as PlatformCapability;
}

function makeAdapter(platform = 'douyin'): PlatformAdapter {
  return { capability: makeCapability({ platform }) };
}

describe('PlatformAdapterRegistry（平台适配器注册表）', () => {
  it('register + has + get + listPlatforms', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(makeAdapter('douyin'));
    expect(registry.has('douyin')).toBe(true);
    expect(registry.get('douyin').capability.platform).toBe('douyin');
    expect(registry.listPlatforms()).toEqual(['douyin']);
  });

  it('register：platform 为空 → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    expect(() => registry.register(makeAdapter(''))).toThrow(
      'PlatformAdapter.capability.platform 不能为空',
    );
  });

  it('register：重复注册同平台 → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(makeAdapter('douyin'));
    expect(() => registry.register(makeAdapter('douyin'))).toThrow(
      '平台 adapter 重复注册: douyin',
    );
  });

  it('get：未注册平台 → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    expect(() => registry.get('weibo')).toThrow('未注册的平台 adapter: weibo');
  });

  it('registerPublishFactory：未注册 adapter → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    expect(() =>
      registry.registerPublishFactory('douyin', () => makeAdapter('douyin')),
    ).toThrow('publish factory 缺少对应平台 adapter: douyin');
  });

  it('registerPublishFactory + getPublishAdapterFactory：正常返回平台匹配的 adapter', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(makeAdapter('douyin'));
    registry.registerPublishFactory('douyin', () => makeAdapter('douyin'));
    expect(registry.hasPublishFactory('douyin')).toBe(true);
    const factory = registry.getPublishAdapterFactory('douyin');
    const adapter = factory({});
    expect(adapter.capability.platform).toBe('douyin');
  });

  it('getPublishAdapterFactory：工厂返回平台不匹配 → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(makeAdapter('douyin'));
    registry.registerPublishFactory('douyin', () => makeAdapter('weibo'));
    const factory = registry.getPublishAdapterFactory('douyin');
    expect(() => factory({})).toThrow(
      'publish factory 返回平台不匹配: 期望 douyin，实际 weibo',
    );
  });

  it('getPublishAdapterFactory：未注册 → 抛错', () => {
    const registry = new PlatformAdapterRegistry();
    expect(() => registry.getPublishAdapterFactory('douyin')).toThrow(
      '未注册的 publish adapter factory: douyin',
    );
  });

  it('listCapabilities：返回拷贝（不泄漏内部引用）', () => {
    const registry = new PlatformAdapterRegistry();
    registry.register(makeAdapter('douyin'));
    const caps = registry.listCapabilities();
    expect(caps).toHaveLength(1);
    expect(caps[0].platform).toBe('douyin');
    // 修改返回的 contentKinds 不影响内部
    caps[0].contentKinds.push('image' as never);
    expect(registry.get('douyin').capability.contentKinds).toEqual(['video']);
  });
});
