import type { PlatformAdapter } from './platform-adapter.interface';

/**
 * 内置 5 平台的能力定义（Phase 2 第一阶段仅注册能力，不接真实发布）。
 * 能力值与原 local-bridge.service.ts 中硬编码的 PLATFORM_CAPABILITIES 完全一致，
 * 保证对外契约零行为漂移；后续真实迁移时再在各 adapter 上补充 preflight/publish 等。
 */
export const BUILTIN_PLATFORM_ADAPTERS: readonly PlatformAdapter[] = [
  {
    capability: {
      platform: 'xiaohongshu',
      displayName: '小红书',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      supportsSchedule: false,
      supportsDraft: false,
      supportsCover: false,
      supportsReadback: false,
      supportsAccountDetection: true,
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    },
  },
  {
    capability: {
      platform: 'wechat-channel',
      displayName: '视频号',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      supportsSchedule: false,
      supportsDraft: false,
      supportsCover: false,
      supportsReadback: false,
      supportsAccountDetection: true,
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    },
  },
  {
    capability: {
      platform: 'douyin',
      displayName: '抖音',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      supportsSchedule: false,
      supportsDraft: false,
      supportsCover: false,
      supportsReadback: false,
      supportsAccountDetection: true,
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    },
  },
  {
    capability: {
      platform: 'kuaishou',
      displayName: '快手',
      contentKinds: ['article', 'video'],
      executionModes: ['cdp'],
      supportsSchedule: false,
      supportsDraft: false,
      supportsCover: false,
      supportsReadback: false,
      supportsAccountDetection: true,
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    },
  },
  {
    capability: {
      platform: 'bilibili',
      displayName: 'B站',
      contentKinds: ['video'],
      executionModes: ['cdp'],
      supportsSchedule: false,
      supportsDraft: false,
      supportsCover: false,
      supportsReadback: false,
      supportsAccountDetection: true,
      riskLevel: 'high',
      adapterVersion: '1.0.0',
    },
  },
];
