import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { LocalEngineService } from '../src/modules/local-engine/local-engine.service';
import type {
  InteractionTask,
  InteractionTaskRuntimePort,
  LocalEngineExecutorCapability,
} from '../src/modules/local-engine/local-engine.types';
import { ExecutorRouter } from '../src/modules/runtime/executor-router';
import { EvidenceService } from '../src/modules/runtime/evidence/evidence.service';
import type {
  ExecutorCapability,
  RuntimeExecutionResult,
  TaskExecutor,
} from '../src/modules/runtime/executor.interface';
import { RuntimeOrchestrator } from '../src/modules/runtime/orchestrator/runtime-orchestrator.service';
import { PrismaService } from '../src/prisma/prisma.service';

const ACCOUNT_ID = 12;

const douyinCapability: LocalEngineExecutorCapability = {
  key: 'douyin-comment-reply',
  name: '抖音评论回复',
  platformName: '抖音',
  status: 'ready',
  entryPreflight: true,
  targetRead: true,
  replyGenerate: true,
  controlledSend: true,
  autoSend: true,
  message: 'local-engine runtime smoke ready',
  nextAction: 'none',
};

function createRuntimeExecutor(options: {
  id: 'local-runtime' | 'agent-s';
  canHandle: ExecutorCapability;
}): TaskExecutor {
  return {
    id: options.id,
    canHandle: () => options.canHandle,
    execute: async (task): Promise<RuntimeExecutionResult> => ({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: 'LocalEngine Runtime smoke: auto-send succeeded',
      technicalMessage: 'No real platform action was executed.',
      runtime: {
        mode: options.id,
        executor:
          options.id === 'local-runtime' ? 'browser-cdp' : 'desktop-agent-s',
        version: 'smoke',
        engineUrl: 'internal://local-engine-runtime-smoke',
      },
      evidence: [
        {
          type: 'text',
          label: 'Runtime smoke task',
          value: `${task.type} routed from LocalEngineService`,
          createdAt: new Date().toISOString(),
        },
        {
          type: 'readback',
          label: 'Reply readback',
          value: String(task.payload.replyText ?? ''),
          createdAt: new Date().toISOString(),
        },
      ],
      readback: {
        expectedText: String(task.payload.replyText ?? ''),
        actualText: String(task.payload.replyText ?? ''),
        matched: true,
      },
    }),
    isHealthy: async () => ({ ok: true, details: 'smoke' }),
  };
}

function createInteractionExecutorMock() {
  return {
    getStatus: async () => ({
      checkedAt: new Date().toISOString(),
      summary: {
        total: 1,
        ready: 1,
        preflightOnly: 0,
        missing: 0,
      },
      executors: [douyinCapability],
    }),
    preflightTask: async (
      task: InteractionTask,
      runtimePort: InteractionTaskRuntimePort,
    ) => {
      runtimePort.setTaskStep(
        task,
        'account-entry',
        'completed',
        'smoke: account preflight passed',
      );
      runtimePort.setTaskStep(
        task,
        'target-read',
        'completed',
        'smoke: target read passed',
      );
      runtimePort.setTaskStep(
        task,
        'reply-generate',
        'completed',
        'smoke: reply generated',
      );
      runtimePort.setTaskStep(
        task,
        'send-approval',
        'skipped',
        'smoke: auto-send mode skips approval',
      );
      runtimePort.pushEvent(task, 'info', 'smoke: local executor preflight ok');
      return {
        state: 'live_ready' as const,
        targetText: '客户问：这个怎么收费？',
        replyText: '您好，可以私信您具体报价。',
        replyGeneratedBy: 'fallback' as const,
      };
    },
    autoSendReply: async () => {
      throw new Error('legacy autoSendReply fallback should not be used');
    },
    draftApprovedReply: async () => {
      throw new Error('legacy draftApprovedReply fallback should not be used');
    },
  };
}

function createAutoUploadServiceMock() {
  return {
    listAccounts: async () => [
      {
        id: ACCOUNT_ID,
        platform: '抖音',
        type: 3,
        displayName: 'runtime-smoke-douyin',
        userName: 'runtime-smoke-douyin',
        profileName: 'runtime-smoke-douyin',
        status: 1,
      },
    ],
    getHealth: async () => ({ online: true }),
    getInteractionCapabilities: async () => ({
      capabilities: [douyinCapability],
    }),
    openInteractionEntry: async () => ({ ok: true }),
  };
}

function createRuntimeOrchestrator(prisma: PrismaService) {
  const evidence = new EvidenceService(prisma);
  const router = new ExecutorRouter({} as never, {} as never, evidence);
  (router as unknown as { executors: TaskExecutor[] }).executors = [
    createRuntimeExecutor({
      id: 'local-runtime',
      canHandle: { ok: true, priority: 80, reason: 'smoke local runtime' },
    }),
    createRuntimeExecutor({
      id: 'agent-s',
      canHandle: { ok: false, priority: 0, reason: 'browser task' },
    }),
  ];
  return new RuntimeOrchestrator(router);
}

async function waitForRuntimeRecord(prisma: PrismaService, relatedId: string) {
  for (let index = 0; index < 30; index += 1) {
    const row = await prisma.runtimeExecution.findFirst({
      where: { relatedId },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function cleanup(prisma: PrismaService, taskId: string) {
  await prisma.runtimeExecution.deleteMany({ where: { relatedId: taskId } });
  await prisma.interactionTaskEvent.deleteMany({ where: { taskId } });
  await prisma.interactionTask.deleteMany({ where: { id: taskId } });
}

async function waitForLocalEnginePersistence(
  service: LocalEngineService,
  taskId: string,
) {
  const taskPersistQueues = (
    service as unknown as {
      taskPersistQueues?: Map<string, Promise<void>>;
    }
  ).taskPersistQueues;
  const pending = taskPersistQueues?.get(taskId);
  if (pending) {
    await pending.catch(() => undefined);
  }
}

async function assertCleanedUp(prisma: PrismaService, taskId: string) {
  const [runtimeRows, eventRows, taskRows] = await Promise.all([
    prisma.runtimeExecution.count({ where: { relatedId: taskId } }),
    prisma.interactionTaskEvent.count({ where: { taskId } }),
    prisma.interactionTask.count({ where: { id: taskId } }),
  ]);
  if (runtimeRows || eventRows || taskRows) {
    throw new Error(
      `Smoke cleanup left rows: runtime=${runtimeRows} events=${eventRows} tasks=${taskRows}`,
    );
  }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  let taskId = '';
  try {
    const service = new LocalEngineService(
      new ConfigService(),
      createAutoUploadServiceMock() as never,
      prisma,
      createInteractionExecutorMock() as never,
      { getStatus: async () => ({ available: false }) } as never,
      { getStatus: async () => ({ available: false }) } as never,
      { getStatus: async () => ({ available: false }) } as never,
      { getStatus: async () => ({ available: false }) } as never,
      { getStatus: async () => ({ available: false }) } as never,
      createRuntimeOrchestrator(prisma),
    );

    const task = await service.createTask({
      type: 'douyin-comment-reply',
      accountId: String(ACCOUNT_ID),
      accountName: 'runtime-smoke-douyin',
      platformType: 3,
      platformName: '抖音',
      targetName: 'runtime-smoke-target',
      sourceText: '客户问：这个怎么收费？',
      replyText: '您好，可以私信您具体报价。',
      sendMode: 'auto-send',
      commercialExecutionRequested: true,
    });
    taskId = task.id;

    const runtimeRow = await waitForRuntimeRecord(prisma, task.id);
    if (!runtimeRow) {
      throw new Error(
        `LocalEngine task ${task.id} did not persist runtime_executions`,
      );
    }

    const persistedTask = await prisma.interactionTask.findUnique({
      where: { id: task.id },
      select: { id: true, status: true, taskType: true, sendMode: true },
    });
    await waitForLocalEnginePersistence(service, task.id);
    await cleanup(prisma, task.id);
    await assertCleanedUp(prisma, task.id);

    console.log(
      JSON.stringify(
        {
          status: 'passed',
          localEngineTask: persistedTask,
          runtimeExecution: {
            id: runtimeRow.id,
            ok: runtimeRow.ok,
            status: runtimeRow.status,
            reasonCode: runtimeRow.reasonCode,
            executor: runtimeRow.executor,
            relatedId: runtimeRow.relatedId,
          },
          cleanedUp: task.id,
        },
        null,
        2,
      ),
    );
  } finally {
    if (taskId) {
      await cleanup(prisma, taskId);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
