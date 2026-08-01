import { forwardRef, Module } from '@nestjs/common';
import { AutoUploadClient } from './auto-upload.client';
import { ArticleScraperService } from './article-scraper.service';
import { AutoUploadController } from './auto-upload.controller';
import { AutoUploadService } from './auto-upload.service';
import { DurablePublishCommandCoordinator } from './durable-publish-command.coordinator';
import { DurablePublishWorker } from './durable-publish.worker';
import { PublishRecordStore } from './publish-record.store';
import { RemoteImagePreprocessor } from './remote-image-preprocessor';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    forwardRef(() => LocalEngineModule),
    forwardRef(() => RuntimeModule),
    AuthModule,
  ],
  controllers: [AutoUploadController],
  providers: [
    AutoUploadClient,
    AutoUploadService,
    PublishRecordStore,
    DurablePublishCommandCoordinator,
    DurablePublishWorker,
    RemoteImagePreprocessor,
    ArticleScraperService,
  ],
  exports: [AutoUploadService, DurablePublishCommandCoordinator, PublishRecordStore, RemoteImagePreprocessor, ArticleScraperService],
})
export class AutoUploadModule {}
