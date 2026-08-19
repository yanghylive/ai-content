// 浏览器发现共享原语（复核 #5 解耦）：
// 从 discovery-browser-runner 抽出的错误类型与 id 生成，
// 供 runner 与平台行为类（platform-behaviors）共用，避免循环导入。
import { createHash } from 'node:crypto';

export type BrowserDiscoverReasonCode =
  | 'ok'
  | 'quota_exceeded'
  | 'not_logged_in'
  | 'captcha_required'
  | 'risk_control'
  | 'no_browser_session'
  | 'close_failed'
  | 'parse_failed'
  | 'network_error'
  | 'page_not_found';

export class BrowserDiscoverError extends Error {
  constructor(
    public readonly reasonCode: BrowserDiscoverReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserDiscoverError';
  }
}

/** 内容/事件指纹 id */
export function createId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 20);
}
