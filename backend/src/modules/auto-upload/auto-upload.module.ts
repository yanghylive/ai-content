import { Module } from '@nestjs/common';
import { AutoUploadClient } from './auto-upload.client';
import { AutoUploadController } from './auto-upload.controller';
import { AutoUploadService } from './auto-upload.service';

@Module({
  controllers: [AutoUploadController],
  providers: [AutoUploadClient, AutoUploadService],
  exports: [AutoUploadService],
})
export class AutoUploadModule {}
