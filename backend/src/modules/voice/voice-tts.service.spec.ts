import { Readable } from 'stream';
import { VoiceTtsService } from './voice-tts.service';

jest.mock('./vendor/tts-providers', () => ({
  streamTTS: jest.fn().mockResolvedValue(Readable.from([Buffer.from('fake-audio')])),
  TTS_PROVIDERS: [
    { id: 'doubao', label: '豆包' },
    { id: 'minimax', label: 'MiniMax' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'elevenlabs', label: 'ElevenLabs' },
    { id: 'volcano', label: '火山引擎' },
  ],
  TTS_VOICES: { volcano: [{ id: 'BV001_streaming', label: '默认音色' }] },
  validateTTSConfig: jest.fn().mockImplementation((cfg: Record<string, unknown>) => {
    if (cfg.provider === 'volcano' && cfg.volcanoAppId && cfg.volcanoToken) {
      return { ok: true };
    }
    return { ok: false, provider: cfg.provider, missing: ['AppId', 'Token'], guide: '缺少凭证' };
  }),
}));

describe('VoiceTtsService', () => {
  let service: VoiceTtsService;
  let settings: { getConfig: jest.Mock };

  beforeEach(() => {
    settings = { getConfig: jest.fn() };
    service = new VoiceTtsService(settings as never);
  });

  it('rejects empty text', async () => {
    await expect(service.synthesize('')).rejects.toThrow('TTS 文本为空');
    await expect(service.synthesize('   ')).rejects.toThrow('TTS 文本为空');
  });

  it('rejects when provider credentials missing', async () => {
    settings.getConfig.mockResolvedValue({});
    await expect(service.synthesize('你好')).rejects.toThrow(
      /未配置完整|语音合成失败/,
    );
  });

  it('returns stream when credentials present', async () => {
    settings.getConfig.mockResolvedValue({
      provider: 'volcano',
      voiceId: 'BV001_streaming',
      volcanoAppId: 'app1',
      volcanoToken: 'tok1',
    });
    const result = await service.synthesize('你好');
    expect(result.provider).toBe('volcano');
    expect(result.contentType).toContain('audio');
    expect(result.stream).toBeDefined();
  });

  it('lists capabilities', () => {
    const caps = service.listCapabilities();
    expect(caps.providers.length).toBeGreaterThanOrEqual(5);
    expect(caps.voices).toBeDefined();
  });
});
