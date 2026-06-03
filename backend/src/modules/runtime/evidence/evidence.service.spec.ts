import { EvidenceService } from './evidence.service';
import type { RuntimeExecutionResult } from '../executor.interface';

function makeResult(overrides: Partial<RuntimeExecutionResult> = {}): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: 'test success',
    technicalMessage: 'ok',
    runtime: {
      mode: 'agent-s',
      executor: 'desktop-agent-s',
      agentSSessionId: 'session-1',
    },
    evidence: [
      {
        type: 'agent-s-action-log',
        label: 'test',
        value: 'events',
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function makePrismaMock(overrides: {
  createThrows?: Error;
  findManyResult?: unknown[];
} = {}) {
  const create = jest.fn();
  if (overrides.createThrows) {
    create.mockRejectedValue(overrides.createThrows);
  } else {
    create.mockResolvedValue({
      id: 'exec-1',
      createdAt: new Date(),
    });
  }

  const findMany = jest.fn().mockResolvedValue(overrides.findManyResult ?? []);

  return {
    runtimeExecution: {
      create,
      findMany,
    },
  };
}

describe('EvidenceService', () => {
  describe('recordExecution - 成功路径', () => {
    it('写入成功 → 返 { status: persisted, executionId }', async () => {
      const prisma = makePrismaMock();
      const service = new EvidenceService(prisma as never);

      const outcome = await service.recordExecution(
        {
          relatedId: 'task-1',
          relatedType: 'interaction-task',
          platform: 'wechat-desktop',
          taskType: 'wechat-reply-draft',
          accountId: 1,
        },
        makeResult(),
      );

      expect(outcome.status).toBe('persisted');
      if (outcome.status === 'persisted') {
        expect(outcome.executionId).toBe('exec-1');
        expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(prisma.runtimeExecution.create).toHaveBeenCalledTimes(1);
    });

    it('写入包含完整字段（runtime / evidence / agentSSessionId）', async () => {
      const prisma = makePrismaMock();
      const service = new EvidenceService(prisma as never);

      await service.recordExecution(
        {
          relatedId: 'task-2',
          relatedType: 'agent-session',
          platform: 'wechat-desktop',
          taskType: 'wechat-reply-draft',
        },
        makeResult(),
      );

      const callArgs = (prisma.runtimeExecution.create as jest.Mock).mock.calls[0][0];
      expect(callArgs.data.relatedId).toBe('task-2');
      expect(callArgs.data.relatedType).toBe('agent-session');
      expect(callArgs.data.executor).toBe('agent-s');
      expect(callArgs.data.platform).toBe('wechat-desktop');
      expect(callArgs.data.agentSSessionId).toBe('session-1');
      expect(callArgs.data.ok).toBe(true);
      expect(callArgs.data.userMessage).toBe('test success');
      expect(callArgs.data.evidenceJson).toBeDefined();
    });
  });

  describe('recordExecution - 失败降级', () => {
    it('Prisma 抛错 → 返 { status: failed, error } 不抛', async () => {
      const prisma = makePrismaMock({
        createThrows: new Error('DB connection lost'),
      });
      const service = new EvidenceService(prisma as never);

      const outcome = await service.recordExecution(
        {
          relatedId: 'task-3',
          relatedType: 'interaction-task',
          platform: 'douyin',
          taskType: 'douyin-comment-reply',
        },
        makeResult(),
      );

      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.error).toContain('DB connection lost');
      }
    });
  });

  describe('recordExecution - 校验', () => {
    it('relatedId 空 → 返 { status: invalid, reason }', async () => {
      const prisma = makePrismaMock();
      const service = new EvidenceService(prisma as never);

      const outcome = await service.recordExecution(
        {
          relatedId: '',
          relatedType: 'interaction-task',
          platform: 'douyin',
          taskType: 'douyin-comment-reply',
        },
        makeResult(),
      );

      expect(outcome.status).toBe('invalid');
      // 不应该调 Prisma
      expect(prisma.runtimeExecution.create).not.toHaveBeenCalled();
    });
  });

  describe('recordExecutionFireAndForget', () => {
    it('不 await 不抛：内部 recordExecution 跑完即结束', async () => {
      const prisma = makePrismaMock();
      const service = new EvidenceService(prisma as never);

      // 不 await
      service.recordExecutionFireAndForget(
        {
          relatedId: 'task-4',
          relatedType: 'interaction-task',
          platform: 'douyin',
          taskType: 'douyin-comment-reply',
        },
        makeResult(),
      );

      // 给 microtask 时间跑
      await new Promise((resolve) => setImmediate(resolve));
      expect(prisma.runtimeExecution.create).toHaveBeenCalledTimes(1);
    });

    it('recordExecution 自身抛错（不该发生）也不影响 caller', () => {
      const prisma = makePrismaMock({
        createThrows: new Error('unhandled'),
      });
      const service = new EvidenceService(prisma as never);

      // 不应该抛
      expect(() => {
        service.recordExecutionFireAndForget(
          {
            relatedId: 'task-5',
            relatedType: 'interaction-task',
            platform: 'douyin',
            taskType: 'douyin-comment-reply',
          },
          makeResult(),
        );
      }).not.toThrow();
    });
  });

  describe('listByRelatedId', () => {
    it('返查询结果', async () => {
      const prisma = makePrismaMock({
        findManyResult: [
          {
            id: 'exec-1',
            executor: 'agent-s',
            status: 'success',
            reasonCode: 'success',
            createdAt: new Date('2026-06-03T10:00:00Z'),
          },
          {
            id: 'exec-2',
            executor: 'local-runtime',
            status: 'failed',
            reasonCode: 'send_failed',
            createdAt: new Date('2026-06-03T11:00:00Z'),
          },
        ],
      });
      const service = new EvidenceService(prisma as never);

      const rows = await service.listByRelatedId('task-1', 10);

      expect(rows).toHaveLength(2);
      expect(rows[0].executor).toBe('agent-s');
      expect(prisma.runtimeExecution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { relatedId: 'task-1' },
          take: 10,
        }),
      );
    });
  });
});
