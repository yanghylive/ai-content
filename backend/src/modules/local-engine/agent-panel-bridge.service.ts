import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDesktopUserDataDir } from '../../common/project-paths';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

/**
 * AgentPanelBridgeService — 3011 ⇄ desktop 右侧浏览器面板的**上行**通道。
 *
 * 为什么用文件而不是 env 注入：3011 **不一定由 desktop 启动**（desktop 的
 * startBackendService 在 3011 端口已被占用时会跳过启动），env 注入子进程
 * 这条路覆盖不到"后端已经在外头跑着"的场景。改为 desktop 把
 * `{ endpoint, token }` 写进 userData 下的 0600 文件（见
 * desktop/browser-panel-bridge-registry.js），3011 按需读取。
 *
 * 安全边界：
 *  - 读取时**强制 chmod 0600**（存量文件历史上落过 0644，只在创建时 chmod
 *    覆盖不到，会让本机任意进程读到 token）——同 local-mcp-auth.ts 的 S5 修复；
 *  - endpoint 必须是回环 http，非回环直接判不可用；
 *  - 文件缺失 / 形状非法 / 老化 / 请求失败 → 一律 `available:false`，
 *    **不重试、不降级、不伪造成功**（AGENTS.md：不得静默降级）；
 *  - token 只在本服务内存里，不进日志、不进事件、不进证据。
 */
export const PANEL_BRIDGE_PROTOCOL = 'kaypal-browser-bridge';

/**
 * 阶段 6 决策 ②：面板确认单落进 AgentConfirmation 表时打的来源标记。
 * 两个用途：
 *  1. 审计/排障时能一眼区分"用户在桌面面板批的"和"在后端确认列表批的"；
 *  2. 组装 session.confirmations 时据此**排除**面板单——它已经在面板上批过了，
 *     不能再出现在后端的"待你确认"里（否则两个审批入口，违背合并的初衷）。
 */
export const PANEL_CONFIRMATION_SOURCE = 'browser-panel';

/** 面板 CDP 方法 → 人话标签（进 confirmationJson.targetLabel，排障可读） */
export function describePanelMethod(method: string): string {
  switch (method) {
    case 'Page.navigate':
      return '打开网页';
    case 'Input.dispatchMouseEvent':
      return '鼠标点击';
    case 'Input.dispatchKeyEvent':
      return '键盘输入';
    case 'Input.insertText':
      return '输入文字';
    default:
      return method;
  }
}

/** 是否面板来源的确认单（persist mixin 过滤用；confirmationJson 形状不保证，要防御） */
export function isPanelConfirmation(confirmationJson: unknown): boolean {
  if (!confirmationJson || typeof confirmationJson !== 'object') return false;
  return (
    (confirmationJson as { source?: unknown }).source ===
    PANEL_CONFIRMATION_SOURCE
  );
}
/**
 * AiBrowserAction.action → 面板 CDP 方法（合并后 loop 用它比对确认单指纹）。
 * **当前桥只开通了 goto**，其余写动作也给出映射但 executor 会明确拦下
 * （"暂不支持"）；未列出的动作返回 null = 闸门不放行（fail-closed），
 * 不给"我猜它大概是哪个方法"留口子。
 */
export function panelMethodForAction(action: string): string | null {
  switch (action) {
    case 'goto':
      return 'Page.navigate';
    case 'click':
      return 'Input.dispatchMouseEvent';
    case 'type':
      return 'Input.insertText';
    case 'press_key':
      return 'Input.dispatchKeyEvent';
    // 阶段 7 round11：tabs 走主进程伪 method（broker 的 tabsHandler → manager
    // 原生 tab 台账，不经 CDP debugger）；loop 闸门按此指纹比对确认单。
    case 'tabs':
      return 'Panel.tabs';
    default:
      return null;
  }
}

const REGISTRY_FILE_NAME = 'browser-panel-bridge.json';
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const NONCE_HEADER = 'x-kaypal-bridge-nonce';
const TS_HEADER = 'x-kaypal-bridge-ts';
/** 老化阈值：与 desktop 侧一致，兜底"desktop 崩了没来得及删文件" */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
/** 文件读缓存（避免每个动作都打一次磁盘） */
const CACHE_TTL_MS = 1000;
const REQUEST_TIMEOUT_MS = 3000;
/**
 * 2026-09-03（round16 真实任务全链 P1）：大 payload 只读动作超时放宽。
 * Page.captureScreenshot 回传整页 PNG base64（数百 KB 级），3s 全局超时在
 * 真机全链（3013 dom-agent 循环 × 面板桥）实测必超时 → 动作失败
 * （partial_success）。其余小 payload 动作维持 3s 快速失败不变。
 */
const EXECUTE_SLOW_TIMEOUT_MS = 10_000;
const EXECUTE_SLOW_METHODS = new Set<string>(['Page.captureScreenshot']);

export type PanelBridgeActor = { ownerId: string; tenantId: string };

export type PanelBridgeBinding = {
  panelId: string | null;
  sessionId: string | null;
  webContentsId: number | null;
  url: string | null;
};

export type PanelBridgeStatus = {
  available: boolean;
  reason: string;
  endpoint?: string;
  panelId?: string | null;
  sessionId?: string | null;
  webContentsId?: number | null;
  ageMs?: number;
};

export type PanelObserveResult = {
  binding: PanelBridgeBinding;
  title: string | null;
  textSample: string | null;
};

export type PanelActionTicket = {
  actionId: string;
  binding: { webContentsId: number | null; method: string };
  /**
   * TraeWork 控制权模型：系统控制（默认）下桌面侧已用 owner 通道自动批准这张
   * 单——executor 拿到 true 就直接执行，不再返回"待批准"回执让用户点批重试。
   * 用户接管（control='user'）时桥回 false/缺省，走既有人工审批排队路径。
   */
  autoApproved?: boolean;
};

export type PanelExecuteResult = {
  binding: PanelBridgeBinding;
  method: string;
  executed: boolean;
  actionId: string | null;
  /** 写动作恒为 null（桥不回传原始 CDP 结果，避免页面内容/凭据带回后端） */
  result: unknown;
};

export type PanelPendingAction = {
  actionId: string;
  method: string;
  summary: unknown;
  createdAt?: number;
};

/**
 * 确认单状态（阶段 6 起三态 + 不存在）：
 *  pending=待用户批准 / approved=已批准待执行 / rejected=用户已拒绝（终态） /
 *  none=不存在或已消费（执行后桥直接删单，故"已执行"表现为 none）
 */
export type PanelActionState = 'pending' | 'approved' | 'rejected' | 'none';

export type PanelActionStateResult = {
  actionId: string;
  state: PanelActionState;
  panelId: string | null;
  method: string | null;
  approvedAt?: number | null;
  rejectedAt?: number | null;
  binding?: { webContentsId?: number | null; sessionId?: string | null };
};

export class PanelBridgeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(message || code);
    this.name = 'PanelBridgeError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 2026-09-04：桥拒绝 code → 面向用户的修复提示（拼进动作失败消息）。
 * 只收保守白名单；未知 code 不加提示（不瞎猜）。
 */
const PANEL_REJECT_HINTS: Record<string, string> = {
  TOKEN_EXPIRED: '面板授权已过期，请在应用内重新打开浏览器面板后重试',
  TOKEN_INVALID: '面板授权无效，请在应用内重新打开浏览器面板后重试',
  PANEL_NOT_FOUND: '浏览器面板未打开，请先在应用内打开面板后重试',
};

type RegistryFile = {
  version?: number;
  protocol?: string;
  endpoint?: string;
  token?: string;
  panelId?: string | null;
  sessionId?: string | null;
  webContentsId?: number | null;
  pid?: number;
  startedAt?: string;
};

type CachedRegistry = {
  at: number;
  value: {
    endpoint: string;
    token: string;
    panelId: string | null;
    sessionId: string | null;
    webContentsId: number | null;
    ageMs: number;
  } | null;
};

const LOOPBACK_ENDPOINT = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

@Injectable()
export class AgentPanelBridgeService {
  private readonly logger = new Logger(AgentPanelBridgeService.name);
  private cache: CachedRegistry | null = null;

  /**
   * @param prisma 可选注入。**阶段 6 决策 ②**：注入时，面板确认单会落库成
   *   `AgentConfirmation` 行（用桥的 actionId 当主键，全链路只有一个 id）。
   *   未注入（老测试 / 未接库的环境）时保持纯内存语义，行为不变。
   */
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** 凭据文件路径；推导不出 userData 目录时返回 null（fail-closed） */
  registryPath(): string | null {
    const explicit = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE?.trim();
    if (explicit) return explicit;
    const dir = resolveDesktopUserDataDir();
    if (!dir) return null;
    return join(dir, REGISTRY_FILE_NAME);
  }

  /**
   * 读取凭据（带 1s 缓存）。任何一步不合规都返回 null。
   * 返回 null 不等于"出错"，而是"面板不可用"——调用方据此走 fail-closed。
   */
  readCredentials(now = Date.now()) {
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.value;
    }
    const value = this.readCredentialsUncached(now);
    this.cache = { at: now, value };
    return value;
  }

  /** 丢弃缓存（测试用 / 桥重启后立即生效） */
  clearCache(): void {
    this.cache = null;
  }

  private readCredentialsUncached(now: number) {
    const filePath = this.registryPath();
    if (!filePath) return null;
    if (!existsSync(filePath)) return null;

    // 存量文件强制收紧权限（同 local-mcp-auth.ts：历史上有 0644 落盘的旧文件）
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows 无 POSIX mode
    }

    let parsed: RegistryFile;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as RegistryFile;
    } catch {
      return null;
    }

    if (parsed?.protocol !== PANEL_BRIDGE_PROTOCOL) return null;
    if (
      typeof parsed.endpoint !== 'string' ||
      !LOOPBACK_ENDPOINT.test(parsed.endpoint)
    ) {
      return null;
    }
    if (typeof parsed.token !== 'string' || !parsed.token) return null;

    const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : NaN;
    if (!Number.isFinite(startedAtMs)) return null;
    const ageMs = Math.max(0, now - startedAtMs);
    if (ageMs > DEFAULT_MAX_AGE_MS) return null;

    // 文件存在不代表进程还活着：pid 记录不一致时按老化处理
    if (typeof parsed.pid === 'number' && !this.isPidAlive(parsed.pid)) {
      return null;
    }

    return {
      endpoint: parsed.endpoint,
      token: parsed.token,
      panelId: parsed.panelId ?? null,
      sessionId: parsed.sessionId ?? null,
      webContentsId:
        typeof parsed.webContentsId === 'number' ? parsed.webContentsId : null,
      ageMs,
    };
  }

  /** pid 存活探测：signal 0 不发信号只探活；ESRCH=已死，EPERM=活着但没权限 */
  private isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return code === 'EPERM';
    }
  }

  /** 面板当前是否可用（不发起网络请求，只看凭据文件） */
  status(): PanelBridgeStatus {
    const credentials = this.readCredentials();
    if (!credentials) {
      return { available: false, reason: 'panel-not-open' };
    }
    return {
      available: true,
      reason: 'ready',
      endpoint: credentials.endpoint,
      panelId: credentials.panelId,
      sessionId: credentials.sessionId,
      webContentsId: credentials.webContentsId,
      ageMs: credentials.ageMs,
    };
  }

  /** 探活：真的打一次 /health（凭据存在但桥已关时返回 false） */
  async health(): Promise<boolean> {
    const credentials = this.readCredentials();
    if (!credentials) return false;
    try {
      const json = await this.call<{ ok?: boolean }>(
        credentials,
        '/health',
        'GET',
        undefined,
      );
      return json?.ok === true;
    } catch (error) {
      this.logger.debug(
        `面板桥探活失败（按不可用处理）：${(error as Error)?.message}`,
      );
      return false;
    }
  }

  /**
   * 只读观察：URL / 标题 / 正文摘要。
   * 返回的 binding 里带 webContentsId——调用方应把它钉进证据，
   * 证明"读的就是用户看到的那一个页面目标"。
   */
  async observe(actor: PanelBridgeActor): Promise<PanelObserveResult> {
    this.assertActor(actor);
    const credentials = this.requireCredentials();
    const json = await this.call<{
      binding?: Partial<PanelBridgeBinding>;
      title?: string | null;
      textSample?: string | null;
    }>(credentials, '/observe', 'POST', {
      panelId: credentials.panelId,
      actor,
    });
    return {
      binding: {
        panelId: json?.binding?.panelId ?? credentials.panelId ?? null,
        sessionId: json?.binding?.sessionId ?? credentials.sessionId ?? null,
        webContentsId:
          json?.binding?.webContentsId ?? credentials.webContentsId ?? null,
        url: json?.binding?.url ?? null,
      },
      title: json?.title ?? null,
      textSample: json?.textSample ?? null,
    };
  }

  /**
   * 申请写动作确认单——**只签发，不执行，也不自我批准**。
   * 批准权在用户（desktop 侧审批），本服务拿到的 actionId 只是"待批准票据"。
   */
  async requestAction(
    actor: PanelBridgeActor,
    input: {
      method: string;
      params?: Record<string, unknown>;
      summary?: Record<string, unknown>;
      /** 关联到的 AgentBrowser 会话 id（落库用，便于按会话回查） */
      sessionId?: string | null;
      /** 触达审计：动作归属线索 id（线索详情页「触达历史」反查键） */
      leadId?: string | null;
    },
  ): Promise<PanelActionTicket> {
    this.assertActor(actor);
    if (!input?.method || typeof input.method !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400);
    }
    const credentials = this.requireCredentials();
    // 审计对账（演示 2026-09-05 暴露的缺口）：桌面用户拒绝过的单过不了
    // resolveConfirmation 闸门，markApprovalSafe('rejected') 永远轮不到它——
    // 决定不落库，触达历史卡死 pending，重试还签新单（票堆积）。签新单前
    // 先问桥把该用户所有未决面板单收口：rejected→已拒绝、none→已失效。
    // 范围按用户而非会话：面板只有一个（桥是单实例事实源），换会话重跑的
    // 跨会话孤儿单同样要收口，否则永远挂在触达历史里"待你批准"。
    await this.reconcilePendingTickets(actor);
    const json = await this.call<{
      actionId?: string;
      binding?: { webContentsId?: number; method?: string };
      autoApproved?: boolean;
    }>(credentials, '/action-request', 'POST', {
      panelId: credentials.panelId,
      actor,
      method: input.method,
      params: input.params || {},
      summary: input.summary || {},
    });
    if (!json?.actionId) {
      throw new PanelBridgeError('NO_TICKET', 502, '桥未返回确认单');
    }
    // 阶段 6 决策 ②：合并两套确认机制 —— 面板确认单落库成 AgentConfirmation 行，
    // **主键直接用桥的 actionId**，于是桌面审批 UI、桥、后端、证据链四处是同一个
    // id，不再需要"面板 actionId ↔ 后端 confirmationId"的映射表。
    await this.persistTicket({
      id: json.actionId,
      actor,
      sessionId: input.sessionId ?? null,
      leadId: input.leadId ?? null,
      method: input.method,
      params: input.params || {},
      summary: input.summary || {},
      webContentsId: json.binding?.webContentsId ?? null,
    });
    return {
      actionId: json.actionId,
      binding: {
        webContentsId: json.binding?.webContentsId ?? null,
        method: json.binding?.method ?? input.method,
      },
      // 系统控制自动批准标记透传（缺省 false：老桥不带此字段 = 维持人工审批）
      autoApproved: json.autoApproved === true,
    };
  }

  /**
   * 2026-09-05 复核 P0-2：获客/互动 dispatch 链的单据状态回写（公开入口）。
   * dispatch 走引擎 Playwright 直接执行（不经桥 /execute 的 CDP 闸门消费），
   * 因此由执行器负责回写：执行前 in_use，成功 consumed，失败释放回 pending。
   * prisma 缺失/失败只 warn，不阻断业务（落库是审计旁路，同 persistTicket）。
   */
  async markInteractionTicket(
    actionId: string | null | undefined,
    status: 'in_use' | 'consumed' | 'pending',
  ): Promise<void> {
    return this.markTicket(actionId ?? null, status);
  }

  /**
   * 执行——**拿执行权不等于拿批准权**。
   * 写方法（Page.navigate / Input.*）必须带 actionId，且该确认单必须已被
   * desktop 用户在面板里批准；缺单/错单/换页后旧单 → 桥一律拒绝（fail-closed）。
   * 只读方法可直接执行（等价 observe 的能力，白名单由 Broker 把守）。
   */
  async execute(
    actor: PanelBridgeActor,
    input: {
      method: string;
      params?: Record<string, unknown>;
      actionId?: string | null;
    },
  ): Promise<PanelExecuteResult> {
    this.assertActor(actor);
    if (!input?.method || typeof input.method !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400);
    }
    const credentials = this.requireCredentials();
    // 落库语义对齐既有 AgentConfirmation 的两阶段锁定：执行前 pending→in_use
    // （并发只有一方抢到），执行成功才 consumed，失败释放回 pending 可重试。
    await this.markTicket(input.actionId ?? null, 'in_use');
    const json = await this.call<{
      binding?: Partial<PanelBridgeBinding>;
      method?: string;
      executed?: boolean;
      actionId?: string | null;
      result?: unknown;
    }>(
      credentials,
      '/execute',
      'POST',
      {
        panelId: credentials.panelId,
        actor,
        method: input.method,
        params: input.params || {},
        actionId: input.actionId ?? null,
      },
      EXECUTE_SLOW_METHODS.has(input.method)
        ? EXECUTE_SLOW_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS,
    );
    if (json?.executed === true) {
      await this.markTicket(input.actionId ?? null, 'consumed');
    } else {
      await this.markTicket(input.actionId ?? null, 'pending');
    }
    return {
      binding: {
        panelId: json?.binding?.panelId ?? credentials.panelId ?? null,
        sessionId: json?.binding?.sessionId ?? credentials.sessionId ?? null,
        webContentsId:
          json?.binding?.webContentsId ?? credentials.webContentsId ?? null,
        url: json?.binding?.url ?? null,
      },
      method: json?.method ?? input.method,
      executed: json?.executed === true,
      actionId: json?.actionId ?? input.actionId ?? null,
      result: json?.result ?? null,
    };
  }

  // ── 阶段 6 决策 ②：与 AgentConfirmation 合并（落库）──────────────────
  //
  // 设计要点：
  //  1. **零 migration**：AgentConfirmation 现有字段足够（confirmationJson 是
  //     Json，面板专属信息塞在里面，用 `source:'browser-panel'` 打标）。
  //  2. **主键 = 桥 actionId**：桌面审批 UI / 桥 / 后端 / 证据链四处同一个 id，
  //     不需要额外的映射表。
  //  3. **写库只发生在后端**：desktop 仍然不碰数据库（底座红线），它只持有
  //     "这一步能不能落在我看的那个页面上"的技术闸门。
  //  4. **不进既有待批列表**：面板单由用户在桌面面板上点批，不能同时出现在
  //     后端的"待你确认"列表里（否则两个审批入口，违背"合并成一套"）。
  //     过滤点在 local-engine.persist.mixin.ts 组装 session.confirmations 处。
  //  5. prisma 不可用 = 纯内存语义，**不阻断面板链路**（落库是审计旁路）。

  /**
   * 落库一张面板确认单。prisma 缺失/写失败只记 warn，不影响签单结果。
   */
  private async persistTicket(row: {
    id: string;
    actor: PanelBridgeActor;
    sessionId: string | null;
    leadId?: string | null;
    method: string;
    params: Record<string, unknown>;
    summary: Record<string, unknown>;
    webContentsId: number | null;
  }): Promise<void> {
    if (!this.prisma) return;
    const now = new Date();
    const confirmationJson = {
      id: row.id,
      source: PANEL_CONFIRMATION_SOURCE,
      sessionId: row.sessionId,
      // 触达审计：获客跟进动作归属的线索（无 = 通用任务动作，不进线索时间线）
      leadId: row.leadId ?? null,
      action: row.method,
      method: row.method,
      params: row.params,
      summary: row.summary,
      webContentsId: row.webContentsId,
      status: 'pending',
      riskLevel: 'medium',
      createdAt: now.toISOString(),
    };
    try {
      await this.prisma.agentConfirmation.upsert({
        where: { id: row.id },
        create: {
          id: row.id,
          tenantId: row.actor.tenantId,
          userId: row.actor.ownerId,
          sessionId: row.sessionId || row.id,
          action: row.method,
          status: 'pending',
          riskLevel: 'medium',
          target: row.webContentsId === null ? null : String(row.webContentsId),
          targetLabel: describePanelMethod(row.method),
          confirmationJson:
            confirmationJson as unknown as Prisma.InputJsonValue,
          createdAt: now,
        },
        update: {
          status: 'pending',
          confirmationJson:
            confirmationJson as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `面板确认单落库失败（${row.id}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 推进确认单状态。与既有 resolveConfirmation 的两阶段锁定同一套语义：
   * pending（待用户在面板点）→ in_use（执行中）→ consumed（已完成）。
   * 拒绝时由 markRejected 直接置 consumed（终态，不可翻案）。
   */
  private async markTicket(
    actionId: string | null,
    status: 'in_use' | 'consumed' | 'pending',
  ): Promise<void> {
    if (!actionId || !this.prisma) return;
    try {
      await this.prisma.agentConfirmation.updateMany({
        where: { id: actionId },
        data: {
          status,
          decidedAt: status === 'consumed' ? new Date() : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `面板确认单状态更新失败（${actionId} → ${status}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 用户在桌面面板点了「批准」——**两套确认机制合并的接缝**。
   *
   * 状态列（`status`）继续沿用既有两阶段锁定语义（pending→in_use→consumed，
   * 防并发复用），**审批态另写在 `confirmationJson.status`**（approved/rejected）。
   * 于是 loop 的 resolveConfirmation 认 `json.status === 'approved'` 的面板单放行：
   * 桌面点批和后端放行看的是**同一张单、同一个 id**，不再是两套。
   */
  async markApproved(actionId: string): Promise<void> {
    await this.patchConfirmationStatus(actionId, 'approved');
  }

  /** 用户在桌面面板点了「拒绝」：落库行收口为终态（status=consumed + json 标记） */
  async markRejected(actionId: string): Promise<void> {
    await this.markTicket(actionId, 'consumed');
    await this.patchConfirmationStatus(actionId, 'rejected');
  }

  /** 桌面桥已无此单（面板重启/会话销毁）：收口为 expired，触达历史显示「已失效」 */
  async markExpired(actionId: string): Promise<void> {
    await this.markTicket(actionId, 'consumed');
    if (!this.prisma) return;
    try {
      const row = await this.prisma.agentConfirmation.findUnique({
        where: { id: actionId },
        select: { confirmationJson: true },
      });
      if (!row) return;
      const prev =
        row.confirmationJson && typeof row.confirmationJson === 'object'
          ? (row.confirmationJson as Record<string, unknown>)
          : {};
      if (prev.status) return; // 已有决定不覆盖
      await this.prisma.agentConfirmation.update({
        where: { id: actionId },
        data: {
          confirmationJson: {
            ...prev,
            status: 'expired',
            decidedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `面板确认单失效收口失败（${actionId}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 签新单前对账：该会话在库的未决面板单逐张问桥的真实状态，把终态收口进库。
   * - rejected → markRejected（用户点过拒绝，决定此前无法回写）
   * - none     → markExpired（桌面重启票蒸发，孤儿单收口，防触达历史永远"待你批准"）
   * - approved/pending → 不动（重试带票执行 / 浮层继续等批）
   * 桥不可达 = 整体放弃对账（不阻断签新单，审计旁路语义与落库一致）。
   */
  private async reconcilePendingTickets(
    actor: PanelBridgeActor,
  ): Promise<void> {
    if (!this.prisma || !actor?.ownerId) return;
    let rows: Array<{ id: string; confirmationJson: unknown }>;
    try {
      rows = await this.prisma.agentConfirmation.findMany({
        where: { userId: actor.ownerId, status: 'pending' },
        select: { id: true, confirmationJson: true },
        take: 20,
      });
    } catch {
      return;
    }
    for (const row of rows) {
      if (!isPanelConfirmation(row.confirmationJson)) continue;
      const json = (row.confirmationJson || {}) as Record<string, unknown>;
      if (
        json.status === 'approved' ||
        json.status === 'rejected' ||
        json.status === 'expired'
      )
        continue;
      let state: string | null = null;
      try {
        state = (await this.actionState(actor, row.id)).state;
      } catch {
        return; // 桥不可达：放弃本轮对账
      }
      if (state === 'rejected') await this.markRejected(row.id);
      else if (state === 'none') await this.markExpired(row.id);
    }
  }

  /** 只改 confirmationJson 里的审批态；prisma 缺失/写失败只记 warn（审计旁路） */
  private async patchConfirmationStatus(
    actionId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    if (!actionId || !this.prisma) return;
    try {
      const row = await this.prisma.agentConfirmation.findUnique({
        where: { id: actionId },
        select: { confirmationJson: true },
      });
      if (!row) return;
      const prev =
        row.confirmationJson && typeof row.confirmationJson === 'object'
          ? (row.confirmationJson as Record<string, unknown>)
          : {};
      await this.prisma.agentConfirmation.update({
        where: { id: actionId },
        data: {
          confirmationJson: {
            ...prev,
            status: decision,
            decidedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `面板确认单审批态写入失败（${actionId} → ${decision}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 待批确认单列表（供排障/未来审批 UI 查询；不含 token） */
  async pendingActions(actor: PanelBridgeActor): Promise<PanelPendingAction[]> {
    this.assertActor(actor);
    const credentials = this.requireCredentials();
    const json = await this.call<{ items?: PanelPendingAction[] }>(
      credentials,
      '/pending-actions',
      'POST',
      { panelId: credentials.panelId, actor },
    );
    return Array.isArray(json?.items) ? json.items : [];
  }

  /**
   * 2026-09-05 复核 P0-1（账号强绑定）：读取面板当前会话事实（脱敏）。
   * 引擎复用任何面板 page 前必须核验返回的 accountId 与请求账号一致；
   * 桥不可用 → 抛 PANEL_UNAVAILABLE，调用方禁止按平台/URL 猜测复用。
   */
  async panelState(actor: PanelBridgeActor): Promise<{
    hasSession: boolean;
    panelId: string | null;
    accountId: string | null;
    platform: string | null;
    partition: string | null;
    url: string | null;
    visible: boolean;
    status: string | null;
  }> {
    this.assertActor(actor);
    const credentials = this.requireCredentials();
    return this.call(credentials, '/panel-state', 'POST', {
      panelId: credentials.panelId,
      actor,
    });
  }

  /**
   * 2026-09-05（引擎「内置面板优先」）：请求 desktop 打开面板并加载平台 URL。
   * 只开面板、不读页面内容；URL 域名白名单由 desktop 侧把守。
   * 桥不可用（面板从未打开过/凭据老化/desktop 未运行）→ 抛 PANEL_UNAVAILABLE，
   * 调用方（LocalBrowserEngine）据此兜底 spawn 独立 Chromium。
   */
  async panelOpen(
    actor: PanelBridgeActor,
    input: {
      url: string;
      accountId?: string | number | null;
      platform?: string | null;
    },
  ): Promise<{
    panelId: string | null;
    accountId: string | null;
    platform: string | null;
    partition: string | null;
    url: string;
  }> {
    this.assertActor(actor);
    if (!input?.url) {
      throw new PanelBridgeError('METHOD_REQUIRED', 400, 'panelOpen url 必填');
    }
    const credentials = this.requireCredentials();
    return this.call(
      credentials,
      '/panel-open',
      'POST',
      {
        panelId: credentials.panelId,
        actor,
        url: input.url,
        accountId: input.accountId != null ? String(input.accountId) : null,
        platform: input.platform ?? null,
      },
      // 打开面板含 UI 动画/导航，给比普通请求略宽的超时
      REQUEST_TIMEOUT_MS * 2,
    );
  }

  /**
   * 查确认单状态——后端驱动写动作的**唯一合法前置**。
   * 只有 state === 'approved' 才允许带单执行；pending 就是"用户还没点头"，
   * 后端不能替用户点头（硬约束 5）。
   */
  async actionState(
    actor: PanelBridgeActor,
    actionId: string,
  ): Promise<PanelActionStateResult> {
    this.assertActor(actor);
    if (!actionId || typeof actionId !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400, 'actionId 必填');
    }
    const credentials = this.requireCredentials();
    const json = await this.call<{
      actionId?: string;
      state?: PanelActionState;
      panelId?: string | null;
      method?: string | null;
      approvedAt?: number | null;
      binding?: { webContentsId?: number | null; sessionId?: string | null };
    }>(credentials, '/action-state', 'POST', {
      panelId: credentials.panelId,
      actor,
      actionId,
    });
    return {
      actionId: json?.actionId ?? actionId,
      state: json?.state ?? 'none',
      panelId: json?.panelId ?? credentials.panelId ?? null,
      method: json?.method ?? null,
      approvedAt: json?.approvedAt ?? null,
      binding: json?.binding ?? undefined,
    };
  }

  private assertActor(actor: PanelBridgeActor): void {
    if (!actor || !actor.ownerId || !actor.tenantId) {
      throw new PanelBridgeError('ACTOR_REQUIRED', 400);
    }
  }

  private requireCredentials() {
    const credentials = this.readCredentials();
    if (!credentials) {
      throw new PanelBridgeError('PANEL_UNAVAILABLE', 503);
    }
    return credentials;
  }

  private async call<T>(
    credentials: { endpoint: string; token: string },
    route: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      [TOKEN_HEADER]: credentials.token,
      [NONCE_HEADER]: randomBytes(16).toString('hex'),
      [TS_HEADER]: String(Date.now()),
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    let response: Response;
    try {
      response = await fetch(`${credentials.endpoint}${route}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason =
        (error as Error)?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      throw new PanelBridgeError(reason, 0, `面板桥请求失败：${route}`);
    }

    let json: {
      success?: boolean;
      data?: T;
      error?: { code?: string; reason?: string };
    } | null = null;
    try {
      // 显式类型断言，避免 `as typeof json` 的循环引用把 json 收窄为 never
      json = (await response.json()) as {
        success?: boolean;
        data?: T;
        error?: { code?: string; reason?: string };
      } | null;
    } catch {
      json = null;
    }

    if (response.ok && json?.success && json.data !== undefined) {
      return json.data;
    }
    const code = json?.error?.code || 'UNKNOWN';
    // 2026-09-04：403 拒绝原因透传（desktop 桥附带安全 reason）+ 面向用户的修复提示。
    // 真机实证：token 过期/无效时用户只看到裸 POLICY_DENIED，不知道要重开面板。
    const reason = json?.error?.reason ? `（${json.error.reason}）` : '';
    const hint = PANEL_REJECT_HINTS[code]
      ? `，${PANEL_REJECT_HINTS[code]}`
      : '';
    throw new PanelBridgeError(
      code,
      response.status,
      `面板桥拒绝：${code}${reason}${hint}`,
    );
  }
}

/** 供测试与诊断：凭据文件当前是否存在（不读内容、不缓存） */
export function panelBridgeRegistryExists(): boolean {
  const explicit = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE?.trim();
  if (explicit) return existsSync(explicit);
  const dir = resolveDesktopUserDataDir();
  if (!dir) return false;
  const filePath = join(dir, REGISTRY_FILE_NAME);
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// ── 阶段 6 决策 ③：面板模式开关投递文件（desktop 写、3011 读）───────────────
// 为什么用文件而不是 env：与桥凭据文件同一个理由——3011 不一定由 desktop 启动，
// env 注入覆盖不到"后端已经在外头跑着"的场景。desktop 把
// { protocol, mode, pid, startedAt } 写进 userData 下的 browser-panel-mode.json
// （见 desktop/browser-panel-mode-registry.js），3011 按需读取。
// 优先级：env KAYPAL_AGENT_PANEL_MODE 显式设置 > 本文件 > 默认 off（铁律不变）。
//
// 安全边界（与 desktop 读取侧完全对齐，两侧任一侧不合规都按"未开启"处理）：
//  - protocol 必须是 kaypal-browser-panel-mode；mode 只认 on/off；
//  - 老化阈值 7 天（文件里没有 token，只是 desktop 崩了没来得及删的兜底）；
//  - pid 探活：写文件的 desktop 进程已死 → 视为不可用（防残留文件把开关顶开）；
//  - 文件缺失 / 形状非法 → null（调用方按 off 处理，**不猜、不报错**）。

const PANEL_MODE_FILE_NAME = 'browser-panel-mode.json';
const PANEL_MODE_PROTOCOL = 'kaypal-browser-panel-mode';
const PANEL_MODE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PANEL_MODE_CACHE_TTL_MS = 1000;

type PanelModeFile = {
  version?: number;
  protocol?: string;
  mode?: string;
  pid?: number;
  startedAt?: string;
};

let panelModeCache: { at: number; value: 'on' | 'off' | null } | null = null;

/** pid 存活探测：signal 0 只探活不发信号；ESRCH=已死，EPERM=活着但没权限 */
function panelModePidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

/** 开关文件路径；env KAYPAL_BROWSER_PANEL_MODE_FILE 可覆盖（测试/多实例） */
export function panelModeRegistryPath(): string | null {
  const explicit = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE?.trim();
  if (explicit) return explicit;
  const dir = resolveDesktopUserDataDir();
  if (!dir) return null;
  return join(dir, PANEL_MODE_FILE_NAME);
}

/** 供测试：清掉开关文件缓存（desktop 刚写完文件后想立即生效时也用它） */
export function clearPanelModeRegistryCache(): void {
  panelModeCache = null;
}

/**
 * 读面板模式开关（带 1s 缓存——每个浏览器动作都会调 readAgentPanelMode，
 * 不能每次都打磁盘）。返回：
 *  - 'on'  ：文件存在且全链路校验通过、mode=on；
 *  - 'off' ：文件存在且校验通过、mode=off（desktop 明确写下的关闭态）；
 *  - null  ：文件缺失 / 形状非法 / 老化 / pid 已死（= 未开启，按 off 处理）。
 */
export function readPanelModeRegistry(now = Date.now()): 'on' | 'off' | null {
  if (panelModeCache && now - panelModeCache.at < PANEL_MODE_CACHE_TTL_MS) {
    return panelModeCache.value;
  }
  const value = readPanelModeRegistryUncached(now);
  panelModeCache = { at: now, value };
  return value;
}

function readPanelModeRegistryUncached(now: number): 'on' | 'off' | null {
  const filePath = panelModeRegistryPath();
  if (!filePath) return null;
  if (!existsSync(filePath)) return null;

  // 存量文件强制收紧权限（同桥凭据文件：历史上有 0644 落盘的旧文件）
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Windows 无 POSIX mode
  }

  let parsed: PanelModeFile;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PanelModeFile;
  } catch {
    return null;
  }

  if (parsed?.protocol !== PANEL_MODE_PROTOCOL) return null;
  if (parsed.mode !== 'on' && parsed.mode !== 'off') return null;

  const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : NaN;
  if (!Number.isFinite(startedAtMs)) return null; // 没有合法时间戳按老化处理（fail-closed）
  const ageMs = Math.max(0, now - startedAtMs);
  if (ageMs > PANEL_MODE_MAX_AGE_MS) return null;

  // 文件存在不代表 desktop 还活着：写文件进程已死 → 不可用
  if (typeof parsed.pid === 'number' && !panelModePidAlive(parsed.pid)) {
    return null;
  }

  return parsed.mode;
}
