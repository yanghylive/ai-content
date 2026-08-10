import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RuntimeOrchestrator } from '../src/modules/runtime/orchestrator/runtime-orchestrator.service';
import { buildAiEmployeeExecutorTask } from '../src/modules/runtime/ai-employee/ai-employee.contract';
import type { ExecutorContext } from '../src/modules/runtime/executor.interface';

function readConfig() {
  const accountId = process.env.DOUYIN_EXPOSURE_ACCOUNT_ID;
  const link = process.env.DOUYIN_EXPOSURE_LINK;
  const limit = Number(process.env.DOUYIN_EXPOSURE_LIMIT || '20');
  if (!accountId || !link) {
    return {
      ok: false as const,
      reason:
        'Set DOUYIN_EXPOSURE_ACCOUNT_ID and DOUYIN_EXPOSURE_LINK to run the real read-only smoke.',
    };
  }
  return {
    ok: true as const,
    accountId,
    link,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
  };
}

async function main() {
  const config = readConfig();
  if (!config.ok) {
    console.log(
      JSON.stringify(
        {
          status: 'skipped',
          reason: config.reason,
          example:
            'DOUYIN_EXPOSURE_ACCOUNT_ID=1 DOUYIN_EXPOSURE_LINK=https://v.douyin.com/... npx ts-node -r tsconfig-paths/register scripts/douyin-link-exposure-smoke.ts',
        },
        null,
        2,
      ),
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const runtime = app.get(RuntimeOrchestrator);
    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-link-exposure',
      relatedId: `douyin-link-exposure-smoke-${Date.now()}`,
      relatedType: 'agent-session',
      accountId: config.accountId,
      payload: {
        links: [config.link],
        filters: {
          commentLimit: config.limit,
          commentTimeMatch: 'none',
        },
      },
    });
    const ctx: ExecutorContext = {
      riskContext: {
        accountName: `douyin:${config.accountId}`,
      },
      sendMode: 'draft-only',
    };
    const result = await runtime.execute(task, ctx);
    console.log(
      JSON.stringify(
        {
          status: result.ok ? 'passed' : 'failed',
          task: {
            relatedId: task.relatedId,
            type: task.type,
            platform: task.platform,
            accountId: task.accountId,
          },
          result: {
            ok: result.ok,
            status: result.status,
            reasonCode: result.reasonCode,
            userMessage: result.userMessage,
            technicalMessage: result.technicalMessage,
            evidence: result.evidence,
            readback: result.readback,
          },
        },
        null,
        2,
      ),
    );
    if (!result.ok) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
