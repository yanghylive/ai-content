import { VoiceSettingsService } from './voice-settings.service';

describe('VoiceSettingsService', () => {
  let service: VoiceSettingsService;
  let prisma: {
    clientConfig: {
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      clientConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    service = new VoiceSettingsService(prisma as never);
  });

  it('getSettings masks secret keys', async () => {
    prisma.clientConfig.findMany.mockResolvedValue([
      { key: 'voice:asr:provider', value: 'aliyun' },
      { key: 'voice:asr:aliyunApiKey', value: 'sk-test-1234567890' },
    ]);
    const result = await service.getSettings('asr');
    expect(result.provider).toBe('aliyun');
    expect(result.aliyunApiKey).toBe('sk-t****7890');
    expect(result.aliyunApiKey).not.toContain('123456');
  });

  it('updateSettings skips masked secret values', async () => {
    await service.updateSettings('asr', {
      provider: 'aliyun',
      aliyunApiKey: '****',
    });
    // 只应该 upsert provider；掩码 aliyunApiKey 被跳过
    expect(prisma.clientConfig.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.clientConfig.upsert.mock.calls[0][0].where.key).toBe(
      'voice:asr:provider',
    );
  });

  it('updateSettings persists real secret values', async () => {
    await service.updateSettings('tts', { volcanoToken: 'tok-abc' });
    expect(prisma.clientConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'voice:tts:volcanoToken' },
      create: { key: 'voice:tts:volcanoToken', value: 'tok-abc', updatedAt: expect.any(String) },
      update: { value: 'tok-abc', updatedAt: expect.any(String) },
    });
  });

  it('getConfig returns raw values for backend use', async () => {
    prisma.clientConfig.findMany.mockResolvedValue([
      { key: 'voice:asr:aliyunApiKey', value: 'sk-real-secret' },
    ]);
    const result = await service.getConfig('asr');
    expect(result.aliyunApiKey).toBe('sk-real-secret');
  });
});
