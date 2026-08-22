import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiBrowserActionService, AiBrowserAction } from './ai-browser-action.service';
import type { AgentBrowserSession } from './agent-browser.types';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { matchesConfirmedAction } from './ai-browser-action.service';
import { detectPromptInjection } from '../ai-gateway/ai-gateway.service';

export interface AgentBrowserStepEvent {
  type: 'step' | 'snapshot' | 'done' | 'error';
  stepIndex?: number;
  action?: string;
  ok?: boolean;
  message?: string;
  url?: string;
  extractText?: string;
  error?: string;
}

/**
 * P4 AgentBrowserLoopService（文档 §7.4）：
 * Observe-Act-Verify 循环。
 * - Observe：snapshot 当前页（提取可交互文本 + 当前 URL）
 * - Act：NL 指令 → AiBrowserActionService（AI 解析动作序列 → 执行，含证据截图）
 * - Verify：每步结果 + 最终状态校验
 * 每步动作前过 PolicyService 审计（域名/工具白名单/风险确认）。
 * 对齐 MAI-UI 动作模型：动作 schema 与通用 GUI agent 一致（navigate/click/fill 等）。
 */
@Injectable()
export class AgentBrowserLoopService {
  private readonly logger = new Logger(AgentBrowserLoopService.name);

  constructor(
    private readonly sessions: AgentBrowserSessionService,
    private readonly actions: AiBrowserActionService,
    private readonly policy: AgentBrowserPolicyService,
    private readonly playwrightMcp?: PlaywrightMcpService,
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 运行一轮 Observe-Act-Verify。
   * sessionId 必须已 acquireEngineSession（状态 running）。
   * instruction: 自然语言任务（如"搜索装修公司并截图"）。
   */
  async run(
    sessionId: string,
    instruction: string,
    options: {
      onStep?: (event: AgentBrowserStepEvent) => void;
      confirmedTools?: Array<{ action: string; target?: string; url?: string }>;
    } = {},
  ): Promise<{ ok: boolean; steps: AgentBrowserStepEvent[] }> {
    const { onStep, confirmedTools } = options;
    const session = this.sessions.get(sessionId);
    if (session.status !== 'running') {
      throw new BadRequestException(
        `会话状态 ${session.status}，需先 run 进入运行态`,
      );
    }
    if (!session.engineKey) {
      throw new BadRequestException('会话引擎未就绪，请先 run');
    }
    if (!instruction?.trim()) {
      throw new BadRequestException('缺少任务指令（instruction）');
    }

    // §14.2 feature flag：mode 门禁（legacy=继续现有执行器；dom-agent=本循环灰度）
    const cfg = this.readAgentBrowserConfig();
    if (cfg.mode === 'legacy') {
      throw new BadRequestException(
        'AGENT_BROWSER_MODE=legacy：Agent Browser 循环未开启（灰度开关关闭），请使用现有动作执行',
      );
    }
    if (!cfg.allowWrite && /(填写|输入|提交|点击|发送|发评论|发私信)/.test(instruction)) {
      throw new BadRequestException(
        'AGENT_BROWSER_ALLOW_WRITE=false：写操作未开启，仅允许导航/读取类任务',
      );
    }

    const steps: AgentBrowserStepEvent[] = [];

    // 1. Observe：快照当前页
    const snapshot = await this.observe(sessionId);
    steps.push(snapshot);
    onStep?.(snapshot);
    this.sessions.appendEvent(sessionId, snapshot);

    // 2. Act：解析指令为动作序列（供逐步 re-observe 循环）
    let actions: AiBrowserAction[] = [];
    try {
      actions = await this.actions.parseActions(instruction);
    } catch (error) {
      // 解析失败直接抛（指令无法拆解为动作，阻断执行）
      throw new BadRequestException(
        `无法解析指令步骤：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // §14.2 maxSteps 截断
    actions = actions.slice(0, cfg.maxSteps);

    // 3. 逐步 Observe→策略→单动作执行→验证（§7.4 DOM Agent 循环）
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      // 3.1 每步 re-observe（页面可能已因上一步导航改变）
      const stepSnapshot = await this.observe(sessionId);
      steps.push(stepSnapshot);
      onStep?.(stepSnapshot);
      this.sessions.appendEvent(sessionId, stepSnapshot);
      // 更新会话 url（导航后不再用旧 url）
      if (stepSnapshot.url && stepSnapshot.url !== session.url) {
        session.url = stepSnapshot.url;
      }

      // 3.2 执行前策略审计（工具映射 + 高风险确认闸门）
      const tool = this.mapTool(action.action);
      let allowed = true;
      let gateMessage: string | undefined;
      if (tool) {
        const audit = this.policy.audit(
          tool,
          { url: 'url' in action ? (action.url ?? session.url) : session.url },
          { url: session.url, allowDomains: session.allowDomains },
        );
        if (audit.requiresConfirmation) {
          const matched = (confirmedTools ?? []).some((cc) =>
            matchesConfirmedAction(cc, action),
          );
          if (!matched) {
            const confirmationId = await this.persistPendingConfirmation(
              session,
              action,
              audit.riskLevel,
            );
            allowed = false;
            gateMessage = `需用户确认后执行（高风险动作${confirmationId ? `，确认单 ${confirmationId}` : ''}）`;
          }
        } else if (!audit.allowed) {
          allowed = false;
          gateMessage = `策略阻断：${audit.reason ?? '不在白名单'}`;
        }
      }

      // 3.3 单动作执行（allowed 才执行；否则记录 blocked）
      const r = allowed
        ? await this.actions.executeSingle({
            action,
            accountId: session.accountId,
            timeoutMs: cfg.timeoutMs,
          })
        : {
            index: i,
            action: action.action,
            ok: false,
            message: gateMessage ?? '策略阻断',
            evidenceUrl: undefined,
            extractText: undefined,
            blocked: true,
          };

      // 3.4 验证：生成步骤事件
      const stepEvent: AgentBrowserStepEvent = {
        type: 'step',
        stepIndex: i,
        action: r.action,
        ok: r.ok,
        message: r.message,
        url: r.evidenceUrl,
        extractText: r.extractText,
      };
      steps.push(stepEvent);
      onStep?.(stepEvent);
      this.sessions.bumpStep(sessionId);
      this.sessions.appendEvent(sessionId, stepEvent);
    }

    const successCount = steps.filter(
      (s) => s.type === 'step' && s.ok,
    ).length;
    this.logger.log(
      `AgentBrowser ${sessionId} 完成：${actions.length} 个动作，${successCount} 成功`,
    );

    const done: AgentBrowserStepEvent = {
      type: 'done',
      ok: successCount > 0,
      message: actions.length ? `已执行 ${actions.length} 步` : '无可用动作',
    };
    steps.push(done);
    onStep?.(done);
    this.sessions.appendEvent(sessionId, done);
    return { ok: successCount > 0, steps };
  }

  /** Observe：真实 DOM/accessibility 快照（playwright-mcp browser_snapshot），失败回落 URL */
  async observe(
    sessionId: string,
  ): Promise<{
    type: 'snapshot';
    ok: boolean;
    url?: string;
    message?: string;
    snapshot?: string;
  }> {
    const session = this.sessions.get(sessionId);
    try {
      // 真实无障碍树快照（若 playwright-mcp 可用）
      if (this.playwrightMcp) {
        try {
          // §7.4 绑定当前 Agent 会话的 profile（确保 snapshot 与执行同页面，
          // 避免"动作在 A 页面、快照读 B 页面"）。
          // 8s 超时：sidecar 启动慢/失败时快速回落 URL 快照，不阻塞循环。
          await Promise.race([
            this.playwrightMcp.ensureProfile({
              platform: 'general-web',
              accountId: session.accountId,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('ensureProfile timeout')), 8000),
            ),
          ]);
          const res = await this.playwrightMcp.rpcCall(
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'browser_snapshot',
                arguments: {},
              },
            } as never,
            15_000,
          );
          const text = this.extractSnapshotText(res);
          if (text) {
            const injected = detectPromptInjection(text);
            return {
              type: 'snapshot',
              ok: true,
              url: session.url,
              snapshot: injected ? undefined : text.slice(0, 4000),
              message: injected
                ? `快照（会话 ${sessionId}）— 检测到可疑注入内容，已隔离，不进入模型上下文`
                : `DOM 快照（会话 ${sessionId}，${text.length} 字符，可交互元素已提取）`,
            };
          }
        } catch {
          // playwright-mcp 不可用则回落 URL 快照
        }
      }
      const snapshotText = `快照（会话 ${sessionId}，当前页 ${session.url || '未导航'}）`;
      const injected = detectPromptInjection(
        [snapshotText, session.url ?? ''].join('\n'),
      );
      return {
        type: 'snapshot',
        ok: true,
        url: session.url,
        message: injected
          ? `快照（会话 ${sessionId}）— 检测到可疑注入内容，已隔离，不进入模型上下文`
          : snapshotText,
      };
    } catch (error) {
      return {
        type: 'snapshot',
        ok: false,
        message: `快照失败：${(error as Error).message}`,
      };
    }
  }

  /** 从 MCP tools/call 响应提取 snapshot 文本 */
  private extractSnapshotText(
    res: { result?: { content?: Array<{ type?: string; text?: string }> } },
  ): string {
    const content = res?.result?.content;
    if (!Array.isArray(content)) return '';
    return content
      .map((item) => (typeof item.text === 'string' ? item.text : ''))
      .join('\n')
      .trim();
  }

  /**
   * P1-3 确认持久化：高风险动作未确认时写 AgentConfirmation 表（pending）。
   * 返回确认单 id；prisma 不可用时仅内存提示（不落库）。
   */
  private async persistPendingConfirmation(
    session: AgentBrowserSession,
    action: AiBrowserAction,
    riskLevel: string,
  ): Promise<string | undefined> {
    try {
      const delegate = (
        this.prisma as unknown as {
          agentConfirmation?: {
            create?: (args: {
              data: {
                tenantId: string;
                userId: string;
                sessionId: string;
                action: string;
                status: string;
                riskLevel: string;
                target?: string | null;
                content?: string | null;
                confirmationJson: unknown;
              };
            }) => Promise<{ id: string }>;
          };
        }
      )?.agentConfirmation;
      if (!delegate?.create) return undefined;
      const created = await delegate.create({
        data: {
          tenantId: session.lease?.tenantId ?? 'legacy-local-desktop',
          userId: session.lease?.ownerId ?? 'legacy-local-user',
          sessionId: session.id,
          action: action.action,
          status: 'pending',
          riskLevel,
          target: 'selector' in action ? action.selector : null,
          content: 'url' in action ? action.url : null,
          confirmationJson: {
            sessionId: session.id,
            action: action.action,
            target: 'selector' in action ? action.selector : undefined,
            url: 'url' in action ? action.url : undefined,
            createdAt: new Date().toISOString(),
          },
        },
      });
      return created.id;
    } catch (error) {
      this.logger.warn(
        `AgentConfirmation 持久化失败（不阻断，仅内存提示）：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** §14.2 读取 Agent Browser 灰度配置（环境变量，缺省=dom-agent 开启/读操作为主） */
  private readAgentBrowserConfig(): {
    mode: 'legacy' | 'dom-agent';
    allowedDomains: string[];
    maxSteps: number;
    maxRetries: number;
    timeoutMs: number;
    allowWrite: boolean;
  } {
    const mode = (process.env.AGENT_BROWSER_MODE ?? 'legacy') as
      | 'legacy'
      | 'dom-agent';
    return {
      mode,
      allowedDomains: (process.env.AGENT_BROWSER_ALLOWED_DOMAINS ?? '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
      maxSteps: Number(process.env.AGENT_BROWSER_MAX_STEPS ?? 30),
      maxRetries: Number(process.env.AGENT_BROWSER_MAX_RETRIES ?? 2),
      timeoutMs: Number(process.env.AGENT_BROWSER_TIMEOUT_MS ?? 120000),
      allowWrite: (process.env.AGENT_BROWSER_ALLOW_WRITE ?? 'false') === 'true',
    };
  }

  /** 执行器动作 → P4 工具白名单映射（用于逐步策略审计） */
  private mapTool(action: string): 'navigate' | 'snapshot' | 'click' | 'fill_form' | 'press_key' | 'wait_for' | 'tabs' | 'extract_text' | null {
    switch (action) {
      case 'goto':
        return 'navigate';
      case 'type':
        return 'fill_form';
      case 'click':
        return 'click';
      case 'extract':
        return 'extract_text';
      case 'wait':
        return 'wait_for';
      case 'screenshot':
        return 'snapshot';
      default:
        return null;
    }
  }

  /** 策略审计单步动作（对外暴露，供前端预检） */
  auditStep(
    tool: string,
    args: Record<string, unknown>,
    allowDomains: string[],
  ) {
    this.policy.assertToolAllowed(tool);
    return this.policy.audit(tool as never, args, { allowDomains });
  }
}