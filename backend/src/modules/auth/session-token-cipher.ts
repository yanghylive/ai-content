import {
  CredentialEnvelopeService,
  CREDENTIAL_ENVELOPE_PREFIX,
} from '../../common/credential-envelope.service';

/**
 * Kaypal Desktop 会话 token 加解密（S4 修复，2026-08-18）。
 *
 * 背景：userSession.metadata 中 kaypalDesktopAccessToken / kaypalDesktopRefreshToken
 * 曾明文落盘（SQLite 库被读即泄露 Kaypal 账号）。现复用 credential-envelope
 * （AES-256-GCM + KAYPAL_CREDENTIAL_MASTER_KEY）加密存储，前缀 enc:v1: 标记。
 *
 * 兼容策略：读取时无前缀视为存量明文直接返回（历史会话无需重登即可平滑迁移）；
 * 解密失败返回 null（视为不可用，登录链路会自动重取/要求重新登录）。
 */
const SESSION_TOKEN_CONTEXT = 'kaypal-desktop-session';

export function encryptSessionToken(
  envelope: CredentialEnvelopeService,
  token: string,
): string {
  // encryptString 返回值已含 enc:v1: 前缀，勿重复拼接
  return envelope.encryptString(token, SESSION_TOKEN_CONTEXT);
}

export function decryptSessionToken(
  envelope: CredentialEnvelopeService,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(CREDENTIAL_ENVELOPE_PREFIX)) {
    return trimmed; // 存量明文兼容
  }
  try {
    return envelope.decryptString(trimmed, SESSION_TOKEN_CONTEXT);
  } catch {
    return null;
  }
}
