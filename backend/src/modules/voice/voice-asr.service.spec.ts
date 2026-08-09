import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceAsrService } from './voice-asr.service';

describe('VoiceAsrService', () => {
  let service: VoiceAsrService;
  let config: { get: jest.Mock };

  const makeUser = () =>
    ({ kaypalUserId: 'usr_1' } as never);

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        const env: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_AI_PROXY_API_KEY: 'geo-test-key',
          KAYPAL_VOICE_ASR_MODEL: 'paraformer-realtime-v2',
        };
        return env[key] || '';
      }),
    };
    service = new VoiceAsrService(config as unknown as ConfigService);
  });

  it('rejects when server API key missing', async () => {
    config.get.mockReturnValue('');
    await expect(service.transcribePcm(Buffer.alloc(100), makeUser())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailableException on gateway error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key' } }),
    }) as never;
    await expect(
      service.transcribePcm(Buffer.alloc(3200), makeUser()),
    ).rejects.toThrow('bad key');
  });

  it('returns text on success and attaches user id header', async () => {
    let sentHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      sentHeaders = (opts.headers || {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: '你好世界' }),
      };
    }) as never;
    const result = await service.transcribePcm(Buffer.alloc(3200), makeUser());
    expect(result.text).toBe('你好世界');
    expect(sentHeaders['x-kaypal-api-key']).toBe('geo-test-key');
    expect(sentHeaders['x-kaypal-user-id']).toBe('usr_1');
  });

  it('pcmToWav produces valid RIFF header', () => {
    const wav = (service as unknown as { pcmToWav(p: Buffer): Buffer }).pcmToWav(
      Buffer.alloc(1600, 0x7f),
    );
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
  });
});
