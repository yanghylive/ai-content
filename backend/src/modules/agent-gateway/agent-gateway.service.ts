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
        ? { idempotency: new PrismaIdempotencyStore(this.prisma), approvals: new PrismaApprovalStore(this.prisma) }
        : {}),
      usageSink: this.persist ? (ev) => this.usageSink.record(ev) : undefined,
      mirror: this.persist ? this.mirror : undefined,
      outboxDb: this.persist ? this.outboxStore : undefined,
      // 真实 Octop 适配器：显式 OCTOP_ENABLED=true 启用（凭据 OCTOP_USERNAME/OCTOP_PASSWORD，避免测试环境误启）
      octop: process.env.OCTOP_ENABLED === 'true' ? new RealOctopAdapter() : undefined,
      // 真实 3010 业务工具：显式 AGENT_GATEWAY_REAL_BUSINESS=true 启用。
      // RealBusinessTools（crm/lead/report 真实）+ RealContentTools（content_generate/review/
      // lead_normalize 真实；publish/interaction 明确失败禁止假成功）合并注册。
      business:
        process.env.AGENT_GATEWAY_REAL_BUSINESS === 'true'
          ? (() => {
              const merged = new (require('./adapters/business-tools').BusinessToolRegistry)();
              const biz = this.realBusiness?.build();
              if (biz) for (const n of biz.list()) merged.register(n, biz.get(n)!);
              const content = this.realContent?.build();
              if (content) for (const n of content.list()) merged.register(n, content.get(n)!);
              return merged;
            })()
          : undefined,
      // 真实 Kaypal 远程长期记忆：显式 AGENT_GATEWAY_REAL_MEMORY=true 启用
      // （凭据 KAYPAL_AUTH_BASE_URL/KAYPAL_API_KEY + KAYPAL_TEST_PHONE/PASSWORD 换 Bearer token；
      //   生产实测：Bearer desktop token 200，api-key 需 kaypal-ai KAYPAL_API_KEYS 未配置 → 401 → 走 tokenProvider）
      memoryRemote:
        process.env.AGENT_GATEWAY_REAL_MEMORY === 'true' &&
        process.env.KAYPAL_API_KEY &&
        (process.env.KAYPAL_AUTH_BASE_URL || process.env.KAYPAL_BASE_URL)
          ? new RealKaypalMemoryAdapter({
              baseUrl: process.env.KAYPAL_AUTH_BASE_URL || process.env.KAYPAL_BASE_URL!,
              apiKey: process.env.KAYPAL_API_KEY,
              tokenProvider: async () => {
                const phone = process.env.KAYPAL_TEST_PHONE;
                const password = process.env.KAYPAL_TEST_PASSWORD;
                if (!phone || !password) return undefined;
                const res = await fetch(
                  `${process.env.KAYPAL_AUTH_BASE_URL || process.env.KAYPAL_BASE_URL}/api/desktop-auth/password`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-kaypal-api-key': process.env.KAYPAL_API_KEY!, accept: 'application/json' },
                    body: JSON.stringify({ phone, password, device_id: '3010-memory', device_name: '3010-memory', platform: 'desktop' }),
                    signal: AbortSignal.timeout(10_000),
                  },
                );
                if (!res.ok) return undefined;
                const d = (await res.json()) as Record<string, unknown>;
                return String(d.access_token ?? d.accessToken ?? '') || undefined;
              },
            })
          : undefined,
      // P1-3 余额/资格门禁：trial 模式（无商用执行权）下高风险写工具 → paused_insufficient_balance。
      // 语义对齐 PRD §9「余额不足进入 paused_insufficient_balance，不丢上下文」——
      // 用本地 planMode 作代理判定（trial=有阻断；commercial/授权=放行）。
      balanceGate:
        process.env.AGENT_GATEWAY_BALANCE_GATE === 'true'
          ? async (ctx, spec) => {
              try {
                const u = await this.prisma.user.findUnique({ where: { id: ctx.userId } });
                // 本地查不到用户（如 kaypal 正式账号未同步本地 users）→ fail-open 放行，
                // 避免误拦有商用权限的外部账号；只有明确 trial 且无商用执行权才拦截
                if (!u) return { ok: true };
                const trial = !u.commercialExecutionAllowed && u.planMode === 'trial';
                if (trial && spec.risk === 'high') {
                  return { ok: false, reason: 'trial 模式不开放高风险写工具，请升级商用套餐或充值' };
                }
                return { ok: true };
              } catch {
                // 用户查询失败：fail-open 放行（避免误伤；余额语义由 Kaypal 账务兜底）
                return { ok: true };
              }
            }
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
      // eslint-disable-next-line no-console
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
