import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveProjectDataPath } from '../../common/project-paths';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { LocalBrowserEngine } from './local-browser-engine.service';
import {
  AgentBrowserEvent,
  AgentBrowserSession,
  AgentBrowserSessionDto,
  AgentBrowserSessionStatus,
  CreateAgentBrowserSessionInput,
} from './agent-browser.types';

const DEFAULT_LEASE_MS = 30 * 60 * 1000; // 30 分钟
/** 每会话独立引擎 accountId（复用 general-web，不碰社媒登录态） */
const engineAccountPrefix = 'agent-browser';

/**
 * P4 AgentBrowserSessionService（文档 §7.4）：
 * Profile、租约和生命周期。会话为内存态（重启丢失，可接受灰度语义），
 * 引擎层复用 LocalBrowserEngine 的 general-web 持久会话。
 */
@Injectable()
export class AgentBrowserSessionService implements OnModuleInit {
  private readonly logger = new Logger(AgentBrowserSessionService.name);
  private readonly sessions = new Map<string, AgentBrowserSession>();
  /** P4 持久化：会话/事件落盘路径（进程重启可恢复审计与证据链） */
  private readonly storePath: string;

  constructor(
    private readonly browser: LocalBrowserEngine,
    private readonly prisma?: PrismaService,
    private readonly authRequestContext?: AuthRequestContextService,
  ) {
    // 测试可设 AGENT_BROWSER_STORE_PATH 隔离；生产用项目数据目录
    this.storePath =
      process.env.AGENT_BROWSER_STORE_PATH ??
      resolveProjectDataPath('agent-browser', 'sessions.json');
  }

  onModuleInit(): void {
    this.loadFromDisk();
  }

  /** 启动时从磁盘恢复会话（可恢复状态保留；引擎失效的活跃态置 stopped，事件保留） */
  private loadFromDisk(): void {
    try {
      if (!existsSync(this.storePath)) return;
      const raw = readFileSync(this.storePath, 'utf8');
      const list = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(list)) return;
      // P1（复查第二轮）：可恢复状态保留原状——paused/needs-human 可 resume
      // 断点续跑、partial_success 可重新 run（断点在 pending 上下文里已落盘）；
      // 只有 running/created 等执行中状态才因引擎失效置 stopped（执行已断）。
      const recoverable: readonly string[] = [
        'paused',
        'needs-human',
        'partial_success',
      ];
      for (const item of list) {
        const session = item as unknown as AgentBrowserSession;
        if (!session?.id) continue;
        if (!recoverable.includes(session.status)) {
          session.status = 'stopped';
        }
        session.engineKey = '';
        session.updatedAt = new Date().toISOString();
        this.sessions.set(session.id, session);
      }
      this.logger.log(
        `Agent Browser 会话已从磁盘恢复 ${this.sessions.size} 个（paused/needs-human/partial_success 保留可恢复，其余置 stopped）`,
      );
    } catch (error) {
      this.logger.warn(
        `Agent Browser 会话恢复失败（忽略，重新开始）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 落盘（每次状态变更调用，保证审计链不丢） */
  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      const list = [...this.sessions.values()].map((s) => ({
        ...s,
        engineKey: '', // 不持久化引擎句柄（重启失效）
      }));
      writeFileSync(this.storePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn(
        `Agent Browser 会话持久化失败（不阻断）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 创建会话（不立即启动浏览器，run 时懒创建） */
  create(
    ownerId: string,
    input: CreateAgentBrowserSessionInput = {},
    tenantId?: string,
  ): AgentBrowserSessionDto {
    const now = new Date().toISOString();
    const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
    const startOrigin = input.startUrl
      ? this.extractOrigin(input.startUrl)
      : undefined;
    // 显式 allowDomains 完全覆盖；未显式时 = startOrigin + 全局白名单（§14.2）
    const globalDomains = (process.env.AGENT_BROWSER_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const allowDomains =
      input.allowDomains && input.allowDomains.length > 0
        ? [...new Set(input.allowDomains)]
        : [
            ...new Set([
              ...(startOrigin ? [startOrigin] : []),
              ...globalDomains,
            ]),
          ];

    const session: AgentBrowserSession = {
      id: randomUUID(),
      accountId: `${engineAccountPrefix}-${randomUUID().slice(0, 8)}`,
      status: 'created',
      url: input.startUrl,
      tenantId: undefined,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      stepCount: 0,
      engineKey: '',
      allowDomains,
      events: [],
      lease: {
        acquiredAt: now,
        expiresAt: new Date(Date.now() + leaseMs).toISOString(),
        ownerId,
        tenantId,
      },
    };
    this.sessions.set(session.id, session);
    this.logger.log(
      `AgentBrowser 会话创建 ${session.id} 域名白名单=${allowDomains.join(',') || '(未配置,导航需确认)'}`,
    );
    this.persist();
    return this.toDto(session);
  }

  get(id: string): AgentBrowserSession {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException('Agent Browser 会话不存在');
    return session;
  }

  /** P4 安全：校验会话所有者（防 IDOR——知道 sessionId 不能操作他人会话） */
  assertOwner(
    id: string,
    ownerId: string,
    tenantId?: string,
  ): AgentBrowserSession {
    const session = this.get(id);
    // P1（复查 2026-08-22）：fail-closed——历史会话缺失 ownerId/tenantId 时
    // 一律拒绝（不允许"字段缺失就放行"），防止借旧数据绕过隔离
    if (!session.lease?.ownerId) {
      throw new ForbiddenException(
        '会话缺少所有者信息（历史异常数据），禁止访问',
      );
    }
    if (session.lease.ownerId !== ownerId) {
      throw new ForbiddenException('无权访问该 Agent Browser 会话');
    }
    // 租户级隔离：请求租户必须与会话租约一致（多租户用户跨租户访问阻断）
    if (tenantId) {
      if (!session.lease.tenantId) {
        throw new ForbiddenException(
          '会话缺少租户信息（历史异常数据），禁止访问',
        );
      }
      if (session.lease.tenantId !== tenantId) {
        throw new ForbiddenException('无权访问其他租户的 Agent Browser 会话');
      }
    }
    return session;
  }

  /**
   * §7.4 租户 fail-closed：用请求租户上下文（x-tenant-id / membership）解析。
   * 无登录上下文、无租户归属、DB 异常 → 抛 403/401（不允许回落宽松模式）。
   */
  async resolveTenantId(userId: string): Promise<string> {
    if (this.authRequestContext) {
      return await this.authRequestContext.resolveTenantId(this.prisma!);
    }
    // 无上下文服务（测试/单租户兼容）：显式单租户才放行，否则拒绝
    try {
      const delegate = (
        this.prisma as unknown as {
          tenantMember?: {
            findFirst?: (args: {
              where: { userId: string };
              select: { tenantId: boolean };
            }) => Promise<{ tenantId: string } | null>;
          };
        }
      )?.tenantMember;
      if (!delegate?.findFirst) {
        throw new ForbiddenException(
          '缺少租户上下文，Agent Browser 会话无法确定租户归属',
        );
      }
      const membership = await delegate.findFirst({
        where: { userId },
        select: { tenantId: true },
      });
      if (!membership?.tenantId) {
        throw new ForbiddenException(
          '当前账号未归属任何租户，不能创建 Agent Browser 会话',
        );
      }
      return membership.tenantId;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException(
        `租户解析失败（fail-closed）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 只返回当前用户（owner）+ 当前租户的会话——防跨用户/跨租户泄露 */
  list(ownerId: string, tenantId?: string): AgentBrowserSessionDto[] {
    return [...this.sessions.values()]
      .filter(
        (s) =>
          s.lease?.ownerId === ownerId &&
          // P4-4（审计 2026-08-22）：fail-closed——请求带租户时，
          // 无 tenantId 的旧会话不返回（不允许继续操作）
          (!tenantId || s.lease?.tenantId === tenantId),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((s) => this.toDto(s));
  }

  /** 对外 DTO（剔除 engineKey/ownerId 等内部字段）——controller 响应统一走这里 */
  toPublicDto(s: AgentBrowserSession): AgentBrowserSessionDto {
    return this.toDto(s);
  }

  /** 会话进入运行态前：懒创建引擎会话（复用 general-web） */
  async acquireEngineSession(id: string): Promise<{ engineKey: string }> {
    const session = this.get(id);
    this.assertLeaseValid(session);

    // P4-4（审计 2026-08-22）：先解析租户（fail-closed），失败则不启动浏览器、
    // 不置 running（避免留下脏的 running 会话 + 已启动浏览器）。
    if (!session.lease?.tenantId) {
      session.lease!.tenantId = await this.resolveTenantId(
        session.lease?.ownerId ?? '',
      );
    }

    // 引擎会话以 platform-accountId 为 key，每 agent 会话独立 accountId 实现隔离
    const engine = await this.browser.getOrCreateSession({
      platform: 'general-web',
      accountId: session.accountId,
    });
    session.engineKey = engine.key;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;
    if (session.url && engine.page.url() !== session.url) {
      try {
        await engine.page.goto(session.url, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
      } catch (error) {
        this.logger.warn(
          `AgentBrowser 初始导航 ${session.url} 失败：${(error as Error).message}`,
        );
      }
    }
    this.logger.log(
      `AgentBrowser 会话 ${id} 引擎就绪 ${engine.key} 当前页 ${engine.page.url()}`,
    );
    this.persist();
    return { engineKey: engine.key };
  }

  /** P4-4（审计 2026-08-22）：状态机迁移校验——非法迁移抛 400 */
  assertTransition(
    id: string,
    from: AgentBrowserSessionStatus[],
    to: AgentBrowserSessionStatus,
  ): void {
    const session = this.get(id);
    if (!from.includes(session.status)) {
      throw new BadRequestException(
        `会话状态 ${session.status} 不能迁移到 ${to}（允许来源：${from.join('/')}）`,
      );
    }
  }

  /** P4-4：resume——校验 paused/needs-human，重新获取引擎会话（幂等复用） */
  async resume(id: string): Promise<void> {
    this.assertTransition(id, ['paused', 'needs-human'], 'running');
    // 重新 acquire：getOrCreateSession 幂等复用现有引擎；浏览器已退出时重新拉起
    await this.acquireEngineSession(id);
  }

  updateStatus(id: string, status: AgentBrowserSessionStatus): void {
    const session = this.get(id);
    session.status = status;
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;
    this.persist();
  }

  markError(id: string, error: string): void {
    const session = this.get(id);
    session.status = 'error';
    session.error = error;
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  bumpStep(id: string): void {
    const session = this.get(id);
    session.stepCount += 1;
    session.lastActivityAt = new Date().toISOString();
    this.persist();
  }

  /** 记录循环事件（Observe-Act-Verify 过程） */
  appendEvent(id: string, event: Omit<AgentBrowserEvent, 'at'>): void {
    const session = this.get(id);
    session.events.push({ ...event, at: new Date().toISOString() });
    // 事件缓冲上限（防内存膨胀）
    if (session.events.length > 500) {
      session.events.splice(0, session.events.length - 500);
    }
    session.lastActivityAt = new Date().toISOString();
    this.persist();
  }

  listEvents(id: string): AgentBrowserEvent[] {
    return this.get(id).events;
  }

  /** 租约续期 */
  renewLease(id: string, leaseMs = DEFAULT_LEASE_MS): void {
    const session = this.get(id);
    session.lease!.expiresAt = new Date(Date.now() + leaseMs).toISOString();
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  async stop(id: string): Promise<void> {
    const session = this.get(id);
    if (session.engineKey) {
      try {
        await this.browser.closeSession(session.engineKey);
      } catch (error) {
        this.logger.warn(
          `AgentBrowser 关闭引擎会话失败：${(error as Error).message}`,
        );
      }
      session.engineKey = '';
    }
    session.status = 'stopped';
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  private assertLeaseValid(session: AgentBrowserSession): void {
    if (
      session.lease &&
      new Date(session.lease.expiresAt).getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'Agent Browser 会话租约已过期，请重新创建或续期',
      );
    }
  }

  private extractOrigin(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private toDto(s: AgentBrowserSession): AgentBrowserSessionDto {
    const { engineKey: _engineKey, ...dto } = s;
    // 剔除 ownerId（防跨用户信息泄露）；保留租约其余字段（过期时间等）
    if (dto.lease) {
      const { ownerId: _ownerId, ...leaseRest } = dto.lease;
      dto.lease = leaseRest as AgentBrowserSessionDto['lease'];
    }
    return dto;
  }
}
