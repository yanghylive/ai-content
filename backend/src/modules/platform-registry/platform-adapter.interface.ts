import type {
  LocalBridgeContentKind,
  LocalBridgeExecutionMode,
} from '../local-bridge/local-bridge.contract';

/**
 * 平台能力模型 —— 与 local-bridge 对外契约 LocalBridgePlatformCapability 完全同构。
 * Phase 2 第一阶段仅承载「能力注册」，不接真实发布。
 */
export interface PlatformCapability {
  platform: string;
  displayName: string;
  contentKinds: LocalBridgeContentKind[];
  executionModes: LocalBridgeExecutionMode[];
  supportsSchedule: boolean;
  supportsDraft: boolean;
  supportsCover: boolean;
  supportsReadback: boolean;
  supportsAccountDetection: boolean;
  riskLevel: 'high';
  adapterVersion: string;
}

/**
 * 平台适配器接口（Phase 2 第一阶段只要求提供 capability）。
 * 后续真实发布迁移时，会逐步补充 preflight/publish/readback 等方法，
 * 由 orchestrator 统一编排，adapter 不直接访问 HTTP/套餐权限/写 PublishRecord。
 */
export interface PlatformAdapter {
  readonly capability: PlatformCapability;
}
