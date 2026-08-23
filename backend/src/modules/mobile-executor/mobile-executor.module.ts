import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { MobileExecutorController } from './mobile-executor.controller';
import { DeviceRegistryService } from './device-registry.service';
import { TaskDispatchService } from './task-dispatch.service';
import { ExecutorStatusService } from './executor-status.service';
import { ExecutorEvidenceService } from './executor-evidence.service';
import { ExecutorRunService } from './executor-run.service';
import { PlatformAccountService } from './platform-account.service';

/**
 * 手机执行器服务器侧（C 组/P5，主文档 4.3）
 * 设备注册/心跳 + 任务下发/领取 + 状态回传。
 * App 化后 mobile-agent 通过本模块 API 对接。
 */
@Module({
  imports: [WorkflowModule],
  controllers: [MobileExecutorController],
  providers: [
    DeviceRegistryService,
    TaskDispatchService,
    ExecutorStatusService,
    ExecutorEvidenceService,
    ExecutorRunService,
    PlatformAccountService,
  ],
  exports: [TaskDispatchService, DeviceRegistryService],
})
export class MobileExecutorModule {}
