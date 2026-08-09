import { ConfigService } from '@nestjs/config';
import {
  CREDENTIAL_ENVELOPE_PREFIX,
  CREDENTIAL_MASTER_KEY_ENV,
  CredentialEnvelopeService,
  CredentialMigrationRequiredError,
} from './credential-envelope.service';

const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

function serviceForTests(value = TEST_MASTER_KEY) {
  return new CredentialEnvelopeService({
    get: jest.fn(() => value),
  } as unknown as ConfigService);
}

describe('CredentialEnvelopeService', () => {
  it('fails closed when the master key is missing or invalid', () => {
    expect(
      () =>
        new CredentialEnvelopeService({
          get: jest.fn(() => undefined),
        } as unknown as ConfigService),
    ).toThrow(CREDENTIAL_MASTER_KEY_ENV);
    expect(() => serviceForTests('too-short')).toThrow(
      CREDENTIAL_MASTER_KEY_ENV,
    );
  });

  it('encrypts and decrypts a value with an enc:v1 envelope', () => {
    const service = serviceForTests();
    const encrypted = service.encryptString(
      'access-token',
      'publishAccount.apiToken',
    );

    expect(encrypted.startsWith(CREDENTIAL_ENVELOPE_PREFIX)).toBe(true);
    expect(encrypted).not.toContain('access-token');
    expect(service.decryptString(encrypted, 'publishAccount.apiToken')).toBe(
      'access-token',
    );
    expect(() => service.decryptString(encrypted, 'other-context')).toThrow(
      '发布账号凭据解密失败',
    );
  });

  it('encrypts sensitive config values while preserving public config values', () => {
    const service = serviceForTests();
    const encrypted = service.encryptSensitiveConfig({
      apiUrl: 'https://publisher.example.test',
      apiKey: 'key-1',
      nested: { password: 'password-1', label: 'public' },
    }) as Record<string, unknown>;

    expect(encrypted.apiUrl).toBe('https://publisher.example.test');
    expect(encrypted.apiKey).toEqual(expect.stringMatching(/^enc:v1:/));
    expect((encrypted.nested as Record<string, unknown>).password).toEqual(
      expect.stringMatching(/^enc:v1:/),
    );
    expect(service.decryptSensitiveConfig(encrypted)).toEqual({
      apiUrl: 'https://publisher.example.test',
      apiKey: 'key-1',
      nested: { password: 'password-1', label: 'public' },
    });
  });

  it('requires migration before using legacy plaintext credentials', () => {
    const service = serviceForTests();

    expect(() =>
      service.decryptString('legacy-token', 'publishAccount.apiToken'),
    ).toThrow(CredentialMigrationRequiredError);
    expect(
      service.hasLegacySensitiveConfig({ nested: { secret: 'legacy' } }),
    ).toBe(true);
    expect(
      service.hasLegacySensitiveConfig({
        secret: service.encryptString('x', 'publishAccount.config.secret'),
      }),
    ).toBe(false);
  });
});
