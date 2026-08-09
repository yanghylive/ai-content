import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { VoiceAsrService } from './voice-asr.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { VoiceSettingsService } from './voice-settings.service';
import { VoiceTtsService } from './voice-tts.service';

@Module({
  imports: [
    PrismaModule,
    BillingModule,
    LocalEngineModule,
    IntelligenceModule,
    AiModelsModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceAsrService, VoiceTtsService, VoiceSettingsService],
  exports: [VoiceService, VoiceSettingsService],
})
export class VoiceModule {}
