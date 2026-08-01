import type { Page } from 'playwright';
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

/**
 * 视频发布的页面操作配置 —— 与 platform-publish.service.ts 的
 * publishGenericVideo 的 config 形状完全同构（最小切口抽取，零行为漂移）。
 * 各方法仅接收 Playwright Page，不接触 HTTP/账号/凭证/PublishRecord。
 */
export interface VideoPublishPlan {
  platform: 'xiaohongshu' | 'kuaishou' | 'bilibili';
  platformName: string;
  accountMissingMessage: string;
  materialMissingMessage: string;
  publishUrl: string;
  uploadSelector: string;
  successUrlPattern: RegExp;
  publishButtonText: string;
  evidencePrefix: string;
  fill: (page: Page, title: string, tags: string[]) => Promise<void>;
  waitUploaded: (page: Page) => Promise<void>;
  loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>;
  afterClick?: (page: Page) => Promise<void>;
  waitReadback?: (page: Page) => Promise<boolean>;
}

/**
 * 平台视频发布的额外入参（B站等平台的专属字段，随 payload 透传）。
 */
export interface VideoPublishExtras {
  biliDesc?: string;
  biliTitle?: string;
  biliType?: string;
  biliPartition?: string;
}

/**
 * 图文发布的页面操作配置 —— 与 publishGenericImageText 的 config 形状同构。
 * 比视频多 beforeUpload/beforeClick 两个可选钩子（抖音等用）。
 */
export interface ImageTextPublishPlan {
  platform: 'xiaohongshu' | 'wechat-channel' | 'douyin' | 'kuaishou';
  platformName: string;
  accountMissingMessage: string;
  materialMissingMessage: string;
  publishUrl: string;
  uploadSelector: string;
  successUrlPattern: RegExp;
  publishButtonText: string;
  evidencePrefix: string;
  beforeUpload?: (page: Page) => Promise<void>;
  beforeClick?: (page: Page) => Promise<void>;
  fill: (page: Page, title: string, tags: string[]) => Promise<void>;
  loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>;
  afterClick?: (page: Page) => Promise<void>;
  waitReadback?: (page: Page) => Promise<boolean>;
}

/**
 * 平台发布适配器（Phase 2 第二阶段）：在能力之外，提供视频/图文发布计划。
 * adapter 自带平台专属页面操作（含选择器），共享的 loginCheck 由调用方注入。
 * PlatformPublishService 拿到 plan 后交给通用 runner 执行，对外零行为漂移。
 */
export interface PlatformPublishAdapter extends PlatformAdapter {
  buildVideoPublishPlan?(
    extras: VideoPublishExtras,
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): VideoPublishPlan;

  buildImageTextPublishPlan?(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan;
}
