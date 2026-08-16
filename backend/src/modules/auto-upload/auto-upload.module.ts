import { forwardRef, Global, Module } from '@nestjs/common';
import { AutoUploadClient } from './auto-upload.client';
import { ArticleScraperService } from './article-scraper.service';
import { AutoUploadController } from './auto-upload.controller';
import { AutoUploadService } from './auto-upload.service';
import { DurablePublishCommandCoordinator } from './durable-publish-command.coordinator';
import { DurablePublishWorker } from './durable-publish.worker';
import { PublishRecordStore } from './publish-record.store';
import { PublishTrackingService } from './publish-tracking.service';
import { RemoteImagePreprocessor } from './remote-image-preprocessor';
import { RuntimeModule } from '../runtime/runtime.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AuthModule } from '../auth/auth.module';
import { ActivationModule } from '../activation/activation.module';

// @Global：AutoUploadService 等被 local-engine 大量注入，全局导出后
// local-engine.module 无需反向 import 本模块，从而打破 madge 0 环门槛。
@Global()
@Module({
  imports: [
    forwardRef(() => RuntimeModule),
    // PlaywrightMcpService 由 LocalEngineModule 提供/导出，AutoUploadClient 依赖它
    forwardRef(() => LocalEngineModule),
    AuthModule,
    ActivationModule,
  ],
  controllers: [AutoUploadController],
  providers: [
    AutoUploadClient,
    AutoUploadService,
    PublishTrackingService,
    PublishRecordStore,
    DurablePublishCommandCoordinator,
    DurablePublishWorker,
    RemoteImagePreprocessor,
    ArticleScraperService,
  ],
  exports: [
    AutoUploadService,
    DurablePublishCommandCoordinator,
    PublishRecordStore,
    RemoteImagePreprocessor,
    ArticleScraperService,
  ],
})
export class AutoUploadModule {}
