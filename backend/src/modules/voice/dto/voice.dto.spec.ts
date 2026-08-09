import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VoiceCommandDto, VoicePairDto } from './voice.dto';

describe('Voice DTOs', () => {
  it('keeps voice command fields when the global whitelist pipe validates DTOs', () => {
    const dto = plainToInstance(
      VoiceCommandDto,
      {
        text: '打开待确认',
        source: 'kaypal-web',
        platform: 'wechat',
        target: 'post',
        keyword: '新品活动',
        limit: '5',
        context: { note: 'from test panel' },
        ignored: 'stripped by Nest whitelist',
      },
      { enableImplicitConversion: true },
    );

    expect(validateSync(dto, { whitelist: true })).toEqual([]);
    expect(dto).toMatchObject({
      text: '打开待确认',
      source: 'kaypal-web',
      platform: 'wechat',
      target: 'post',
      keyword: '新品活动',
      limit: 5,
      context: { note: 'from test panel' },
    });
    expect('ignored' in dto).toBe(false);
  });

  it('keeps pairing ttl as a number after transformation', () => {
    const dto = plainToInstance(
      VoicePairDto,
      {
        clientKind: 'bailongma-desktop',
        clientName: 'BaiLongma',
        requestedTtlHours: '12',
      },
      { enableImplicitConversion: true },
    );

    expect(validateSync(dto, { whitelist: true })).toEqual([]);
    expect(dto.requestedTtlHours).toBe(12);
  });
});
