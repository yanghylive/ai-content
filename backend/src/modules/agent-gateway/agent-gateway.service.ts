import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createAgentGateway } from './core/factory';
import { PrismaIdempotencyStore } from './prisma-store/prisma-idempotency.store';
import { PrismaApprovalStore } from './prisma-store/prisma-approval.store';
import { PrismaUsageSink } from './prisma-store/prisma-usage.sink';
import { PrismaMirror } from './prisma-store/prisma-mirror';
import { PrismaHydrator } from './prisma-store/prisma-hydrator';
import { PrismaOutboxStore } from './prisma-store/prisma-outbox.store';
import { RealOctopAdapter } from './adapters/real-octop-adapter';
import { RealBusinessTools } from './adapters/real-business-tools';
import { RealContentTools } from './adapters/real-content-tools';
import { RealKaypalMemoryAdapter } from './adapters/real-kaypal-memory';
import { BusinessToolRegistry } from './adapters/business-tools';
import { Optional } from '@nestjs/common';

/**
 * Agent Gateway 服务：单例持有核心引擎实例。
 * 持久化开关：env `AGENT_GATEWAY_PERSISTENCE=prisma` 时——
 * - 幂等/审批走 DB（agent_gateway_tool_calls / agent_gateway_approvals）
 * - usage 落库（agent_gateway_usage_events，计费对账副本）
 * - 写路径镜像（session/task/event/artifact → agent_gateway_*，内存态仍权威）
 * - 启动 onModuleInit 从 DB 反灌内存（重启恢复：只恢复 active 未过期会话及其资源）
 * 默认内存态（与原型一致）。
 */
@Injectable()
export class AgentGatewayService implements OnModuleInit, OnModuleDestroy {
  readonly engine: ReturnType<typeof createAgentGateway>;
  private readonly persist: boolean;
  private readonly usageSink: PrismaUsageSink;
  private readonly mirror: PrismaMirror;
  private readonly hydrator: PrismaHydrator;
  private readonly outboxStore: PrismaOutboxStore;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realBusiness?: RealBusinessTools,
    @Optional() private readonly realContent?: RealContentTools,
  ) {
    this.persist = process.env.AGENT_GATEWAY_PERSISTENCE === 'prisma';
    this.usageSink = new PrismaUsageSink(this.prisma);
    this.mirror = new PrismaMirror(this.prisma);
    this.hydrator = new PrismaHydrator(this.prisma);
    this.outboxStore = new PrismaOutboxStore(this.prisma);
    this.engine = createAgentGateway({
      ...(this.persist
        ? {
            idempotency: new PrismaIdempotencyStore(this.prisma),
            approvals: new PrismaApprovalStore(this.prisma),
          }
        : {}),
      usageSink: this.persist ? (ev) => this.usageSink.record(ev) : undefined,
      mirror: this.persist ? this.mirror : undefined,
      outboxDb: this.persist ? this.outboxStore : undefined,
      // 真实 Octop 适配器：默认启用（内部自带降级——healthy 探活 / 503 降级 token-only / 无凭据回退能力探测）。
      // 仅显式 OCTOP_ENABLED=false 才禁用（退回 Mock）。审计 #2：不能再靠 OCTOP_ENABLED=true 才启用，
      // 否则打包环境默认走 Mock/降级适配器，深度 Agent Gateway 控制形同虚设。
      octop:
        process.env.OCTOP_ENABLED === 'false'
          ? undefined
          : new RealOctopAdapter(),
      // 真实 3010 业务工具：默认启用（审计 #3 大王令「真实业务工具默认打开」）。
      // RealBusinessTools（crm/lead/report 真实）+ RealContentTools（content_generate/review/
      // lead_normalize 真实；publish/interaction 明确失败禁止假成功）合并注册。
      // 仅显式 AGENT_GATEWAY_REAL_BUSINESS=false 才退回 mock（测试环境用）。
      business:
        process.env.AGENT_GATEWAY_REAL_BUSINESS === 'false'
          ? undefined
          : (() => {
              const merged = new BusinessToolRegistry();
              const biz = this.realBusiness?.build();
              if (biz)
                for (const n of biz.list()) merged.register(n, biz.get(n)!);
              const content = this.realContent?.build();
              if (content)
                for (const n of content.list())
                  merged.register(n, content.get(n)!);
              return merged;
            })(),
      // 真实 Kaypal 远程长期记忆：默认启用（审计 #3 大王令「真实 Memory 默认打开」），
      // 但仍需 KAYPAL_API_KEY + 鉴权端点才实例化（缺则优雅降级为本地 Mock）。
      // 鉴权优先级（与 RealKaypalMemoryAdapter.authHeaders 一致）：
      //   1) 每请求级用户 token（ctx.kaypalAccessToken，KaypalAuthGuard 已验签）→ 最佳，按用户隔离；
      //   2) 直配服务 token KAYPAL_MEMORY_TOKEN（kda_ 形态，优先于账号登录交换）；
      //   3) 账号密码交换 KAYPAL_MEMORY_PHONE/PASSWORD → 服务账号换 kda_ token（兜底）。
      // 注意：不再使用 KAYPAL_TEST_* 测试凭据，避免生产记忆路径混入测试语义。
      memoryRemote:
        process.env.AGENT_GATEWAY_REAL_MEMORY !== 'false' &&
        process.env.KAYPAL_API_KEY &&
        (process.env.KAYPAL_AUTH_BASE_URL || process.env.KAYPAL_BASE_URL)
          ? new RealKaypalMemoryAdapter({
              baseUrl:
                process.env.KAYPAL_AUTH_BASE_URL ||
                process.env.KAYPAL_BASE_URL!,
              apiKey: process.env.KAYPAL_API_KEY,
              tokenProvider: async () => {
                // 优先直配服务 token（kda_），避免账号密码交换
                const directToken = process.env.KAYPAL_MEMORY_TOKEN?.trim();
                if (directToken) return directToken;
                const phone = process.env.KAYPAL_MEMORY_PHONE?.trim();
                const password = process.env.KAYPAL_MEMORY_PASSWORD?.trim();
                if (!phone || !password) return undefined;
                const res = await fetch(
                  `${process.env.KAYPAL_AUTH_BASE_URL || process.env.KAYPAL_BASE_URL}/api/desktop-auth/password`,
                  {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      'x-kaypal-api-key': process.env.KAYPAL_API_KEY!,
                      accept: 'application/json',
                    },
                    body: JSON.stringify({
                      phone,
                      password,
                      device_id: '3010-memory',
                      device_name: '3010-memory',
                      platform: 'desktop',
                    }),
                    signal: AbortSignal.timeout(10_000),
                  },
                );
                if (!res.ok) return undefined;
                const d = (await res.json()) as Record<string, unknown>;
                return (
                  String(
                    (d.access_token as string) ??
                      (d.accessToken as string) ??
                      '',
                  ) || undefined
                );
              },
            })
          : undefined,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.persist) return;
    // 重启恢复：写路径镜像的读侧（DB → 内存）
    const data = await this.hydrator.hydrate();
    this.engine.gateway.hydrate(data);
    // outbox 续跑：恢复 pending/dead 记录，worker 自动重试
    const pending = await this.outboxStore.loadPending();
    this.engine.memory.hydrateOutbox(pending);
    if (data.sessions.length > 0 || pending.length > 0) {
      console.log(
        `[agent-gateway] 恢复 ${data.sessions.length} 会话 / ${data.tasks.length} 任务 / ${data.events.length} 事件 / ${pending.length} outbox`,
      );
    }
  }

  get gateway() {
    return this.engine.gateway;
  }
  get bus() {
    return this.engine.bus;
  }
  get memory() {
    return this.engine.memory;
  }
  get registry() {
    return this.engine.registry;
  }

  onModuleDestroy() {
    // 优雅关闭 outbox 后台 worker
    this.engine.stopOutboxWorker?.();
  }
}
