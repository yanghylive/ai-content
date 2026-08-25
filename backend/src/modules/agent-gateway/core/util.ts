import crypto from 'crypto';

/** 用 SHA-256 生成确定性的内容哈希，用于 previewHash / checksum / inputHash */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 对对象做规范化(JSON key 排序)哈希，输入相同则哈希相同 */
export function hashJson(obj: unknown): string {
  return sha256(canonicalJson(obj));
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

let counter = 0;
/** 单调递增 + 随机后缀的唯一 ID，便于测试断言与避免碰撞 */
export function genId(prefix: string): string {
  counter += 1;
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
