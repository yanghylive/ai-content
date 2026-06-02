import { Module } from '@nestjs/common';
import { CloudApiService } from './cloud-api.service';

@Module({
  providers: [CloudApiService],
  exports: [CloudApiService],
})
export class CloudApiModule {}
