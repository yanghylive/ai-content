import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const CREDENTIAL_MASTER_KEY_ENV = 'KAYPAL_CREDENTIAL_MASTER_KEY';
export const CREDENTIAL_ENVELOPE_PREFIX = 'enc:v1:';

const SENSITIVE_CREDENTIAL_KEY =
  /(token|secret|password|passphrase|cookie|credential|authorization|api[_-]?key|private[_-]?key|access[_-]?key)/i;

export class CredentialMigrationRequiredError extends Error {
  constructor() {
    super('发布账号凭据仍是明文，请重新保存账号凭据以完成加密迁移');
    this.name = 'CredentialMigrationRequiredError';
  }
}

export class CredentialEnvelopeError extends Error {
  constructor(message = '发布账号凭据解密失败') {
    super(message);
    this.name = 'CredentialEnvelopeError';
  }
}

export function isSensitiveCredentialKey(key: string) {
  return SENSITIVE_CREDENTIAL_KEY.test(key);
}

function decodeMasterKey(value: string) {
  const configured = value.trim();
  let key: Buffer;
  try {
    if (configured.startsWith('hex:')) {
      key = Buffer.from(configured.slice(4), 'hex');
    } else if (configured.startsWith('base64:')) {
      key = Buffer.from(configured.slice(7), 'base64');
    } else if (/^[0-9a-fA-F]{64}$/.test(configured)) {
      key = Buffer.from(configured, 'hex');
    } else {
      key = Buffer.from(configured, 'base64');
    }
  } catch {
    throw new Error(
      `${CREDENTIAL_MASTER_KEY_ENV} must be a base64 or hex encoded 32-byte key`,
    );
  }

  if (key.length !== 32) {
    throw new Error(
      `${CREDENTIAL_MASTER_KEY_ENV} must be a base64 or hex encoded 32-byte key`,
    );
  }
  return key;
}

function decodeEnvelopePart(value: string, label: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CredentialEnvelopeError(`发布账号凭据密文 ${label} 无效`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (!decoded.length) {
    throw new CredentialEnvelopeError(`发布账号凭据密文 ${label} 无效`);
  }
  return decoded;
}

@Injectable()
export class CredentialEnvelopeService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const configured = config.get<string>(CREDENTIAL_MASTER_KEY_ENV)?.trim();
    if (!configured) {
      throw new Error(
        `${CREDENTIAL_MASTER_KEY_ENV} is required; refusing to start without a credential encryption key`,
      );
    }
    this.key = decodeMasterKey(configured);
  }

  isEncrypted(value: unknown): boolean {
    return (
      typeof value === 'string' && value.startsWith(CREDENTIAL_ENVELOPE_PREFIX)
    );
  }

  hasLegacyPlaintext(value: unknown) {
    return (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !this.isEncrypted(value)
    );
  }

  encryptString(value: string, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      CREDENTIAL_ENVELOPE_PREFIX + iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decryptString(value: string, context: string) {
    if (!this.isEncrypted(value)) {
      if (value.startsWith('enc:')) {
        throw new CredentialEnvelopeError('不支持的发布账号凭据加密版本');
      }
      throw new CredentialMigrationRequiredError();
    }

    const payload = value.slice(CREDENTIAL_ENVELOPE_PREFIX.length);
    const [ivRaw, authTagRaw, ciphertextRaw] = payload.split('.');
    if (!ivRaw || !authTagRaw || ciphertextRaw === undefined) {
      throw new CredentialEnvelopeError('发布账号凭据密文格式无效');
    }

    try {
      const iv = decodeEnvelopePart(ivRaw, 'nonce');
      const authTag = decodeEnvelopePart(authTagRaw, '认证标签');
      const ciphertext = ciphertextRaw
        ? Buffer.from(ciphertextRaw, 'base64url')
        : Buffer.alloc(0);
      if (iv.length !== 12 || authTag.length !== 16) {
        throw new CredentialEnvelopeError('发布账号凭据密文格式无效');
      }

      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      if (error instanceof CredentialEnvelopeError) throw error;
      throw new CredentialEnvelopeError(
        '发布账号凭据解密失败，请确认服务端主密钥未变更',
      );
    }
  }

  encryptSensitiveConfig(
    value: unknown,
    path = 'publishAccount.config',
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.encryptSensitiveConfig(item, `${path}[${index}]`),
      );
    }
    if (!value || typeof value !== 'object') return value ?? null;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const itemPath = `${path}.${key}`;
        if (
          isSensitiveCredentialKey(key) &&
          item !== null &&
          item !== undefined
        ) {
          return [key, this.encryptJsonValue(item, itemPath)];
        }
        return [key, this.encryptSensitiveConfig(item, itemPath)];
      }),
    );
  }

  decryptSensitiveConfig(
    value: unknown,
    path = 'publishAccount.config',
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.decryptSensitiveConfig(item, `${path}[${index}]`),
      );
    }
    if (!value || typeof value !== 'object') return value ?? null;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const itemPath = `${path}.${key}`;
        if (
          isSensitiveCredentialKey(key) &&
          item !== null &&
          item !== undefined
        ) {
          if (item === '') return [key, item];
          if (typeof item !== 'string')
            throw new CredentialMigrationRequiredError();
          return [key, this.decryptJsonValue(item, itemPath)];
        }
        return [key, this.decryptSensitiveConfig(item, itemPath)];
      }),
    );
  }

  hasLegacySensitiveConfig(value: unknown): boolean {
    if (Array.isArray(value))
      return value.some((item) => this.hasLegacySensitiveConfig(item));
    if (!value || typeof value !== 'object') return false;

    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => {
        if (isSensitiveCredentialKey(key)) {
          return item !== null && item !== undefined && !this.isEncrypted(item);
        }
        return this.hasLegacySensitiveConfig(item);
      },
    );
  }

  private encryptJsonValue(value: unknown, context: string) {
    return this.encryptString(JSON.stringify(value), context);
  }

  private decryptJsonValue(value: string, context: string) {
    try {
      return JSON.parse(this.decryptString(value, context)) as unknown;
    } catch (error) {
      if (error instanceof CredentialMigrationRequiredError) throw error;
      if (error instanceof CredentialEnvelopeError) throw error;
      throw new CredentialEnvelopeError('发布账号凭据内容格式无效');
    }
  }
}
