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
  platform: 'xiaohongshu' | 'kuaishou' | 'bilibili' | 'weibo';
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
  /** §6b 平台专属发布按钮评分定位（如小红书红底评分），优先于通用文本查找 */
  locatePublishButton?: (
    page: Page,
    text: string,
  ) => Promise<{ click: (options?: object) => Promise<void> }>;
}

/**
 * 平台视频发布的额外入参（B站等平台的专属字段，随 payload 透传）。
 */
export interface VideoPublishExtras {
  biliDesc?: string;
  biliTitle?: string;
  biliType?: string;
  biliPartition?: string;
  coverPath?: string;
  coverPaths?: Record<string, string>;
}

/**
 * 图文发布的页面操作配置 —— 与 publishGenericImageText 的 config 形状同构。
 * 比视频多 beforeUpload/beforeClick 两个可选钩子（抖音等用）。
 */
export interface ImageTextPublishPlan {
  platform:
    | 'xiaohongshu'
    | 'wechat-channel'
    | 'wechat-official'
    | 'douyin'
    | 'kuaishou'
    | 'weibo'
    | 'zhihu'
    | 'toutiao';
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
  /** §6b 平台专属发布按钮评分定位（如小红书红底评分），优先于通用文本查找 */
  locatePublishButton?: (
    page: Page,
    text: string,
  ) => Promise<{ click: (options?: object) => Promise<void> }>;
}

/**
 * 视频独立全流程的页面步骤（与 platform-publish.service.ts 的视频编排步
 * 骤形状同构；零行为漂移）。仅抖音/视频号等走非通用 runner 的平台返回。
 */
export interface VideoPublishSteps<Input = unknown> {
  publishUrl: string;
  loginRequiredEvidence: string;
  successEvidence: string;
  run: (page: Page, input: Input) => Promise<{ currentUrl: string }>;
}

/**
 * 发布适配器基础契约。具体页面能力由下方三个子接口分别声明，避免要求每个平台
 * 同时实现通用视频、独立视频与图文三套流程。
 */
// 无法删除：GenericVideo/ImageText/VideoPublish 均 extends 它
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PlatformPublishAdapter extends PlatformAdapter {}

export interface GenericVideoPublishAdapter extends PlatformPublishAdapter {
  buildVideoPublishPlan(
    extras: VideoPublishExtras,
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): VideoPublishPlan;
}

export interface ImageTextPublishAdapter extends PlatformPublishAdapter {
  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan;
}

/**
 * 视频独立全流程适配器子接口（抖音/视频号等非通用 runner 平台实现）。
 */
export interface IndependentVideoPublishAdapter<
  Input = unknown,
> extends PlatformPublishAdapter {
  buildVideoPublishSteps(): VideoPublishSteps<Input>;
  checkLogin(page: Page): Promise<{ ok: boolean; message: string }>;
}

/**
 * publish adapter 工厂（带依赖）。registry 存工厂而非可执行实例；service 在
 * 调用时注入共享 deps，保留原九个入口的依赖语义。
 */
export type PublishAdapterFactory = (
  deps: Record<string, unknown>,
) => PlatformPublishAdapter;
