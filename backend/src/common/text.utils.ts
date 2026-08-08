/**
 * 安全字符串化工具。
 * 对象不会产生 '[object Object]'（no-base-to-string 规则的目标）：
 * - 字符串原样返回
 * - null/undefined 返回空串
 * - number/boolean/bigint 用 String()
 * - 对象 JSON 序列化（不丢信息），序列化失败退回空串
 */
export function safeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
