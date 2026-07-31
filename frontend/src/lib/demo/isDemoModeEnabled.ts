/**
 * 前端演示舱门禁（合规边界确认书 v2 第五节）
 *
 * 作用：决定前端是否渲染/启用演示舱（demo-only）功能。
 * 任何 demo 功能必须包一层 `if (!isDemoModeEnabled()) return disabledUI()`。
 *
 * 三重校验：
 *   1. ENABLE_DEMO 环境变量
 *   2. DEMO_OVERRIDE_TOKEN 一次性本地 token
 *   3. 非生产环境（process.env.NODE_ENV !== 'production'）
 *
 * 用法：
 *   if (!isDemoModeEnabled()) {
 *     return <DisabledDemoPlaceholder />;
 *   }
 *   // 渲染 demo UI
 */

import { isDemoPath } from './demoPaths';

const MIN_TOKEN_LENGTH = 16;

/**
 * 三重校验后返回是否启用演示模式。
 * 任何一处不满足即返回 false。
 */
export function isDemoModeEnabled(): boolean {
  // 1. 生产构建强制关闭（合规书第五节第 3 条）
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
    return false;
  }

  // 2. ENABLE_DEMO 必须为 'true'
  const flag = typeof process !== 'undefined' && process.env && process.env.ENABLE_DEMO;
  if (flag !== 'true') {
    return false;
  }

  // 3. DEMO_OVERRIDE_TOKEN 必须存在且足够长
  const token = typeof process !== 'undefined' && process.env && process.env.DEMO_OVERRIDE_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return false;
  }

  return true;
}

/**
 * 演示模式状态（用于 UI 展示/日志）
 */
export interface DemoModeStatus {
  enabled: boolean;
  reason: string;
  nodeEnv: string;
  flag: string;
  hasToken: boolean;
}

/**
 * 返回演示模式状态（含未开启原因，便于调试）
 */
export function getDemoModeStatus(): DemoModeStatus {
  const nodeEnv = typeof process !== 'undefined' && process.env ? process.env.NODE_ENV || 'development' : 'development';
  const flag = typeof process !== 'undefined' && process.env ? process.env.ENABLE_DEMO || '' : '';
  const token = typeof process !== 'undefined' && process.env ? process.env.DEMO_OVERRIDE_TOKEN || '' : '';

  let enabled = false;
  let reason = '';

  if (nodeEnv === 'production') {
    reason = '生产环境强制关闭（合规）';
  } else if (flag !== 'true') {
    reason = 'ENABLE_DEMO 未设为 true';
  } else if (!token || token.length < MIN_TOKEN_LENGTH) {
    reason = `DEMO_OVERRIDE_TOKEN 缺失或长度不足（< ${MIN_TOKEN_LENGTH} 字符）`;
  } else {
    enabled = true;
    reason = '演示模式已开启（合规隔离）';
  }

  return { enabled, reason, nodeEnv, flag, hasToken: !!token && token.length >= MIN_TOKEN_LENGTH };
}

/**
 * 在 demo UI 中打印警示日志（合规书第五节第 5 条）
 */
export function logDemoModeBanner(scope: string): void {
  if (!isDemoModeEnabled()) return;
  console.warn(
    `[DEMO-MODE][NON-COMPLIANT] ${scope}：此能力仅用于能力证明，不得用于真实账号。\n` +
      `参考：合规边界确认书 v2 第五节 + DEMO_MODULE_CONTRACT.md`,
  );
}

/**
 * 检查当前文件路径是否属于 demo 路径（供 demo-guard 使用）
 */
export function isCurrentFileInDemoPath(filePath: string): boolean {
  return isDemoPath(filePath);
}
