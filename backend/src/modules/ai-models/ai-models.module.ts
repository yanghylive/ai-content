import { Module } from '@nestjs/common';
import { AiAuditModule } from '../ai-audit/ai-audit.module';
import { SavingsModule } from '../savings/savings.module';
import { AiPlatformsController } from './ai-platforms.controller';
import { AiPlatformsService } from './ai-platforms.service';
import { AiModelsController } from './ai-models.controller';
import { AiModelsService } from './ai-models.service';
import { DefaultModelsController } from './default-models.controller';
import { DefaultModelsService } from './default-models.service';
import { AiClientService } from './ai-client.service';
import { KaypalProviderResolver } from './kaypal-provider.resolver';
import { StorageModule } from '../storage/storage.module';
import { KaypalModelSyncController } from './kaypal-model-sync.controller';
import { KaypalModelSyncService } from './kaypal-model-sync.service';
import { LlmProxyController } from './llm-proxy.controller';

@Module({
  imports: [StorageModule, SavingsModule, AiAuditModule],
  controllers: [
    AiPlatformsController,
    DefaultModelsController,
    AiModelsController,
    KaypalModelSyncController,
    LlmProxyController,
  ],
  providers: [
    AiPlatformsService,
    AiModelsService,
    DefaultModelsService,
    AiClientService,
    KaypalModelSyncService,
    KaypalProviderResolver,
  ],
  exports: [
    AiClientService,
    AiModelsService,
    AiPlatformsService,
    DefaultModelsService,
    KaypalModelSyncService,
    KaypalProviderResolver,
  ],
})
export class AiModelsModule {}
