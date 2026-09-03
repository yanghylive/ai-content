import { Module } from '@nestjs/common';
import { AiEmployeeModule } from '../ai-employee/ai-employee.module';
import { CapabilityDirectoryController } from './capability-directory.controller';
import { CapabilityDirectoryService } from './capability-directory.service';

@Module({
  imports: [AiEmployeeModule],
  controllers: [CapabilityDirectoryController],
  providers: [CapabilityDirectoryService],
  exports: [CapabilityDirectoryService],
})
export class CapabilityDirectoryModule {}
