import { ServiceUnavailableException } from '@nestjs/common';
import { KaypalProfileController } from './kaypal-profile.controller';

describe('KaypalProfileController', () => {
  const buildStoredZip = (entries: Record<string, string>) => {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const [name, content] of Object.entries(entries)) {
      const nameBuffer = Buffer.from(name, 'utf8');
      const data = Buffer.from(content, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt32LE(0, 10);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuffer.length, 26);
      local.writeUInt16LE(0, 28);
      localParts.push(local, nameBuffer, data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt32LE(0, 12);
      central.writeUInt32LE(0, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(nameBuffer.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, nameBuffer);

      offset += local.length + nameBuffer.length + data.length;
    }

    const centralStart = offset;
    const central = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Object.keys(entries).length, 8);
    eocd.writeUInt16LE(Object.keys(entries).length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, central, eocd]);
  };

  const createController = (options?: { localOnly?: boolean }) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          kaypalUserId: 'kaypal-user-1',
        }),
      },
      userSession: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      material: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const kaypalClient = {
      getCloudProfile: jest.fn(),
      getCloudSubscription: jest.fn(),
      getCloudBilling: jest.fn(),
      searchCloudKnowledge: jest.fn(),
      uploadCloudKnowledge: jest.fn(),
      refreshDesktopAuthToken: jest.fn(),
    };
    const controller = new KaypalProfileController(
      prisma as any,
      kaypalClient as any,
    );
    const req = {
      authSessionId: 'session-1',
      authUser: {
        id: 'user-1',
        username: 'acceptance78',
        email: 'acceptance78@example.com',
        name: '78项验收用户',
        kaypalUserId: 'kaypal-user-1',
        kaypalPlan: 'ADVANCED',
        kaypalPlanExpired: false,
        kaypalRole: 'SUPER_ADMIN',
        kaypalPermissionNames: ['workspace:role:owner'],
        kaypalDesktopAccessToken: 'access-token',
        kaypalDesktopRefreshToken: 'refresh-token',
        kaypalDesktopTokenExpiresAt: new Date(
          Date.now() + 60 * 60_000,
        ).toISOString(),
        kaypalDesktopDeviceId: 'device-1',
        kaypalLocalOnly: options?.localOnly === true,
      },
    };

    return { controller, kaypalClient, prisma, req };
  };

  it('uses local snapshots for local-only acceptance sessions without touching cloud tokens', async () => {
    const { controller, kaypalClient, req, prisma } = createController({
      localOnly: true,
    });

    await expect(controller.getProfile(req)).resolves.toEqual(
      expect.objectContaining({
        userId: 'kaypal-user-1',
        source: 'local-session-cache',
        message: '本地验收授权快照',
      }),
    );
    await expect(controller.getSubscription(req)).resolves.toEqual(
      expect.objectContaining({
        plan: 'ADVANCED',
        source: 'local-session-cache',
        message: '本地验收授权快照',
      }),
    );
    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: expect.objectContaining({
        plan: 'ADVANCED',
        source: 'local-session-cache',
        message: '本地验收授权快照',
      }),
      balance: expect.objectContaining({
        balance: null,
        source: 'kaypal-cloud-billing',
        message: '本地验收授权快照',
      }),
    });
    expect(kaypalClient.getCloudProfile).not.toHaveBeenCalled();
    expect(kaypalClient.getCloudSubscription).not.toHaveBeenCalled();
    expect(kaypalClient.getCloudBilling).not.toHaveBeenCalled();
    expect(kaypalClient.refreshDesktopAuthToken).not.toHaveBeenCalled();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('keeps local profile visible when Kaypal cloud profile is temporarily unavailable', async () => {
    const { controller, kaypalClient, req } = createController();
    kaypalClient.getCloudProfile.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 401'),
    );

    await expect(controller.getProfile(req)).resolves.toEqual(
      expect.objectContaining({
        userId: 'kaypal-user-1',
        displayName: '78项验收用户',
        subscriptionPlan: 'ADVANCED',
        unavailable: true,
        source: 'local-session-cache',
      }),
    );
  });

  it('keeps local profile visible when Kaypal cloud profile returns an empty user', async () => {
    const { controller, kaypalClient, req } = createController();
    kaypalClient.getCloudProfile.mockResolvedValue({
      userId: '',
      displayName: '',
      raw: { user: null },
    });

    await expect(controller.getProfile(req)).resolves.toEqual(
      expect.objectContaining({
        userId: 'kaypal-user-1',
        displayName: '78项验收用户',
        subscriptionPlan: 'ADVANCED',
        unavailable: true,
        source: 'local-session-cache',
      }),
    );
  });

  it('keeps local subscription active when Kaypal cloud subscription is temporarily unavailable', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    kaypalClient.getCloudSubscription.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 401'),
    );

    await expect(controller.getSubscription(req)).resolves.toEqual(
      expect.objectContaining({
        plan: 'ADVANCED',
        status: 'active',
        unavailable: true,
        source: 'local-session-cache',
      }),
    );
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('keeps local billing snapshot non-blocking when Kaypal cloud billing is temporarily unavailable', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    kaypalClient.getCloudBilling.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 401'),
    );

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: expect.objectContaining({
        plan: 'ADVANCED',
        status: 'active',
        unavailable: true,
        source: 'local-session-cache',
      }),
      balance: expect.objectContaining({
        balance: null,
        unavailable: true,
        source: 'kaypal-cloud-billing',
      }),
    });
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('caches a synced Kaypal credit balance from cloud billing', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    prisma.userSession.findUnique.mockResolvedValue({
      metadata: { kaypalSubscriptionPlan: 'ADVANCED' },
    });
    kaypalClient.getCloudBilling.mockResolvedValue({
      subscription: { plan: 'ADVANCED', status: 'active' },
      balance: {
        balance: 128.5,
        userId: 'kaypal-user-1',
      },
    });

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: { plan: 'ADVANCED', status: 'active' },
      balance: {
        balance: 128.5,
        userId: 'kaypal-user-1',
      },
    });
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: {
          metadata: expect.objectContaining({
            kaypalCreditBalance: 128.5,
            kaypalCreditBalanceUserId: 'kaypal-user-1',
            kaypalCreditBalanceSyncedAt: expect.any(String),
          }),
        },
      }),
    );
  });

  it('reads cloud billing by Kaypal user id when desktop token is unavailable', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    req.authUser.kaypalDesktopAccessToken = null;
    req.authUser.kaypalDesktopRefreshToken = null;
    req.authUser.kaypalDesktopDeviceId = null;
    prisma.userSession.findUnique.mockResolvedValue({
      metadata: { kaypalCreditBalance: 88 },
    });
    kaypalClient.getCloudBilling.mockResolvedValue({
      subscription: {
        unavailable: true,
        message: 'Kaypal 云端登录授权未同步',
      },
      balance: {
        balance: 57.01,
        userId: 'kaypal-user-1',
      },
    });

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: expect.objectContaining({
        plan: 'ADVANCED',
        status: 'active',
        unavailable: true,
        source: 'local-session-cache',
      }),
      balance: {
        balance: 57.01,
        userId: 'kaypal-user-1',
      },
    });
    expect(kaypalClient.getCloudBilling).toHaveBeenCalledWith('', {
      userId: 'kaypal-user-1',
    });
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: {
          metadata: expect.objectContaining({
            kaypalCreditBalance: 57.01,
            kaypalCreditBalanceUserId: 'kaypal-user-1',
            kaypalCreditBalanceSyncedAt: expect.any(String),
          }),
        },
      }),
    );
  });

  it('does not use subscription quota as balance fallback when cloud billing has no balance field', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    prisma.userSession.findUnique.mockResolvedValue({
      metadata: { kaypalSubscriptionPlan: 'ADVANCED' },
    });
    kaypalClient.getCloudBilling.mockResolvedValue({
      subscription: {
        plan: 'ADVANCED',
        status: 'active',
        raw: {
          subscription: {
            planInfo: {
              pointsPerMonth: 0,
              baseComputeQuota: 0,
            },
          },
        },
      },
      balance: {
        balance: null,
        userId: 'kaypal-user-1',
        unavailable: true,
        message: 'Kaypal 云端未返回真实积分余额',
        raw: { user: { id: 'kaypal-user-1' } },
      },
    });

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: {
        plan: 'ADVANCED',
        status: 'active',
        raw: {
          subscription: {
            planInfo: {
              pointsPerMonth: 0,
              baseComputeQuota: 0,
            },
          },
        },
      },
      balance: expect.objectContaining({
        balance: null,
        unavailable: true,
        message: 'Kaypal 云端未返回真实积分余额',
      }),
    });
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: {
          metadata: expect.objectContaining({
            kaypalSubscriptionPlan: 'ADVANCED',
          }),
        },
      }),
    );
  });

  it('does not expose cached Kaypal credit balance when cloud billing is unavailable', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    prisma.userSession.findUnique.mockResolvedValue({
      metadata: {
        kaypalCreditBalance: 88,
        kaypalCreditBalanceUserId: 'kaypal-user-1',
        kaypalCreditBalanceSyncedAt: '2026-06-27T10:00:00.000Z',
      },
    });
    kaypalClient.getCloudBilling.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 503'),
    );

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: expect.objectContaining({
        plan: 'ADVANCED',
        status: 'active',
        unavailable: true,
        source: 'local-session-cache',
      }),
      balance: expect.objectContaining({
        balance: null,
        unavailable: true,
        source: 'kaypal-cloud-billing',
      }),
    });
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('keeps cached plan in billing when only the Kaypal cloud subscription inside billing is unavailable', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    kaypalClient.getCloudBilling.mockResolvedValue({
      subscription: {
        unavailable: true,
        message: 'Kaypal 云端返回 401',
      },
      balance: {
        balance: null,
        unavailable: true,
        message: 'Kaypal 云端返回 401',
      },
    });

    await expect(controller.getBilling(req)).resolves.toEqual({
      subscription: expect.objectContaining({
        plan: 'ADVANCED',
        status: 'active',
        unavailable: true,
        source: 'local-session-cache',
      }),
      balance: expect.objectContaining({
        balance: null,
        unavailable: true,
      }),
    });
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('repairs legacy local knowledge names stored as latin1 mojibake', async () => {
    const { controller, prisma } = createController();
    const expectedName = '曹耕记潇湘小炒品牌手册(1).pdf';
    const mojibakeName = Buffer.from(expectedName, 'utf8').toString('latin1');
    const updatedAt = new Date('2026-06-20T18:19:00.000Z');
    prisma.material.findMany.mockResolvedValue([
      {
        id: 'knowledge-1',
        title: mojibakeName,
        summary: `[未解析文件] ${mojibakeName} 已保存到本机知识库，但当前未能提取可检索文本。`,
        content: '',
        sourceUrl: `local://knowledge-file/${mojibakeName}`,
        metadata: {
          fileName: mojibakeName,
          fileSize: 39426457,
          contentType: 'application/pdf',
          parsed: false,
          cloudSyncStatus: 'local_only',
        },
        createdAt: updatedAt,
        updatedAt,
      },
    ]);

    await expect(controller.listLocalKnowledge()).resolves.toEqual({
      total: 1,
      items: [
        expect.objectContaining({
          title: expectedName,
          fileName: expectedName,
          summary: expect.stringContaining(expectedName),
          parsed: false,
        }),
      ],
    });
  });

  it('deduplicates legacy failed uploads in favor of parsed local knowledge', async () => {
    const { controller, prisma } = createController();
    const fileName = '曹耕记潇湘小炒品牌手册(1).pdf';
    const mojibakeName = Buffer.from(fileName, 'utf8').toString('latin1');
    const fileSize = 39429856;
    prisma.material.findMany.mockResolvedValue([
      {
        id: 'failed-newer',
        title: mojibakeName,
        summary: `[未解析文件] ${mojibakeName} 已保存到本机知识库，但当前未能提取可检索文本。`,
        content: `[未解析文件] ${mojibakeName} 已保存到本机知识库，但当前未能提取可检索文本。`,
        sourceUrl: `local://knowledge-file/${mojibakeName}`,
        metadata: {
          fileName: mojibakeName,
          fileSize,
          contentType: 'application/pdf',
          parsed: false,
          cloudSyncStatus: 'local_only',
        },
        createdAt: new Date('2026-06-22T18:00:00.000Z'),
        updatedAt: new Date('2026-06-22T18:00:00.000Z'),
      },
      {
        id: 'parsed-older',
        title: fileName,
        summary: '曹耕记品牌定位是做更好的潇湘小炒，寻味山野，拒绝预制。',
        content: '曹耕记品牌定位是做更好的潇湘小炒，寻味山野，拒绝预制。',
        sourceUrl: `local://knowledge-file/${fileName}`,
        metadata: {
          fileName,
          fileSize,
          contentType: 'application/pdf',
          parsed: true,
          cloudSyncStatus: 'local_only',
        },
        createdAt: new Date('2026-06-22T17:00:00.000Z'),
        updatedAt: new Date('2026-06-22T17:00:00.000Z'),
      },
    ]);

    await expect(controller.listLocalKnowledge()).resolves.toEqual({
      total: 1,
      items: [
        expect.objectContaining({
          id: 'parsed-older',
          title: fileName,
          parsed: true,
          summary: expect.stringContaining('寻味山野'),
        }),
      ],
    });
  });

  it('does not overwrite parsed file knowledge when a later duplicate upload fails to parse', async () => {
    const { controller, prisma } = createController();
    const fileName = '曹耕记潇湘小炒品牌手册(1).pdf';
    const parsedItem = {
      id: 'parsed-existing',
      title: fileName,
      summary: '曹耕记品牌定位是做更好的潇湘小炒，寻味山野，拒绝预制。',
      content: '曹耕记品牌定位是做更好的潇湘小炒，寻味山野，拒绝预制。',
      sourceUrl: `local://knowledge-file/${fileName}`,
      metadata: {
        fileName,
        fileSize: 39429856,
        contentType: 'application/pdf',
        parsed: true,
      },
      createdAt: new Date('2026-06-22T17:00:00.000Z'),
      updatedAt: new Date('2026-06-22T17:00:00.000Z'),
    };
    prisma.material.findMany.mockResolvedValue([parsedItem]);

    await expect(
      (controller as any).upsertLocalKnowledgeFile({
        fileName,
        fileSize: 39429856,
        contentType: 'application/pdf',
        parsed: false,
        content: `[未解析文件] ${fileName} 已保存到本机知识库，但当前未能提取可检索文本。`,
      }),
    ).resolves.toBe(parsedItem);
    expect(prisma.material.update).not.toHaveBeenCalled();
    expect(prisma.material.create).not.toHaveBeenCalled();
  });

  it('extracts searchable text from local docx files without cloud sync', async () => {
    const { controller } = createController();
    const docx = buildStoredZip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>企业AI常见问题</w:t></w:r></w:p><w:p><w:r><w:t>售前售后部署说明可以本机检索。</w:t></w:r></w:p></w:body></w:document>',
    });

    await expect(
      (controller as any).extractKnowledgeFileText({
        buffer: docx,
        originalname: '企业AI常见问题.docx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).resolves.toContain('企业AI常见问题');
  });

  it('searches only local knowledge for local-only acceptance sessions', async () => {
    const { controller, kaypalClient, req, prisma } = createController({
      localOnly: true,
    });
    const updatedAt = new Date('2026-06-21T16:34:00.000Z');
    prisma.material.findMany.mockResolvedValue([
      {
        id: 'knowledge-local-1',
        title: '蓝莓拿铁售后政策',
        summary: '蓝莓拿铁售后政策：7 天内支持换新。',
        content: '蓝莓拿铁售后政策：7 天内支持换新，需保留购买凭证。',
        sourceUrl: 'local://knowledge-text/acceptance',
        metadata: {
          cloudSyncStatus: 'local_only',
        },
        createdAt: updatedAt,
        updatedAt,
      },
    ]);

    await expect(
      controller.searchKnowledge(req, {
        query: '蓝莓拿铁 售后政策',
        limit: 5,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        matches: [
          expect.objectContaining({
            assetId: 'knowledge-local-1',
            title: '蓝莓拿铁售后政策',
            sourceType: 'local',
          }),
        ],
        diagnostics: expect.objectContaining({
          localHitCount: 1,
          cloudHitCount: 0,
          cloudWarning: '本地验收会话已跳过 Kaypal 主知识库',
        }),
      }),
    );
    expect(kaypalClient.searchCloudKnowledge).not.toHaveBeenCalled();
    expect(kaypalClient.refreshDesktopAuthToken).not.toHaveBeenCalled();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('keeps local knowledge sync non-blocking when Kaypal cloud auth expires', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    const updatedAt = new Date('2026-06-26T10:00:00.000Z');
    prisma.material.findUnique.mockResolvedValue({
      id: 'knowledge-local-1',
      title: '企业AI常见问题',
      summary: '企业AI常见问题：售前、售后和部署说明。',
      content: '企业AI常见问题：售前、售后和部署说明。',
      platform: (controller as any).localKnowledgePlatform,
      sourceUrl: 'local://knowledge-text/test',
      metadata: {
        cloudSyncStatus: 'local_only',
      },
      createdAt: updatedAt,
      updatedAt,
    });
    kaypalClient.uploadCloudKnowledge.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 401'),
    );

    await expect(
      controller.syncKnowledge(req, { id: 'knowledge-local-1' }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        id: 'knowledge-local-1',
        cloud: null,
        cloudWarning: expect.stringContaining('本机知识已保存'),
      }),
    );
    expect(prisma.material.update).not.toHaveBeenCalled();
  });

  it('reports cloud knowledge permission separately when Kaypal profile auth is valid', async () => {
    const { controller, kaypalClient, req, prisma } = createController();
    const updatedAt = new Date('2026-06-26T10:00:00.000Z');
    prisma.material.findUnique.mockResolvedValue({
      id: 'knowledge-local-1',
      title: '企业AI常见问题',
      summary: '企业AI常见问题：售前、售后和部署说明。',
      content: '企业AI常见问题：售前、售后和部署说明。',
      platform: (controller as any).localKnowledgePlatform,
      sourceUrl: 'local://knowledge-text/test',
      metadata: {
        cloudSyncStatus: 'local_only',
      },
      createdAt: updatedAt,
      updatedAt,
    });
    kaypalClient.uploadCloudKnowledge.mockRejectedValue(
      new ServiceUnavailableException('Kaypal 云端返回 401'),
    );
    kaypalClient.refreshDesktopAuthToken.mockResolvedValue({
      access_token: 'fresh-access-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: 3600,
      device_id: 'device-1',
    });
    kaypalClient.getCloudProfile.mockResolvedValue({
      userId: 'kaypal-user-1',
    });

    await expect(
      controller.syncKnowledge(req, { id: 'knowledge-local-1' }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        cloudWarning:
          expect.stringContaining('云端知识库接口未放行当前桌面授权'),
      }),
    );
    expect(kaypalClient.getCloudProfile).toHaveBeenCalled();
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});
