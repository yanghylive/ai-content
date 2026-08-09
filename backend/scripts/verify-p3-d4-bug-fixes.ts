/**
 * P3-D4 删存量 bug 修复验证脚本
 *
 * 直接调 LocalEngineService.getExecutorsStatus 和 generateInteractionReply
 * 绕开 HTTP / auth / DB，验证两个方法的实现是否正确。
 *
 * 用法：npx ts-node -r tsconfig-paths/register scripts/verify-p3-d4-bug-fixes.ts
 */

import 'dotenv/config';
import { LocalEngineService } from '../src/modules/local-engine/local-engine.service';
import { RuntimeOrchestrator } from '../src/modules/runtime/orchestrator/runtime-orchestrator.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AutoUploadService } from '../src/modules/auto-upload/auto-upload.service';
import { ConfigService } from '@nestjs/config';
import { McpRuntimeService } from '../src/modules/local-engine/mcp-runtime.service';
import { AgentSidecarService } from '../src/modules/local-engine/agent-sidecar.service';
import { SandboxRuntimeService } from '../src/modules/local-engine/sandbox-runtime.service';
import { PluginRuntimeService } from '../src/modules/local-engine/plugin-runtime.service';
import { MemoryRuntimeService } from '../src/modules/local-engine/memory-runtime.service';
import { BrowserControlService } from '../src/modules/runtime/browser-control/browser-control.service';

type ExecResult =
  | { method: string; status: 'PASS' | 'FAIL'; details: unknown }
  | { method: string; status: 'ERROR'; error: string };

async function check(
  name: string,
  fn: () => Promise<unknown> | unknown,
): Promise<ExecResult> {
  try {
    const result = await fn();
    return { method: name, status: 'PASS', details: result };
  } catch (err) {
    return {
      method: name,
      status: 'ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log('=== P3-D4 删存量 bug 修复验证 ===\n');

  // 构造 mock RuntimeOrchestrator（不依赖 DB / 引擎）
  const mockHealthCheck = async () => [
    { id: 'agent-s', ok: true, details: 'mocked healthy' },
    { id: 'local-runtime', ok: true, details: 'mocked healthy' },
  ];

  const mockRuntimeOrchestrator: Partial<RuntimeOrchestrator> = {
    healthCheck: mockHealthCheck as RuntimeOrchestrator['healthCheck'],
  };

  // 通用 mock：methods 列表里的属性返一个深度 Proxy（链式访问不抛错）
  // 深度 Proxy 会把任何函数调用都转成 `async () => null`（模拟 DB 返空）
  const makeMock = <T>(methods: string[] = []): T => {
    const makeDeep = (): unknown =>
      new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then' || prop === Symbol.toPrimitive) {
              return undefined;
            }
            // 任何函数调用都返 null（模拟 DB 空结果）
            return (..._args: unknown[]) => Promise.resolve(null);
          },
        },
      );
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop === 'string' && methods.includes(prop)) {
            return makeDeep();
          }
          // 其他访问也返深度 Proxy（防止隐式属性读取抛错）
          return makeDeep();
        },
      },
    ) as T;
  };

  // 关键：mockDeps 的属性顺序必须匹配 LocalEngineService 构造器参数顺序
  // (8 个必选 + runtimeOrchestrator 在第 9 位 + browserControl 在第 10 位)
  const mockDeps = {
    configService: makeMock<ConfigService>(['get']),
    autoUploadService: makeMock<AutoUploadService>(),
    prisma: makeMock<PrismaService>(['interactionReplyRule', 'interactionTask']),
    mcpRuntime: makeMock<McpRuntimeService>(),
    agentSidecar: makeMock<AgentSidecarService>(),
    sandboxRuntime: makeMock<SandboxRuntimeService>(),
    pluginRuntime: makeMock<PluginRuntimeService>(),
    memoryRuntime: makeMock<MemoryRuntimeService>(),
    runtimeOrchestrator: mockRuntimeOrchestrator as unknown as RuntimeOrchestrator,
    browserControl: makeMock<BrowserControlService>(),
  };

  // 直接构造 LocalEngineService（不经过 Nest DI）
  // 用 `unknown` 强转绕过构造器签名检查（mock 不满足所有类型，但运行时不调用无关方法）
  const service = new LocalEngineService(
    ...(Object.values(mockDeps) as [
      ConfigService,
      AutoUploadService,
      PrismaService,
      McpRuntimeService,
      AgentSidecarService,
      SandboxRuntimeService,
      PluginRuntimeService,
      MemoryRuntimeService,
      RuntimeOrchestrator,
      BrowserControlService,
    ]),
  );

  // 验证 1：getExecutorsStatus() 应该返 LocalEngineExecutorsStatus 形态
  const r1 = await check('getExecutorsStatus', () =>
    service.getExecutorsStatus(),
  );

  // 验证 2：getExecutorsStatus() 在 orchestrator ok=true 时 summary.ready=2
  const r1Details = (r1 as { status: 'PASS'; details: {
    summary: { total: number; ready: number; missing: number };
    executors: Array<{ key: string; status: string }>;
  } }).details;
  const r1Logic = await check(
    'getExecutorsStatus 数据正确（2 ready）',
    () => {
      if (r1Details.summary.total !== 2) {
        throw new Error(
          `summary.total 应为 2，实际 ${r1Details.summary.total}`,
        );
      }
      if (r1Details.summary.ready !== 2) {
        throw new Error(
          `summary.ready 应为 2（两个 ok=true），实际 ${r1Details.summary.ready}`,
        );
      }
      if (r1Details.summary.missing !== 0) {
        throw new Error(
          `summary.missing 应为 0，实际 ${r1Details.summary.missing}`,
        );
      }
      if (r1Details.executors.length !== 2) {
        throw new Error(
          `executors.length 应为 2，实际 ${r1Details.executors.length}`,
        );
      }
      return { total: 2, ready: 2, missing: 0, executorCount: 2 };
    },
  );

  // 验证 3：generateInteractionReply() 应该抛 InternalServerErrorException
  const r2 = await check('generateInteractionReply 抛错', async () => {
    try {
      const r = await service.generateInteractionReply({
        sourceText: '测',
        targetName: '张三',
        accountName: '测试号',
      });
      // 如果没抛，返回的就是 bug
      throw new Error(
        `应该抛错但返了：${JSON.stringify(r).slice(0, 100)}`,
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'InternalServerErrorException') {
        return {
          exceptionName: err.name,
          message: err.message.slice(0, 100) + '...',
        };
      }
      throw err;
    }
  });

  console.log(JSON.stringify({ r1, r1Logic, r2 }, null, 2));

  const allPass = [r1, r1Logic, r2].every((r) => r.status === 'PASS');
  console.log(
    allPass
      ? '\n✅ 全部 PASS — P3-D4 bug 修复正确'
      : '\n❌ 有失败 — 修法有问题，需要再查',
  );
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本执行失败：', err);
  process.exit(1);
});
