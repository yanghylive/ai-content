import { Module } from '@nestjs/common';
import { GeoBridgeController } from './geo-bridge.controller';
import { GeoBridgeService } from './geo-bridge.service';

@Module({
  controllers: [GeoBridgeController],
  providers: [GeoBridgeService],
})
export class GeoBridgeModule {}
