/**
 * 咨询限流器（M5 · 进程内固定窗口计数）。
 *
 * 按「IP + 联系方式」哈希作为键，短时间窗口内限制提交次数，防刷单/滥用。
 * M6 可替换为 Redis 分布式限流；当前为进程内存实现，多实例部署时各自计数。
 */

/** 限流窗口（毫秒）：默认 10 分钟 */
export const INQUIRY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
/** 窗口内同一键最大提交次数 */
export const INQUIRY_RATE_LIMIT_MAX = 5;

/**
 * 进程内固定窗口计数器。非 @Injectable（无依赖），由 InquiryService 注入，
 * 便于在单测中用自定义窗口/上限直接实例化验证「限流触发」。
 */
export class InquiryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = INQUIRY_RATE_LIMIT_WINDOW_MS,
    private readonly max: number = INQUIRY_RATE_LIMIT_MAX,
  ) {}

  /** 判定是否允许本次请求；true=放行并计数，false=触发限流 */
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** 清空计数（仅测试用） */
  reset(): void {
    this.hits.clear();
  }
}
