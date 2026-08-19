import type {
  RpaCapability,
  RpaSession,
  RpaSessionContext,
  RpaStepResult,
} from './rpa.types';

/**
 * 统一 RPA 驱动契约（复核#1，对齐 3010-AI获客完整开发文档 §7.1）。
 *
 * 每个平台实现此接口；不支持的动作在 capabilities() 显式 unsupported
 * （不用手工模式伪装），execute() 返回结构化 reasonCode。
 * RPA 适配器只接触平台页面和账号上下文，不直接写 Lead 或 CRM（§7.2）。
 */
export interface RpaDriver {
  readonly platform: string;
  readonly displayName: string;
  readonly driverVersion: string;

  /** 能力总览；可选 accountId 触发账号级 preflight（P1-1） */
  capabilities(input?: { accountId?: string | number }): Promise<RpaCapability>;

  openSession(ctx: RpaSessionContext): Promise<RpaSession>;

  execute(
    session: RpaSession,
    step: { name: string; action: string; input?: Record<string, unknown> },
  ): Promise<RpaStepResult>;

  collectEvidence(session: RpaSession): Promise<RpaStepResult | null>;

  closeSession(session: RpaSession): Promise<void>;
}
