import { Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { LocalBridgeController } from './local-bridge.controller';
import { LocalBridgeService } from './local-bridge.service';

@Module({
  imports: [AutoUploadModule, PlatformRegistryModule],
  controllers: [LocalBridgeController],
  providers: [LocalBridgeService],
  exports: [LocalBridgeService],
})
export class LocalBridgeModule {}
