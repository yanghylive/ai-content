import { RedfoxInterfaceCatalogService } from './redfox-interface-catalog.service';

function makePrisma() {
  const interfaces: any[] = [];
  return {
    redfoxInterface: {
      findMany: jest.fn(async () => interfaces),
      count: jest.fn(async () => interfaces.length),
      findUnique: jest.fn(
        async ({ where }: any) =>
          interfaces.find((item) => item.code === where.code) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `interface-${interfaces.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        interfaces.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = interfaces.findIndex((item) => item.id === where.id);
        interfaces[index] = {
          ...interfaces[index],
          ...data,
          updatedAt: new Date(),
        };
        return interfaces[index];
      }),
    },
  };
}

describe('RedfoxInterfaceCatalogService', () => {
  it('syncs official platform interfaces and infers scenarios', async () => {
    const catalog = new RedfoxInterfaceCatalogService(makePrisma() as any);
    const platformPayload = {
      data: [
        {
          platformCode: 'douyin',
          platformName: '抖音',
          status: 'online',
        },
      ],
    };

    const result = await catalog.syncFromRemote(platformPayload, [
      {
        platform: catalog.extractPlatforms(platformPayload)[0],
        payload: {
          data: [
            {
              interfaceNo: 'P5CHB3BZ',
              platformCode: 'douyin',
              platformName: '抖音',
              interfaceName: '搜索关键词获取抖音账号 (优质库)',
              path: '/story/api/dyData/searchUser',
              httpMethod: 'POST',
              status: 1,
              price: 0.4,
              minPrice: 0.02,
              requireAuth: true,
            },
          ],
        },
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        received: 1,
        created: 1,
        updated: 0,
        total: 1,
      }),
    );

    const items = (
      await catalog.list({ page: 1, limit: 10, scenario: 'search_user' })
    ).items;
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: 'P5CHB3BZ',
        platformCode: 'douyin',
        path: '/story/api/dyData/searchUser',
        method: 'POST',
        scenario: 'search_user',
        price: 0.4,
      }),
    );
  });

  it('keeps official endpoint scenarios distinct when names mention content', async () => {
    const catalog = new RedfoxInterfaceCatalogService(makePrisma() as any);
    const platformPayload = {
      data: [
        {
          platformCode: 'bilibili',
          platformName: '哔哩哔哩',
          status: 'online',
        },
      ],
    };
    const platform = catalog.extractPlatforms(platformPayload)[0];

    await catalog.syncFromRemote(platformPayload, [
      {
        platform,
        payload: {
          data: [
            {
              interfaceNo: 'BILI_WORK_DETAIL',
              interfaceName: '获取哔哩哔哩作品内容详情 (优质库)',
              path: '/story/api/bili/data/workDetail',
              status: 1,
            },
            {
              interfaceNo: 'BILI_ACCOUNT_DETAIL',
              interfaceName: '获取哔哩哔哩账号信息 (优质库)',
              path: '/story/api/bili/data/accountDetail',
              status: 1,
            },
          ],
        },
      },
    ]);

    const items = (await catalog.list({ page: 1, limit: 10 })).items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/story/api/bili/data/workDetail',
          scenario: 'work_detail',
        }),
        expect.objectContaining({
          path: '/story/api/bili/data/accountDetail',
          scenario: 'account_detail',
        }),
      ]),
    );
  });

  it('infers media, AIGC, and TikTok official endpoint scenarios', async () => {
    const catalog = new RedfoxInterfaceCatalogService(makePrisma() as any);
    const platformPayload = {
      data: [
        {
          platformCode: 'tool',
          platformName: '工具',
          status: 'online',
        },
      ],
    };
    const platform = catalog.extractPlatforms(platformPayload)[0];

    await catalog.syncFromRemote(platformPayload, [
      {
        platform,
        payload: {
          data: [
            {
              interfaceNo: 'TK_SEARCH_USER',
              interfaceName: 'Tiktok关键词搜索账号',
              path: '/story/api/deepSearch/tk/searchUser',
              status: 1,
            },
            {
              interfaceNo: 'PARSE_WORK',
              interfaceName: '短视频下载器',
              path: '/story/api/parseWork/parse',
              status: 1,
            },
            {
              interfaceNo: 'SEEDREAM_SUBMIT',
              interfaceName: 'Seedream 5.0 lite 提交任务',
              path: '/story/api/parseWork/imageGen/arkSubmit',
              status: 1,
            },
            {
              interfaceNo: 'SEEDANCE_SUBMIT',
              interfaceName: 'seendance2.0视频生成 提交任务',
              path: '/story/api/parseWork/videoGen/submit',
              status: 1,
            },
          ],
        },
      },
    ]);

    const items = (await catalog.list({ page: 1, limit: 20 })).items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/story/api/deepSearch/tk/searchUser',
          scenario: 'search_user',
        }),
        expect.objectContaining({
          path: '/story/api/parseWork/parse',
          scenario: 'media_parse',
        }),
        expect.objectContaining({
          path: '/story/api/parseWork/imageGen/arkSubmit',
          scenario: 'image_generation_submit',
        }),
        expect.objectContaining({
          path: '/story/api/parseWork/videoGen/submit',
          scenario: 'video_generation_submit',
        }),
      ]),
    );
  });

  it('can sync with fallback platforms when the platform directory is unavailable', async () => {
    const catalog = new RedfoxInterfaceCatalogService(makePrisma() as any);
    const platform = catalog
      .fallbackPlatforms()
      .find((item) => item.platformCode === 'douyin');

    const result = await catalog.syncFromRemote(null, [
      {
        platform: platform!,
        payload: {
          data: [
            {
              interfaceNo: 'DY_SEARCH_USER',
              interfaceName: '搜索关键词获取抖音账号 (优质库)',
              path: '/story/api/dyData/searchUser',
              status: 1,
            },
          ],
        },
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        platforms: 1,
        received: 1,
        total: 1,
      }),
    );
  });

  it('treats RedFox homepage and doc endpoints as non-production monitor paths', () => {
    const catalog = new RedfoxInterfaceCatalogService(makePrisma() as any);

    expect(catalog.isBlockedMonitorPath('/story/web/api/home/hot')).toBe(true);
    expect(catalog.isBlockedMonitorPath('/story/web/api/doc/platforms')).toBe(
      true,
    );
    expect(catalog.isBlockedMonitorPath('/story/api/dyData/searchUser')).toBe(
      false,
    );
    expect(
      catalog.isBlockedMonitorPath('/story/api/parseWork/imageGen/arkSubmit'),
    ).toBe(false);
  });
});
