import { Controller, Get, Headers } from '@nestjs/common';
import {
  LOCAL_BRIDGE_ACTIONS,
  type LocalBridgeAccount,
  type LocalBridgePlatformCapability,
  type LocalBridgeResponse,
  type LocalBridgeStatus,
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
}
