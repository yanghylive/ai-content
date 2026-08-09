import { Global, Module } from '@nestjs/common';
import { SystemLogsService } from './system-logs.service';

@Global()
@Module({
  providers: [SystemLogsService],
  exports: [SystemLogsService],
})
export class SystemLogsModule {}
