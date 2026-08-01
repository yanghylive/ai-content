import { forwardRef, Module } from '@nestjs/common';
import { AutoUploadClient } from './auto-upload.client';
import { AutoUploadController } from './auto-upload.controller';
import { AutoUploadService } from './auto-upload.service';
import { DurablePublishCommandCoordinator } from './durable-publish-command.coordinator';
import { PublishRecordStore } from './publish-record.store';
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
  ],
  exports: [AutoUploadService, DurablePublishCommandCoordinator],
})
export class AutoUploadModule {}
