import { Injectable } from '@nestjs/common';
import { AiBrowserActionService, AiBrowserAction } from './ai-browser-action.service';

/**
 * §7.4 AgentBrowserExecutor：接入统一执行器路由。
 * 文档服务边界要求独立 Executor——封装真实浏览器动作执行（LocalBrowserEngine
 * 会话）+ 引擎探活，供 AgentBrowserLoopService 调用。执行语义与错误码
 * （BrowserActionError）由 AiBrowserActionService.executeSingle 承载。
 */
@Injectable()
export class AgentBrowserExecutor {
  constructor(private readonly actions: AiBrowserActionService) {}

  /** 执行单个浏览器动作（含证据），失败返回 ok:false + message（不抛） */
  async execute(input: {
    action: AiBrowserAction;
    accountId?: string;
    timeoutMs?: number;
  }): Promise<{
    index: number;
    action: string;
    ok: boolean;
    message?: string;
    evidenceUrl?: string;
    extractText?: string;
  }> {
    return this.actions.executeSingle(input);
  }

  /** §9.2 引擎探活：浏览器/sidecar 是否存活 */
  async isAlive(accountId: string): Promise<boolean> {
    return this.actions.isEngineAlive(accountId);
  }
}
