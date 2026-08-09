import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { CrmModule } from '../crm/crm.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { VideoWorkshopModule } from '../video-workshop/video-workshop.module';
import { AiEmployeeController } from './ai-employee.controller';
import { AiEmployeeService } from './ai-employee.service';
import { AiEmployeeWorkflowService } from './ai-employee-workflow.service';

@Module({
  imports: [
    RuntimeModule,
    LocalEngineModule,
    VideoWorkshopModule,
    CrmModule,
    AutoUploadModule,
    AuthModule,
  ],
  controllers: [AiEmployeeController],
  providers: [AiEmployeeService, AiEmployeeWorkflowService],
  exports: [AiEmployeeService, AiEmployeeWorkflowService],
})
export class AiEmployeeModule {}
