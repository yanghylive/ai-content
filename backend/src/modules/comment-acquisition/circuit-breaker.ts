/**
 * CircuitBreaker —— 评论回复风控断路器（内存实现）
 *
 * 思路借鉴 Yht20927/douyin-cli「10 分钟内 post 失败 ≥3 次自动暂停」（仅思路，自研实现）。
 *
 * 规则：
 * - 按 key（默认 `${platform}:${accountId}`）独立计数
 * - 窗口内（默认 10 分钟）失败 ≥ threshold（默认 3 次）→ 熔断
 * - 熔断持续 openDuration（默认 30 分钟），期间该 key 的所有操作被拒
 * - 成功调用会重置失败计数（半开恢复：熔断期不自动恢复，等窗口过期）
 *
 * 内存实现：桌面端单进程足够，进程重启即清零（符合"重启即重新试"的朴素预期）。
 */

export interface CircuitBreakerOptions {
  /** 失败统计窗口（ms），默认 10 分钟 */
  windowMs?: number;
  /** 窗口内失败多少次触发熔断，默认 3 */
  threshold?: number;
  /** 熔断持续时长（ms），默认 30 分钟 */
  openDurationMs?: number;
}

export interface CircuitBreakerStatus {
  key: string;
  open: boolean;
  failureCount: number;
  /** 熔断剩余秒数（未熔断为 0） */
  retryAfterSeconds: number;
  lastFailureAt?: number;
  openedAt?: number;
}

type Entry = {
  failures: number[];
  openedAt?: number;
  lastFailureAt?: number;
};

export class CircuitBreaker {
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly openDurationMs: number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.threshold = options.threshold ?? 3;
    this.openDurationMs = options.openDurationMs ?? 30 * 60 * 1000;
  }

  /** 记录一次失败，返回当前是否已熔断 */
  recordFailure(key: string): boolean {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { failures: [] };
      this.entries.set(key, entry);
    }
    entry.failures = entry.failures
      .filter((t) => now - t < this.windowMs)
      .concat(now);
    entry.lastFailureAt = now;

    if (entry.failures.length >= this.threshold) {
      entry.openedAt = now;
      return true;
    }
    return false;
  }

  /** 记录一次成功：重置失败计数（不清熔断态） */
  recordSuccess(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.failures = [];
    }
  }

  /** 是否熔断中 */
  isOpen(key: string): boolean {
    return this.getStatus(key).open;
  }

  /** 熔断状态详情 */
  getStatus(key: string): CircuitBreakerStatus {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.failures.length === 0) {
      return {
        key,
        open: false,
        failureCount: 0,
        retryAfterSeconds: 0,
      };
    }

    // 窗口过期清理
    entry.failures = entry.failures.filter((t) => now - t < this.windowMs);

    const openedAt = entry.openedAt;
    if (openedAt && now - openedAt < this.openDurationMs) {
      return {
        key,
        open: true,
        failureCount: entry.failures.length,
        retryAfterSeconds: Math.ceil(
          (this.openDurationMs - (now - openedAt)) / 1000,
        ),
        lastFailureAt: entry.lastFailureAt,
        openedAt,
      };
    }

    // 熔断期已过 → 恢复（清状态）
    if (openedAt) {
      this.entries.delete(key);
      return {
        key,
        open: false,
        failureCount: 0,
        retryAfterSeconds: 0,
      };
    }

    return {
      key,
      open: false,
      failureCount: entry.failures.length,
      retryAfterSeconds: 0,
      lastFailureAt: entry.lastFailureAt,
    };
  }

  /** 清空全部状态（测试/管理用） */
  reset(): void {
    this.entries.clear();
  }
}
