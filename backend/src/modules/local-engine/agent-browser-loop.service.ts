import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiBrowserActionService } from './ai-browser-action.service';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
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
  ) {}

  /**
   * 运行一轮 Observe-Act-Verify。
   * sessionId 必须已 acquireEngineSession（状态 running）。
   * instruction: 自然语言任务（如"搜索装修公司并截图"）。
   */
  async run(
    sessionId: string,
    instruction: string,
    options: { onStep?: (event: AgentBrowserStepEvent) => void; confirmedTools?: string[] } = {},
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

    // 2. Act：执行指令（复用 AiBrowserActionService：AI 解析 + 逐部执行 + 证据）
    //    Observe 到当前 URL 注入 context（供域名审计用）
    const currentUrl = snapshot.url ?? undefined;
    const actResult = await this.actions.run({
      instruction,
      ...(currentUrl && !currentUrl.startsWith('chrome://')
        ? { url: currentUrl }
        : {}),
      timeoutMs: cfg.timeoutMs,
      maxActions: cfg.maxSteps,
      maxRetries: cfg.maxRetries,
      // P4：用会话独立 accountId（独立 Profile 隔离，不共享 ai-agent）
      accountId: session.accountId,
      // §7.4 执行前策略拦截：每步动作执行前过审计，allowed=false 不执行
      policyGate: async (action) => {
        const tool = this.mapTool(action.action);
        if (!tool) return { allowed: true };
        const audit = this.policy.audit(
          tool,
          { url: 'url' in action ? (action.url ?? session.url) : session.url },
          { url: session.url, allowDomains: session.allowDomains },
        );
        return {
          allowed: audit.allowed,
          reason: audit.allowed ? undefined : audit.reason,
          requiresConfirmation: audit.requiresConfirmation,
        };
      },
      // 前端/调用方可传已确认的动作（如点击/填表），经确认闸门才放行
      confirmedTools: confirmedTools ?? [],
    });

    // 3. Verify：逐步骤生成事件 + 逐步策略审计（§7.4 文档要求每步过策略）
    for (let i = 0; i < actResult.results.length; i++) {
      const r = actResult.results[i];
      // 每步动作过 PolicyService 审计（工具映射：goto→navigate 等）
      const policyTool = this.mapTool(r.action);
      const audit = policyTool
        ? this.policy.audit(
            policyTool,
            // navigate 用会话 URL（evidenceUrl 是截图路径，不能当导航目标）
            { url: policyTool === 'navigate' ? session.url : (r.evidenceUrl ?? session.url) },
            { url: session.url, allowDomains: session.allowDomains },
          )
        : null;
      const stepEvent: AgentBrowserStepEvent = {
        type: 'step',
        stepIndex: i,
        action: r.action,
        ok: r.ok,
        message: [
          r.message,
          audit && !audit.allowed
            ? `（策略阻断：${audit.reason ?? '不在白名单'}）`
            : audit?.requiresConfirmation
              ? `（${audit.riskLevel}风险动作，已标记需确认）`
              : undefined,
        ]
          .filter(Boolean)
          .join(' '),
        url: r.evidenceUrl,
        extractText: r.extractText,
      };
      steps.push(stepEvent);
      onStep?.(stepEvent);
      this.sessions.bumpStep(sessionId);
      this.sessions.appendEvent(sessionId, stepEvent);
    }

    this.logger.log(
      `AgentBrowser ${sessionId} 完成：${actResult.actions.length} 个动作，${actResult.results.filter((r) => r.ok).length} 成功`,
    );

    const done: AgentBrowserStepEvent = {
      type: 'done',
      ok: actResult.ok,
      message: actResult.actions.length
        ? `已执行 ${actResult.results.length} 步`
        : '无可用动作',
    };
    steps.push(done);
    onStep?.(done);
    this.sessions.appendEvent(sessionId, done);
    return { ok: actResult.ok, steps };
  }

  /** Observe：快照当前页状态（URL + 可交互文本片段） */
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