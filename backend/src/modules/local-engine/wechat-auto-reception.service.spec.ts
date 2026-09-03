import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WechatAutoReceptionGuardService } from './wechat-auto-reception.service';

const ORIGINAL_LOG_ROOT = process.env.KAYPAL_RUNTIME_LOG_ROOT;

function withIsolatedLogRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-auto-reception-spec-'));
  process.env.KAYPAL_RUNTIME_LOG_ROOT = dir;
  return dir;
}

function makeService(overrides: {
  state?: Record<string, unknown>;
  prismaFindFirst?: unknown;
  engineSession?: Record<string, unknown>;
} = {}) {
  const config = {
    get: (key: string) => (key === 'WECHAT_AUTO_RECEPTION_ENABLED' ? 'true' : undefined),
  };
  const prisma = {
    interactionTask: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.prismaFindFirst ?? { tenantId: 'local-desktop:u1', userId: 'u1' },
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const auth = {
    run: jest.fn((_context: unknown, cb: () => unknown) => cb()),
  };
  const engine = {
    wechatSessionConfirmation: overrides.engineSession ?? {},
    readWechatChatHistoryCache: jest.fn().mockResolvedValue({
      sessions: [{ id: 's1', title: '客户A' }],
      messages: [],
    }),
    syncWechatChatHistory: jest.fn().mockResolvedValue({ ok: true }),
    listReplyBots: jest.fn().mockResolvedValue([]),
    createCustomerServiceReplyTask: jest.fn(),
    createTask: jest.fn().mockResolvedValue({ id: 'fa-plan-1' }),
  };
  const service = new WechatAutoReceptionGuardService(
    config as never,
    prisma as never,
    auth as never,
    engine as never,
  );
  return { service, prisma, auth, engine };
}

describe('WechatAutoReceptionGuardService', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = withIsolatedLogRoot();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_LOG_ROOT === undefined) delete process.env.KAYPAL_RUNTIME_LOG_ROOT;
    else process.env.KAYPAL_RUNTIME_LOG_ROOT = ORIGINAL_LOG_ROOT;
    rmSync(logDir, { recursive: true, force: true });
  });

  describe('findNewIncomingMessages', () => {
    it('只返回未处理过的 incoming 文本消息', () => {
      const { service } = makeService();
      const anyService = service as unknown as {
        state: { watermark: Record<string, string[]> };
        findNewIncomingMessages(cache: {
          sessions: Array<{ id: string; title?: string }>;
          messages: Array<{
            id: string;
            sessionId: string;
            direction: string;
            contentType: string;
            content: string;
            sentAt?: string;
          }>;
        }): Array<{ sessionId: string; messageId: string; content: string }>;
      };
      anyService.state = { ...anyService.state, watermark: { s1: ['m1'] } };
      const result = anyService.findNewIncomingMessages({
        sessions: [{ id: 's1', title: '客户A' }, { id: 's2', title: '客户B' }],
        messages: [
          { id: 'm1', sessionId: 's1', direction: 'incoming', contentType: 'text', content: '已处理', sentAt: '2026-01-01T00:00:00Z' },
          { id: 'm2', sessionId: 's1', direction: 'incoming', contentType: 'text', content: '新消息1', sentAt: '2026-01-01T00:01:00Z' },
          { id: 'm3', sessionId: 's2', direction: 'incoming', contentType: 'text', content: '客户B消息', sentAt: '2026-01-01T00:02:00Z' },
          { id: 'm4', sessionId: 's2', direction: 'outgoing', contentType: 'text', content: '我方消息' },
          { id: 'm5', sessionId: 's2', direction: 'incoming', contentType: 'image', content: 'img' },
        ],
      });
      expect(result.map((item) => item.messageId).sort()).toEqual(['m2', 'm3']);
      expect(new Set(result.map((item) => item.content))).toEqual(
        new Set(['新消息1', '客户B消息']),
      );
    });

    it('同一会话多条未处理只返回最新一条（防打扰）', () => {
      const { service } = makeService();
      const anyService = service as unknown as {
        state: { watermark: Record<string, string[]> };
        findNewIncomingMessages(cache: unknown): Array<{ messageId: string; content: string }>;
      };
      const result = anyService.findNewIncomingMessages({
        sessions: [{ id: 's1', title: '客户A' }],
        messages: [
          { id: 'a', sessionId: 's1', direction: 'incoming', contentType: 'text', content: '早', sentAt: '2026-01-01T00:00:00Z' },
          { id: 'b', sessionId: 's1', direction: 'incoming', contentType: 'text', content: '晚', sentAt: '2026-01-01T00:10:00Z' },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].messageId).toBe('b');
      expect(result[0].content).toBe('晚');
    });
  });

  describe('markProcessed', () => {
    it('记录消息 id 且保留上限', () => {
      const { service } = makeService();
      const anyService = service as unknown as {
        state: { watermark: Record<string, string[]> };
        markProcessed(sessionId: string, messageId: string): void;
      };
      anyService.markProcessed('s1', 'm1');
      anyService.markProcessed('s1', 'm2');
      expect(anyService.state.watermark.s1).toEqual(['m1', 'm2']);
      anyService.markProcessed('s1', 'm1');
      expect(anyService.state.watermark.s1).toEqual(['m1', 'm2']);
    });
  });

  describe('setEnabled + runOnce', () => {
    it('关闭开关后 runOnce 不进入处理流程', async () => {
      const { service, engine } = makeService();
      await service.setEnabled(false);
      await service.runOnce();
      expect(engine.readWechatChatHistoryCache).not.toHaveBeenCalled();
      expect(engine.listReplyBots).not.toHaveBeenCalled();
      expect(service.getStatus().enabled).toBe(false);
    });

    it('takeover 期间 runOnce 暂停生成草稿', async () => {
      const { service, engine } = makeService({
        engineSession: { takeoverActive: true },
      });
      await service.runOnce();
      expect(engine.readWechatChatHistoryCache).not.toHaveBeenCalled();
      console.log('DEBUG status:', JSON.stringify(service.getStatus(), null, 2));
      expect(service.getStatus().paused).toBe(true);
      expect(service.getStatus().pausedReason).toContain('人工接管');
    });

    it('无启用 bot 时跳过并记录原因', async () => {
      const { service, prisma, engine } = makeService({
        prismaFindFirst: { tenantId: 'local-desktop:u1', userId: 'u1' },
      });
      prisma.interactionTask.findFirst.mockResolvedValue({
        tenantId: 'local-desktop:u1',
        userId: 'u1',
      });
      await service.runOnce();
      expect(engine.listReplyBots).toHaveBeenCalled();
      const status = service.getStatus();
      expect(status.skipped).toBeGreaterThan(0);
      expect(status.reasons.general).toContain('没有启用的客服机器人');
    });
  });

  describe('autoAcceptFriend（阶段 3）', () => {
    it('开关状态可设置并回读', async () => {
      const { service } = makeService();
      await service.setAutoAcceptFriend(true);
      expect(service.getStatus().autoAcceptFriend).toBe(true);
      await service.setAutoAcceptFriend(false);
      expect(service.getStatus().autoAcceptFriend).toBe(false);
    });

    it('非 win32：开启后不创建任何计划并如实提示', async () => {
      const { service, engine } = makeService();
      const anySvc = service as unknown as { isWindowsHost: () => boolean };
      anySvc.isWindowsHost = () => false;
      await service.setAutoAcceptFriend(true);
      const anyService = service as unknown as {
        ensureFriendAcceptPlan(userId: string): Promise<void>;
      };
      await anyService.ensureFriendAcceptPlan('u1');
      expect(engine.createTask).not.toHaveBeenCalled();
      expect(service.getStatus().autoAcceptRuntimeHint).toContain('不是 Windows');
    });

    it('win32 且无历史计划：创建一条 auto-send 计划', async () => {
      const { service, engine } = makeService();
      const anySvc = service as unknown as { isWindowsHost: () => boolean };
      anySvc.isWindowsHost = () => true;
      // 无历史计划：覆盖 prisma findFirst -> null
      const prismaAccess = (
        service as unknown as { prisma: { interactionTask: { findFirst: jest.Mock } } }
      ).prisma;
      prismaAccess.interactionTask.findFirst.mockResolvedValue(null);
      const anyService = service as unknown as {
        ensureFriendAcceptPlan(userId: string): Promise<void>;
      };
      await anyService.ensureFriendAcceptPlan('u1');
      expect(engine.createTask).toHaveBeenCalledTimes(1);
      const input = engine.createTask.mock.calls[0][0] as Record<string, unknown>;
      expect(input.type).toBe('wechat-friend-accept');
      expect(input.sendMode).toBe('auto-send');
      expect((input.metadata as Record<string, unknown>).skill_id).toBe(
        'wechat.friend.accept',
      );
      expect(service.getStatus().autoAcceptPlanId).toBe('fa-plan-1');
    });

    it('win32 且已有活跃计划：幂等不重复创建', async () => {
      const { service, engine } = makeService();
      const anySvc = service as unknown as { isWindowsHost: () => boolean };
      anySvc.isWindowsHost = () => true;
      const prismaAccess = (
        service as unknown as { prisma: { interactionTask: { findFirst: jest.Mock } } }
      ).prisma;
      prismaAccess.interactionTask.findFirst.mockResolvedValue({
        id: 'fa-1',
        status: 'QUEUED',
        stage: 'scheduled-wait',
      });
      const anyService = service as unknown as {
        ensureFriendAcceptPlan(userId: string): Promise<void>;
      };
      await anyService.ensureFriendAcceptPlan('u1');
      expect(engine.createTask).not.toHaveBeenCalled();
      expect(service.getStatus().autoAcceptPlanId).toBe('fa-1');
    });
  });
});
