import { Module } from '@nestjs/common';
import { MobileExecutorController } from './mobile-executor.controller';
import { DeviceRegistryService } from './device-registry.service';
import { TaskDispatchService } from './task-dispatch.service';
import { ExecutorStatusService } from './executor-status.service';

/**
 * 手机执行器服务器侧（C 组/P5，主文档 4.3）
 * 设备注册/心跳 + 任务下发/领取 + 状态回传。
 * App 化后 mobile-agent 通过本模块 API 对接。
 */
@Module({
  controllers: [MobileExecutorController],
  providers: [
    DeviceRegistryService,
    TaskDispatchService,
    ExecutorStatusService,
  ],
  exports: [TaskDispatchService, DeviceRegistryService],
})
export class MobileExecutorModule {}
