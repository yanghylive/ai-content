import { Injectable, Logger } from '@nestjs/common';
import {
  AGENT_BROWSER_FORBIDDEN,
  AGENT_BROWSER_TOOLS,
  AgentBrowserPolicyDecision,
  AgentBrowserTool,
} from './agent-browser.types';

/**
 * P4 AgentBrowserPolicyService（文档 §7.4）：
 * 域名白名单 / 工具白名单 / 风险分级与确认。
 * 默认禁用任意 JavaScript、文件读取、支付、删除和任意跨域访问。
 */
@Injectable()
export class AgentBrowserPolicyService {
  private readonly logger = new Logger(AgentBrowserPolicyService.name);

  assertToolAllowed(tool: unknown): asserts tool is AgentBrowserTool {
    if (
      typeof tool !== 'string' ||
      !(AGENT_BROWSER_TOOLS as readonly unknown[]).includes(tool)
    ) {
      throw new Error(
        `工具不在白名单：${String(tool)}（允许：${AGENT_BROWSER_TOOLS.join('/')}）`,
      );
    }
  }

  /** 审计单次工具调用（域名 + 工具 + 风险） */
  audit(
    tool: AgentBrowserTool,
    args: Record<string, unknown>,
    context: { url?: string; allowDomains: string[] },
  ): AgentBrowserPolicyDecision {
    // 1. 高危能力硬拦截（即使模型请求）
    if (
      (AGENT_BROWSER_FORBIDDEN as readonly unknown[]).includes(
        tool as unknown,
      )
    ) {
      return {
        allowed: false,
        tool,
        riskLevel: 'blocked',
        reason: `高危能力已禁用：${tool}`,
      };
    }

    // 2. navigate 域名校验（白名单）
    if (tool === 'navigate') {
      const url = String(args.url ?? '');
      if (!url) {
        return {
          allowed: false,
          tool,
          riskLevel: 'blocked',
          reason: 'navigate 缺少 url',
        };
      }
      const decision = this.checkUrlAllowed(url, context.allowDomains);
      // 白名单外的导航：allowed=false 或 requiresConfirmation=true 都直接返回 decision
      if (!decision.allowed || decision.requiresConfirmation) {
        return decision;
      }
    }

    // 3. 风险分级
    const risk = this.riskOf(tool, args);
    return {
      allowed: true,
      tool,
      riskLevel: risk.riskLevel,
      requiresConfirmation: risk.confirm,
      ...(risk.confirm
        ? { reason: `${tool} 属${risk.riskLevel}风险动作，需用户确认` }
        : {}),
    };
  }

  /** 域名白名单检查：允许精确域名 + 子域名 */
  private checkUrlAllowed(
    url: string,
    allowDomains: string[],
  ): AgentBrowserPolicyDecision {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return {
        allowed: false,
        tool: 'navigate',
        riskLevel: 'blocked',
        reason: `无效 URL：${url}`,
      };
    }
    if (allowDomains.length === 0) {
      return {
        allowed: true,
        tool: 'navigate',
        riskLevel: 'medium',
        requiresConfirmation: true,
        reason: `未配置域名白名单，访问 ${host} 需确认`,
      };
    }
    const ok = allowDomains.some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    return ok
      ? { allowed: true, tool: 'navigate', riskLevel: 'low' }
      : {
          allowed: false,
          tool: 'navigate',
          riskLevel: 'blocked',
          reason: `域名 ${host} 不在白名单（允许：${allowDomains.join(', ')}）`,
        };
  }

  /** 工具风险分级 */
  private riskOf(
    tool: AgentBrowserTool,
    args: Record<string, unknown>,
  ): { riskLevel: AgentBrowserPolicyDecision['riskLevel']; confirm: boolean } {
    switch (tool) {
      case 'navigate':
        return { riskLevel: 'low', confirm: false };
      case 'snapshot':
      case 'tabs':
      case 'extract_text':
        return { riskLevel: 'low', confirm: false };
      case 'wait_for':
        return { riskLevel: 'low', confirm: false };
      case 'click':
        return { riskLevel: 'medium', confirm: true }; // 点击可能触发表单提交/跳转
      case 'fill_form':
        return { riskLevel: 'medium', confirm: true }; // 填表可能泄露信息
      case 'press_key':
        // 回车/提交类按键高风险
        return args.key === 'Enter' || args.key === 'Tab'
          ? { riskLevel: 'high', confirm: true }
          : { riskLevel: 'medium', confirm: true };
    }
  }
}