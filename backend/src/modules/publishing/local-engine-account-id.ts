import { createHash } from 'crypto';

/**
 * 本地引擎发布账号的稳定 ID（跨模块统一规则）。
 *
 * 背景：publishing.service 与 auto-upload.client 曾各自生成不同格式的 ID
 * （ownerHash16 前缀 vs ownerKey12 后缀），同一账号被写入两条记录，
 * 导致账号列表重复/错乱、登录态识别失败。此处收敛为唯一规则：
 *   local-engine-{ownerHash16}-{engineAccountId}-{platform}
 * ownerHash = sha256(tenantId\u0000userId) 前 16 位，同租户同用户下稳定。
 *
 * 两个写入方（syncLocalEngineAccounts / saveLoginPublishAccount）必须都走这里。
 */
export function localEnginePublishAccountId(input: {
  engineAccountId: number;
  platform: string;
  scope: { tenantId?: string; userId?: string };
}): string {
  const { tenantId, userId } = input.scope;
  if (!tenantId || !userId) {
    // 无租户上下文（极早期/本地单机）：退回无 owner 前缀格式，仍带 engineAccountId。
    return `local-engine-${input.engineAccountId}-${input.platform}`;
  }
  const ownerHash = createHash('sha256')
    .update(`${tenantId}\u0000${userId}`)
    .digest('hex')
    .slice(0, 16);
  return `local-engine-${ownerHash}-${input.engineAccountId}-${input.platform}`;
}
