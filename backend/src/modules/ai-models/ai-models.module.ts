import { Module } from '@nestjs/common';
import { AiPlatformsController } from './ai-platforms.controller';
import { AiPlatformsService } from './ai-platforms.service';
import { AiModelsController } from './ai-models.controller';
import { AiModelsService } from './ai-models.service';
import { DefaultModelsController } from './default-models.controller';
import { DefaultModelsService } from './default-models.service';
import { AiClientService } from './ai-client.service';
import { StorageModule } from '../storage/storage.module';
import { KaypalModelSyncController } from './kaypal-model-sync.controller';
import { KaypalModelSyncService } from './kaypal-model-sync.service';

@Module({
  imports: [StorageModule],
  controllers: [AiPlatformsController, DefaultModelsController, AiModelsController, KaypalModelSyncController],
  providers: [AiPlatformsService, AiModelsService, DefaultModelsService, AiClientService, KaypalModelSyncService],
  exports: [AiClientService, AiModelsService, AiPlatformsService, DefaultModelsService, KaypalModelSyncService],
})
export class AiModelsModule { }
