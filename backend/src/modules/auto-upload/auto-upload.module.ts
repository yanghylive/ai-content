import { forwardRef, Module } from '@nestjs/common';
import { AutoUploadClient } from './auto-upload.client';
import { AutoUploadController } from './auto-upload.controller';
import { AutoUploadService } from './auto-upload.service';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { RuntimeModule } from '../runtime/runtime.module';

@Module({
  imports: [forwardRef(() => LocalEngineModule), forwardRef(() => RuntimeModule)],
  controllers: [AutoUploadController],
  providers: [AutoUploadClient, AutoUploadService],
  exports: [AutoUploadService],
})
export class AutoUploadModule {}
