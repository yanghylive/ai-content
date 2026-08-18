import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import {
  encryptSessionToken,
  decryptSessionToken,
} from './session-token-cipher';

/** 构造一个固定 key 的 envelope（mock ConfigService） */
function makeEnvelope(): CredentialEnvelopeService {
  const config = {
    get: (key: string) =>
      key === 'KAYPAL_CREDENTIAL_MASTER_KEY'
        ? Buffer.alloc(32, 1).toString('base64')
        : undefined,
  } as never;
  return new CredentialEnvelopeService(config);
}

describe('session-token-cipher（S4 会话 token 加密）', () => {
  let envelope: CredentialEnvelopeService;

  beforeEach(() => {
    envelope = makeEnvelope();
  });

  it('加密结果带 enc:v1: 前缀且不含明文', () => {
    const enc = encryptSessionToken(envelope, 'tok-abc-123');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain('tok-abc-123');
  });

  it('加密 → 解密往返一致', () => {
    const enc = encryptSessionToken(envelope, 'tok-abc-123');
    expect(decryptSessionToken(envelope, enc)).toBe('tok-abc-123');
  });

  it('存量明文兼容（无前缀直接返回）', () => {
    expect(decryptSessionToken(envelope, 'legacy-plain-token')).toBe(
      'legacy-plain-token',
    );
  });

  it('空值/非字符串返回 null', () => {
    expect(decryptSessionToken(envelope, null)).toBeNull();
    expect(decryptSessionToken(envelope, undefined)).toBeNull();
    expect(decryptSessionToken(envelope, '')).toBeNull();
    expect(decryptSessionToken(envelope, '   ')).toBeNull();
    expect(decryptSessionToken(envelope, 123 as unknown)).toBeNull();
  });

  it('篡改密文解密失败返回 null（不抛异常）', () => {
    const enc = encryptSessionToken(envelope, 'tok-abc');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(decryptSessionToken(envelope, tampered)).toBeNull();
  });

  it('不同 key 解密失败返回 null（跨实例不可读）', () => {
    const enc = encryptSessionToken(envelope, 'tok-abc');
    const otherConfig = {
      get: (key: string) =>
        key === 'KAYPAL_CREDENTIAL_MASTER_KEY'
          ? Buffer.alloc(32, 2).toString('base64')
          : undefined,
    } as never;
    const otherEnvelope = new CredentialEnvelopeService(otherConfig);
    expect(decryptSessionToken(otherEnvelope, enc)).toBeNull();
  });
});
