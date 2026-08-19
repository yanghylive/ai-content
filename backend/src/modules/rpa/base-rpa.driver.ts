import { randomUUID } from 'node:crypto';
import type { RpaDriver } from './rpa-driver.interface';
import type {
  RpaAction,
  RpaCapability,
  RpaActionCapability,
  RpaReasonCode,
  RpaSession,
  RpaSessionContext,
  RpaStepResult,
} from './rpa.types';

/** RPA driver 基类：共用 capabilities 构建 + 会话管理 + 步骤结果包装 */
export abstract class BaseRpaDriver implements RpaDriver {
  abstract readonly platform: string;
  abstract readonly displayName: string;
  abstract readonly driverVersion: string;

  /** 各动作的支持性由子类声明（不支持时显式 unsupported，不伪装） */
  protected abstract declareActions(): Array<
    Pick<RpaActionCapability, 'action' | 'supported'> & {
      unavailableReason?: string;
      unavailableReasonCode?: RpaReasonCode;
    }
  >;

  /** 运行时是否就绪（浏览器会话可用） */
  protected abstract runtimeReady(): boolean;

  /** 子类实现具体步骤执行 */
  protected abstract runStep(
    session: RpaSession,
    action: RpaAction,
    input: Record<string, unknown>,
  ): Promise<RpaStepResult>;

  capabilities(): Promise<RpaCapability> {
    return Promise.resolve({
      platform: this.platform as RpaCapability['platform'],
      displayName: this.displayName,
      runtimeReady: this.runtimeReady(),
      actions: this.declareActions(),
      driverVersion: this.driverVersion,
    });
  }

  openSession(ctx: RpaSessionContext): Promise<RpaSession> {
    if (!this.runtimeReady()) {
      return Promise.reject(
        new Error(
          `unsupported: ${this.displayName} 浏览器会话未就绪，无法执行 RPA（请确认已登录平台账号）`,
        ),
      );
    }
    // 会话真实绑定：sessionId 含 accountId 可溯源；engineSessionKey 与
    // 底层浏览器引擎会话（{platform}-{accountId}）一对一绑定，供审计与精确关闭。
    const engineSessionKey = `${this.platform}-${ctx.accountId}`;
    return Promise.resolve({
      sessionId: `${engineSessionKey}-${ctx.runId}-${randomUUID().slice(0, 8)}`,
      engineSessionKey,
      platform: this.platform as RpaSession['platform'],
      accountId: ctx.accountId,
      pageAvailable: true,
    });
  }

  async execute(
    session: RpaSession,
    step: { name: string; action: string; input?: Record<string, unknown> },
  ): Promise<RpaStepResult> {
    const startedAt = Date.now();
    const action = step.action as RpaAction;
    const capability = this.declareActions().find((a) => a.action === action);
    if (!capability || !capability.supported) {
      return this.stepResult(step.name, 'failed', 'unsupported', startedAt, {
        message:
          capability?.unavailableReason ||
          `${this.displayName} 不支持动作 ${step.action}`,
      });
    }
    try {
      const result = await this.runStep(session, action, step.input ?? {});
      return result;
    } catch (error) {
      return this.stepResult(
        step.name,
        'failed',
        this.classifyError(error),
        startedAt,
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  collectEvidence(_session: RpaSession): Promise<RpaStepResult | null> {
    return Promise.resolve(null);
  }

  closeSession(_session: RpaSession): Promise<void> {
    // persistent-cdp-browser 模式下页面由引擎托管，driver 不关闭页面
    return Promise.resolve();
  }

  protected stepResult(
    stepName: string,
    status: RpaStepResult['status'],
    reasonCode: RpaReasonCode,
    startedAt: number,
    extra?: Partial<RpaStepResult>,
  ): RpaStepResult {
    return {
      stepName,
      status,
      reasonCode,
      attempt: 1,
      durationMs: Date.now() - startedAt,
      driverVersion: this.driverVersion,
      ...extra,
    };
  }

  protected classifyError(error: unknown): RpaReasonCode {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unsupported')) return 'unsupported';
    if (/captcha|验证码/i.test(message)) return 'captcha_required';
    if (/风控|risk_control|操作过快|被限制/i.test(message))
      return 'risk_control';
    if (/quota|额度/i.test(message)) return 'quota_exceeded';
    if (/未登录|not_logged_in|登录/i.test(message)) return 'not_logged_in';
    if (/parse|解析/i.test(message)) return 'parse_failed';
    if (/network|网络|超时|timeout/i.test(message)) return 'network_error';
    if (/no_browser_session|会话/i.test(message)) return 'no_browser_session';
    return 'parse_failed';
  }
}
