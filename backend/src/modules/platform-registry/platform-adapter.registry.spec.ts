import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { BUILTIN_PLATFORM_ADAPTERS } from './platform-adapters';

describe('PlatformAdapterRegistry', () => {
  const buildRegistry = () => {
    const registry = new PlatformAdapterRegistry();
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      registry.register(adapter);
    }
    return registry;
  };

  it('registers the five builtin platforms in stable order', () => {
    const registry = buildRegistry();
    expect(registry.listPlatforms()).toEqual([
      'xiaohongshu',
      'wechat-channel',
      'douyin',
      'kuaishou',
      'bilibili',
    ]);
    expect(registry.has('douyin')).toBe(true);
    expect(registry.has('unknown')).toBe(false);
  });

  it('returns capability snapshots that mirror the read-only contract', () => {
    const registry = buildRegistry();
    const capabilities = registry.listCapabilities();
    expect(capabilities.map((item) => item.platform)).toEqual([
      'xiaohongshu',
      'wechat-channel',
      'douyin',
      'kuaishou',
      'bilibili',
    ]);
    expect(capabilities.every((item) => item.riskLevel === 'high')).toBe(true);
    expect(
      capabilities.every(
        (item) =>
          !item.supportsSchedule &&
          !item.supportsCover &&
          !item.supportsReadback &&
          !item.supportsDraft,
      ),
    ).toBe(true);
    const bilibili = registry.getCapability('bilibili');
    expect(bilibili?.contentKinds).toEqual(['video']);
    const douyin = registry.getCapability('douyin');
    expect(douyin?.contentKinds).toEqual(['article', 'video']);
  });

  it('returns defensive copies so callers cannot mutate registered state', () => {
    const registry = buildRegistry();
    const first = registry.listCapabilities();
    const second = registry.listCapabilities();
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].contentKinds).not.toBe(second[0].contentKinds);
    first[0].contentKinds.push('video');
    expect(registry.getCapability('xiaohongshu')?.contentKinds).toEqual([
      'article',
      'video',
    ]);
  });

  it('rejects duplicate and invalid registration', () => {
    const registry = buildRegistry();
    expect(() =>
      registry.register({
        capability: { ...BUILTIN_PLATFORM_ADAPTERS[0].capability },
      }),
    ).toThrow(/重复注册/);
    expect(() =>
      registry.register({
        capability: {
          ...BUILTIN_PLATFORM_ADAPTERS[0].capability,
          platform: '',
        },
      }),
    ).toThrow(/不能为空/);
  });

  it('throws when getting an unregistered platform', () => {
    const registry = buildRegistry();
    expect(() => registry.get('unknown')).toThrow(/未注册/);
    expect(registry.getCapability('unknown')).toBeUndefined();
  });
});
