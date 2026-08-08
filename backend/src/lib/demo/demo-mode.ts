/**
 * 后端演示舱门禁（合规边界确认书 v2 第五节）
 *
 * 作用：后端 demo controller/service 必须调用 requireDemoMode() 守卫。
 * 用法：
 *   @Get('/demo/wechat-personal/status')
 *   getDemoStatus() {
 *     requireDemoMode();
 *     return this.demoService.getStatus();
 *   }
 */

import { HttpException, HttpStatus } from '@nestjs/common';

const MIN_TOKEN_LENGTH = 16;
const DEMO_PREFIX = '[DEMO-MODE][NON-COMPLIANT]';

/**
 * 后端演示模式运行时守卫。
 * 未开启时抛出 403，开启时打印警示日志。
 */
export function requireDemoMode(): void {
  const status = getDemoModeStatus();
  if (!status.enabled) {
    throw new HttpException(
      `${DEMO_PREFIX} 后端 demo 功能未开启：${status.reason}`,
      HttpStatus.FORBIDDEN,
    );
  }
  // 合规书第五节第 5 条：日志水印
  console.warn(
    `${DEMO_PREFIX} 后端 demo 功能已调用（仅能力证明，不得用于真实账号）`,
  );
}

/**
 * 后端演示模式状态（与前端逻辑对齐）
 */
export interface DemoModeStatus {
  enabled: boolean;
  reason: string;
  nodeEnv: string;
  flag: string;
  hasToken: boolean;
}

export function getDemoModeStatus(): DemoModeStatus {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const flag = process.env.ENABLE_DEMO || '';
  const token = process.env.DEMO_OVERRIDE_TOKEN || '';

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

  return {
    enabled,
    reason,
    nodeEnv,
    flag,
    hasToken: !!token && token.length >= MIN_TOKEN_LENGTH,
  };
}

/**
 * 判断文件路径是否属于演示舱
 */
export function isDemoPath(filePath: string): boolean {
  const normalized = filePath.replace(/[/\\]/g, '/');
  return (
    normalized.includes('/demo/') ||
    /\.demo\.(tsx?|jsx?|mjs|cjs)$/.test(normalized)
  );
}

/**
 * 演示舱专用 fixture 路径
 */
export function getDemoFixturePath(fixtureName: string): string {
  return `/demo/fixtures/${fixtureName}.json`;
}
