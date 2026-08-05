import { Module } from '@nestjs/common';
import { CloudApiController } from './cloud-api.controller';
import { CloudApiService } from './cloud-api.service';

@Module({
  controllers: [CloudApiController],
  providers: [CloudApiService],
  exports: [CloudApiService],
})
export class CloudApiModule {}
