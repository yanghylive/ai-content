/**
 * 前端演示舱门禁（合规边界确认书 v2 第五节）
 *
 * 作用：决定前端是否渲染/启用演示舱（demo-only）功能。
 * 任何 demo 功能必须包一层 `if (!isDemoModeEnabled()) return disabledUI()`。
 *
 * 分层语义（重要）：
 *   - 前端（本模块）：构建期决定。Next.js 只把 NEXT_PUBLIC_* 变量内联进客户端 bundle，
 *     生产发布构建默认 NEXT_PUBLIC_ENABLE_DEMO='false'，产物中 demo UI 渲染 disabled。
 *   - 后端（demo-mode.ts）：运行时守门。ENABLE_DEMO + DEMO_OVERRIDE_TOKEN 双重校验，
 *     前端藏 UI 不代表 API 可用——后端守卫才是合规底线。
 *
 * 用法：
 *   if (!isDemoModeEnabled()) {
 *     return <DemoDisabledBanner />;
 *   }
 *   // 渲染 demo UI
 */

import { isDemoPath } from './demoPaths';

const DEMO_FLAG = 'NEXT_PUBLIC_ENABLE_DEMO';

/**
 * 读取构建期注入的 demo flag。
 * Next.js 在构建时把 NEXT_PUBLIC_ENABLE_DEMO 内联为字面量（'true' 或未定义）。
 */
function readDemoFlag(): string {
  return (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ENABLE_DEMO) || '';
}

/**
 * 前端演示模式是否启用。
 * 唯一判据：构建期 NEXT_PUBLIC_ENABLE_DEMO === 'true'。
 * 生产发布构建（CI/release）默认不设该变量 → 永远 false。
 */
export function isDemoModeEnabled(): boolean {
  return readDemoFlag() === 'true';
}

/**
 * 演示模式状态（用于 UI 展示/调试）
 */
export interface DemoModeStatus {
  enabled: boolean;
  reason: string;
  flag: string;
}

/**
 * 返回演示模式状态（含未开启原因，便于调试）
 */
export function getDemoModeStatus(): DemoModeStatus {
  const flag = readDemoFlag();
  const enabled = flag === 'true';
  return {
    enabled,
    flag,
    reason: enabled
      ? '演示模式已开启（构建期注入 NEXT_PUBLIC_ENABLE_DEMO=true，合规隔离）'
      : `演示模式未开启（${DEMO_FLAG} 未设为 'true'，生产构建默认关闭）`,
  };
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
