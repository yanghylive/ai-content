import { Test } from '@nestjs/testing';
import { BilibiliPublishAdapter } from '../runtime/platforms/publishing/bilibili-publish.adapter';
import { DouyinPublishAdapter } from '../runtime/platforms/publishing/douyin-publish.adapter';
import { KuaishouPublishAdapter } from '../runtime/platforms/publishing/kuaishou-publish.adapter';
import { WechatChannelPublishAdapter } from '../runtime/platforms/publishing/wechat-channel-publish.adapter';
import { XiaohongshuPublishAdapter } from '../runtime/platforms/publishing/xiaohongshu-publish.adapter';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { PlatformRegistryModule } from './platform-registry.module';

/**
 * 单一真相源：5 个内置发布 adapter。模块装配与 spec 都从这里取。
 * 这里只用 capability 不调业务方法，Xiaohongshu/Douyin 传空 deps 即可。
 */
const BUILTIN_PLATFORM_ADAPTERS = [
  new XiaohongshuPublishAdapter({
    cleanTags: (t) => t,
    fillFirstEditable: () => Promise.resolve(),
    waitGenericVideoUploaded: () => Promise.resolve(),
  }),
  new WechatChannelPublishAdapter(),
  new DouyinPublishAdapter({
    gotoBestEffort: () => Promise.resolve(),
    waitGenericPublishButton: () => Promise.resolve({ click: () => Promise.resolve() }),
  }),
  new KuaishouPublishAdapter(),
  new BilibiliPublishAdapter(),
];

describe('PlatformAdapterRegistry', () => {
  const buildRegistry = () => {
    const registry = new PlatformAdapterRegistry();
    for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
      registry.register(adapter);
    }
    return registry;
  };

  it('wires all five real factories through PlatformRegistryModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformRegistryModule],
    }).compile();
    const registry = moduleRef.get(PlatformAdapterRegistry);

    expect(registry.listPlatforms()).toEqual([
      'xiaohongshu',
      'wechat-channel',
      'douyin',
      'kuaishou',
      'bilibili',
    ]);
    for (const platform of registry.listPlatforms()) {
      expect(registry.hasPublishFactory(platform)).toBe(true);
    }
    expect(
      registry.getPublishAdapterFactory('xiaohongshu')({
        cleanTags: (tags: string[]) => tags,
        fillFirstEditable: () => Promise.resolve(),
        waitGenericVideoUploaded: () => Promise.resolve(),
      }),
    ).toBeInstanceOf(XiaohongshuPublishAdapter);
    expect(
      registry.getPublishAdapterFactory('douyin')({
        gotoBestEffort: () => Promise.resolve(),
        waitGenericPublishButton: () =>
          Promise.resolve({ click: () => Promise.resolve() }),
      }),
    ).toBeInstanceOf(DouyinPublishAdapter);

    await moduleRef.close();
  });

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
    expect(first[0].executionModes).not.toBe(second[0].executionModes);
    first[0].contentKinds.push('video');
    first[0].executionModes.push('playwright');
    expect(registry.getCapability('xiaohongshu')?.contentKinds).toEqual([
      'article',
      'video',
    ]);
    expect(registry.getCapability('xiaohongshu')?.executionModes).toEqual([
      'cdp',
    ]);
  });

  it('rejects duplicate and invalid registration', () => {
    const registry = buildRegistry();
    const firstCapability = BUILTIN_PLATFORM_ADAPTERS[0].capability;
    expect(() =>
      registry.register({
        capability: { ...firstCapability },
      }),
    ).toThrow(/重复注册/);
    expect(() =>
      registry.register({
        capability: {
          ...firstCapability,
          platform: '',
        },
      }),
    ).toThrow(/不能为空/);
  });

  it('registers publish factories and creates fresh adapters with caller deps', () => {
    const registry = buildRegistry();
    const factory = jest.fn((deps: Record<string, unknown>) =>
      new DouyinPublishAdapter(deps as unknown as ConstructorParameters<typeof DouyinPublishAdapter>[0]),
    );
    registry.registerPublishFactory('douyin', factory);

    const firstDeps = {
      gotoBestEffort: jest.fn(),
      waitGenericPublishButton: jest.fn(),
    };
    const secondDeps = {
      gotoBestEffort: jest.fn(),
      waitGenericPublishButton: jest.fn(),
    };
    const create = registry.getPublishAdapterFactory('douyin');
    const first = create(firstDeps);
    const second = create(secondDeps);

    expect(registry.hasPublishFactory('douyin')).toBe(true);
    expect(registry.hasPublishFactory('unknown')).toBe(false);
    expect(factory).toHaveBeenNthCalledWith(1, firstDeps);
    expect(factory).toHaveBeenNthCalledWith(2, secondDeps);
    expect(first).toBeInstanceOf(DouyinPublishAdapter);
    expect(second).toBeInstanceOf(DouyinPublishAdapter);
    expect(first).not.toBe(second);
  });

  it('rejects invalid, duplicate, missing and mismatched publish factories', () => {
    const registry = buildRegistry();
    const factory = () => new BilibiliPublishAdapter();
    registry.registerPublishFactory('bilibili', factory);

    expect(() => registry.registerPublishFactory('bilibili', factory)).toThrow(
      /重复注册/,
    );
    expect(() => registry.registerPublishFactory('', factory)).toThrow(
      /不能为空/,
    );
    expect(() => registry.registerPublishFactory('unknown', factory)).toThrow(
      /缺少对应平台/,
    );
    expect(() => registry.getPublishAdapterFactory('unknown')).toThrow(
      /未注册/,
    );

    registry.registerPublishFactory(
      'kuaishou',
      () => new BilibiliPublishAdapter(),
    );
    expect(() => registry.getPublishAdapterFactory('kuaishou')({})).toThrow(
      /返回平台不匹配/,
    );
  });

  it('throws when getting an unregistered platform', () => {
    const registry = buildRegistry();
    expect(() => registry.get('unknown')).toThrow(/未注册/);
    expect(registry.getCapability('unknown')).toBeUndefined();
  });
});