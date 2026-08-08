import { PushNotificationsService } from './push-notifications.service';

function makeService(
  prisma: Record<string, unknown> = {},
  env: Record<string, string | undefined> = {},
) {
  // 保留原 env，注入测试 VAPID
  const origKeys = { ...process.env };
  Object.assign(process.env, {
    PUSH_VAPID_PUBLIC_KEY: 'test-pub',
    PUSH_VAPID_PRIVATE_KEY: 'test-priv',
    ...env,
  });
  const service = new PushNotificationsService(prisma as any) as any;
  // 恢复 env（webpush.setVapidDetails 用测试 key 无妨）
  Object.assign(process.env, origKeys);
  return service;
}

describe('PushNotificationsService', () => {
  it('upsertSubscription: 新 endpoint 创建', async () => {
    const prisma = {
      pushSubscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        update: jest.fn(),
      },
    };
    const service = makeService(prisma);
    const result = await service.upsertSubscription({
      userId: 'u-1',
      tenantId: null,
      endpoint: 'https://push.example/e1',
      p256dh: 'p256dh-1',
      auth: 'auth-1',
      userAgent: 'test-agent',
    });
    expect(result.id).toBe('sub-1');
    expect(prisma.pushSubscription.create).toHaveBeenCalledWith({
      data: {
        userId: 'u-1',
        tenantId: null,
        endpoint: 'https://push.example/e1',
        p256dh: 'p256dh-1',
        auth: 'auth-1',
        userAgent: 'test-agent',
      },
    });
    expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
  });

  it('upsertSubscription: 已存在 endpoint 走更新（去重）', async () => {
    const prisma = {
      pushSubscription: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      },
    };
    const service = makeService(prisma);
    const result = await service.upsertSubscription({
      userId: 'u-2',
      tenantId: 't-9',
      endpoint: 'https://push.example/e1',
      p256dh: 'new-p256dh',
      auth: 'new-auth',
      userAgent: null,
    });
    expect(result.id).toBe('sub-1');
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        userId: 'u-2',
        tenantId: 't-9',
        p256dh: 'new-p256dh',
        auth: 'new-auth',
        userAgent: null,
      },
    });
    expect(prisma.pushSubscription.create).not.toHaveBeenCalled();
  });

  it('sendToUser: 无订阅时直接返回 0', async () => {
    const prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = makeService(prisma);
    const result = await service.sendToUser('u-1', { title: '测试' });
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it('removeSubscription: 非本人订阅不删除', async () => {
    const del = jest.fn();
    const prisma = {
      pushSubscription: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'sub-1', userId: 'owner-1' }),
        delete: del,
      },
    };
    const service = makeService(prisma);
    await service.removeSubscription('other-user', 'https://push.example/e1');
    expect(del).not.toHaveBeenCalled();
  });
});
