import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceTtsService } from './voice-tts.service';

describe('VoiceTtsService', () => {
  let service: VoiceTtsService;
  let config: { get: jest.Mock };

  const makeUser = () =>
    ({ kaypalUserId: 'usr_1' } as never);

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        const env: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_AI_PROXY_API_KEY: 'geo-test-key',
          KAYPAL_VOICE_TTS_MODEL: 'cosyvoice-v2',
          KAYPAL_VOICE_TTS_VOICE: 'Cherry',
        };
        return env[key] || '';
      }),
    };
    service = new VoiceTtsService(config as unknown as ConfigService);
  });

  it('rejects empty text', async () => {
    await expect(service.synthesize('', makeUser())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects when server API key missing', async () => {
    config.get.mockReturnValue('');
    await expect(
      service.synthesize('你好', makeUser()),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('returns stream on success and sends user id header', async () => {
    let sentBody: Record<string, unknown> = {};
    let sentHeaders: Record<string, string> = {};
    global.fetch = jest.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      sentHeaders = (opts.headers || {}) as Record<string, string>;
      sentBody = JSON.parse(String(opts.body));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
      };
    }) as never;
    const result = await service.synthesize('你好', makeUser());
    expect(sentBody.model).toBe('cosyvoice-v2');
    expect(sentBody.input).toBe('你好');
    expect(sentBody.voice).toBe('Cherry');
    expect(sentHeaders['x-kaypal-user-id']).toBe('usr_1');
    expect(result.contentType).toContain('audio');
    expect(result.stream).toBeDefined();
  });

  it('throws ServiceUnavailableException on gateway error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'upstream down' }),
    }) as never;
    await expect(service.synthesize('你好', makeUser())).rejects.toThrow(
      'upstream down',
    );
  });
});
