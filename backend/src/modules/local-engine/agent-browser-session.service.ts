import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LocalBrowserEngine } from './local-browser-engine.service';
import {
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
export class AgentBrowserSessionService {
  private readonly logger = new Logger(AgentBrowserSessionService.name);
  private readonly sessions = new Map<string, AgentBrowserSession>();

  constructor(private readonly browser: LocalBrowserEngine) {}

  /** 创建会话（不立即启动浏览器，run 时懒创建） */
  create(
    ownerId: string,
    input: CreateAgentBrowserSessionInput = {},
  ): AgentBrowserSessionDto {
    const now = new Date().toISOString();
    const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
    const startOrigin = input.startUrl
      ? this.extractOrigin(input.startUrl)
      : undefined;
    const allowDomains =
      input.allowDomains && input.allowDomains.length > 0
        ? input.allowDomains
        : startOrigin
          ? [startOrigin]
          : [];

    const session: AgentBrowserSession = {
      id: randomUUID(),
      accountId: `${engineAccountPrefix}-${randomUUID().slice(0, 8)}`,
      status: 'created',
      url: input.startUrl,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      stepCount: 0,
      engineKey: '',
      allowDomains,
      lease: {
        acquiredAt: now,
        expiresAt: new Date(Date.now() + leaseMs).toISOString(),
        ownerId,
      },
    };
    this.sessions.set(session.id, session);
    this.logger.log(
      `AgentBrowser 会话创建 ${session.id} 域名白名单=${allowDomains.join(',') || '(未配置,导航需确认)'}`,
    );
    return this.toDto(session);
  }

  get(id: string): AgentBrowserSession {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException('Agent Browser 会话不存在');
    return session;
  }

  list(): AgentBrowserSessionDto[] {
    return [...this.sessions.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((s) => this.toDto(s));
  }

  /** 会话进入运行态前：懒创建引擎会话（复用 general-web） */
  async acquireEngineSession(id: string): Promise<{ engineKey: string }> {
    const session = this.get(id);
    this.assertLeaseValid(session);

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
    return { engineKey: engine.key };
  }

  updateStatus(id: string, status: AgentBrowserSessionStatus): void {
    const session = this.get(id);
    session.status = status;
    session.updatedAt = new Date().toISOString();
    session.lastActivityAt = session.updatedAt;
  }

  markError(id: string, error: string): void {
    const session = this.get(id);
    session.status = 'error';
    session.error = error;
    session.updatedAt = new Date().toISOString();
  }

  bumpStep(id: string): void {
    const session = this.get(id);
    session.stepCount += 1;
    session.lastActivityAt = new Date().toISOString();
  }

  /** 租约续期 */
  renewLease(id: string, leaseMs = DEFAULT_LEASE_MS): void {
    const session = this.get(id);
    session.lease!.expiresAt = new Date(Date.now() + leaseMs).toISOString();
    session.updatedAt = new Date().toISOString();
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
    return dto;
  }
}