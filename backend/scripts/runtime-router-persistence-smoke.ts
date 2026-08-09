import 'dotenv/config';
import { ExecutorRouter } from '../src/modules/runtime/executor-router';
import { EvidenceService } from '../src/modules/runtime/evidence/evidence.service';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
  type TaskExecutor,
} from '../src/modules/runtime/executor.interface';
import { PrismaService } from '../src/prisma/prisma.service';

function createExecutor(options: {
  id: 'local-runtime' | 'agent-s';
  canHandle: ExecutorCapability;
  result?: RuntimeExecutionResult;
}): TaskExecutor {
  return {
    id: options.id,
    canHandle: () => options.canHandle,
    execute: async () =>
      options.result ?? {
        ok: false,
        status: 'failed',
        reasonCode: 'runtime_unavailable',
        userMessage: 'Runtime router persistence smoke: structured rejection',
        technicalMessage: 'No real platform action was executed.',
        runtime: {
          mode: options.id,
          executor:
            options.id === 'local-runtime' ? 'browser-cdp' : 'desktop-agent-s',
        },
        evidence: [
          {
            type: 'text',
            label: 'Runtime router persistence smoke',
            value: 'ExecutorRouter -> EvidenceService fire-and-forget check',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    isHealthy: async () => ({ ok: true, details: 'smoke' }),
  };
}

async function waitForRecord(
  prisma: PrismaService,
  relatedId: string,
  attempts = 20,
) {
  for (let index = 0; index < attempts; index += 1) {
    const row = await prisma.runtimeExecution.findFirst({
      where: { relatedId },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const evidence = new EvidenceService(prisma);
  const router = new ExecutorRouter({} as never, {} as never, evidence);

  const relatedId = `runtime-router-smoke-${Date.now()}`;
  const localExecutor = createExecutor({
    id: 'local-runtime',
    canHandle: { ok: true, priority: 70, reason: 'smoke local executor' },
  });
  const agentExecutor = createExecutor({
    id: 'agent-s',
    canHandle: { ok: false, priority: 0, reason: 'not needed for smoke' },
  });
  (router as unknown as { executors: TaskExecutor[] }).executors = [
    localExecutor,
    agentExecutor,
  ];

  const task: ExecutorTask = {
    relatedId,
    relatedType: 'interaction-task',
    type: 'douyin-comment-reply',
    platform: 'douyin',
    accountId: 1,
    payload: {},
  };
  const ctx: ExecutorContext = {
    riskContext: { accountName: 'runtime-router-smoke' },
    sendMode: 'auto-send',
  };

  try {
    const result = await router.route(task, ctx);
    const persisted = await waitForRecord(prisma, relatedId);
    if (!persisted) {
      throw new Error(
        'runtime_executions row was not persisted by router smoke',
      );
    }
    await prisma.runtimeExecution.delete({ where: { id: persisted.id } });
    console.log(
      JSON.stringify(
        {
          status: 'passed',
          routeResult: {
            ok: result.ok,
            status: result.status,
            reasonCode: result.reasonCode,
          },
          insertedAndDeleted: persisted.id,
          relatedId,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
