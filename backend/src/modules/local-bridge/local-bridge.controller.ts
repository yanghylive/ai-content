import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  LOCAL_BRIDGE_ACTIONS,
  type LocalBridgeAccount,
  type LocalBridgeCancelTaskRequest,
  type LocalBridgeCancelTaskResult,
  type LocalBridgeExecutePublishAcceptedResult,
  type LocalBridgeExecutePublishRequest,
  type LocalBridgePlatformCapability,
  type LocalBridgeResponse,
  type LocalBridgeStatus,
  type LocalBridgeTaskStatus,
} from './local-bridge.contract';
import { LocalBridgeService } from './local-bridge.service';

export const LOCAL_BRIDGE_TRACE_HEADER = 'x-jiuzhang-trace-id';

@Controller('local-bridge')
export class LocalBridgeController {
  constructor(private readonly localBridgeService: LocalBridgeService) {}

  @Get('status')
  getStatus(
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgeStatus>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
      () => this.localBridgeService.getStatus(),
    );
  }

  @Get('capabilities')
  listCapabilities(
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgePlatformCapability[]>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES,
      () => this.localBridgeService.listCapabilities(),
    );
  }

  @Get('accounts')
  listAccounts(
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgeAccount[]>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS,
      () => this.localBridgeService.listAccounts(),
    );
  }

  @Post('publish')
  @HttpCode(200)
  executePublish(
    @Body() body: LocalBridgeExecutePublishRequest,
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgeExecutePublishAcceptedResult>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.EXECUTE_PUBLISH,
      () => this.localBridgeService.executePublish(body),
    );
  }

  @Get('tasks/:taskId')
  getTaskStatus(
    @Param('taskId') taskId: string,
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgeTaskStatus>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.GET_TASK_STATUS,
      () => this.localBridgeService.getTaskStatus(taskId),
    );
  }

  @Post('tasks/:taskId/cancel')
  @HttpCode(200)
  cancelTask(
    @Param('taskId') taskId: string,
    @Body() body: LocalBridgeCancelTaskRequest,
    @Headers(LOCAL_BRIDGE_TRACE_HEADER) traceId?: string,
  ): Promise<LocalBridgeResponse<LocalBridgeCancelTaskResult>> {
    return this.localBridgeService.respond(
      traceId,
      LOCAL_BRIDGE_ACTIONS.CANCEL_TASK,
      () => this.localBridgeService.cancelTask(taskId, body),
    );
  }
}
