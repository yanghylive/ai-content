import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DeviceRegistryService } from './device-registry.service';
import { TaskDispatchService } from './task-dispatch.service';
import { ExecutorStatusService } from './executor-status.service';
import { ExecutorEvidenceService } from './executor-evidence.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * 手机执行器（C 组/P5 服务器侧）
 * 设备：注册/心跳/列表/注销；任务：创建/领取/列表/取消/状态回传
 */
@ApiTags('手机执行器（C 组）')
@Controller('mobile-executor')
export class MobileExecutorController {
  constructor(
    private readonly devices: DeviceRegistryService,
    private readonly dispatch: TaskDispatchService,
    private readonly status: ExecutorStatusService,
    private readonly evidence: ExecutorEvidenceService,
  ) {}

  private requireUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return request.authUser;
  }

  // ---------- 设备 ----------

  @Post('devices')
  @ApiOperation({ summary: '注册手机设备（agent 启动时调用）' })
  registerDevice(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: { deviceName: string; platform?: string; agentVersion?: string },
  ) {
    const user = this.requireUser(request);
    return this.devices.register(user.id, input || {});
  }

  @Post('devices/:id/heartbeat')
  @ApiOperation({ summary: '设备心跳（agent 周期上报，标记在线）' })
  heartbeat(
    @Req() request: AuthenticatedRequest,
    @Param('id') deviceId: string,
  ) {
    const user = this.requireUser(request);
    return this.devices.heartbeat(user.id, deviceId);
  }

  @Get('devices')
  @ApiOperation({ summary: '我的设备列表（含在线状态）' })
  listDevices(@Req() request: AuthenticatedRequest) {
    const user = this.requireUser(request);
    return this.devices.list(user.id);
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: '注销设备' })
  deregisterDevice(
    @Req() request: AuthenticatedRequest,
    @Param('id') deviceId: string,
  ) {
    const user = this.requireUser(request);
    return this.devices.deregister(user.id, deviceId);
  }

  // ---------- 任务 ----------

  @Post('tasks')
  @ApiOperation({ summary: '创建发布任务（schedule_publish 到点触发）' })
  createTask(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: {
      type?: string;
      payload: Record<string, unknown>;
      deviceId?: string;
    },
  ) {
    const user = this.requireUser(request);
    if (!input?.payload) throw new BadRequestException('payload 不能为空');
    return this.dispatch.createTask(user.id, input);
  }

  @Post('tasks/claim')
  @ApiOperation({ summary: '领取待办任务（agent 调用，指定 deviceId）' })
  claimTask(
    @Req() request: AuthenticatedRequest,
    @Body() input: { deviceId: string },
  ) {
    const user = this.requireUser(request);
    if (!input?.deviceId) throw new BadRequestException('需要 deviceId');
    return this.dispatch.claimNext(user.id, input.deviceId);
  }

  @Get('leases')
  @ApiOperation({ summary: '活跃租约列表（设备中心）' })
  listLeases(@Req() request: AuthenticatedRequest) {
    const user = this.requireUser(request);
    return this.dispatch.listActiveLeases(user.id);
  }

  @Get('tasks')
  @ApiOperation({ summary: '我的任务列表' })
  listTasks(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const user = this.requireUser(request);
    return this.dispatch.listTasks(user.id, limit ? Number(limit) : undefined);
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: '取消排队任务' })
  cancelTask(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
  ) {
    const user = this.requireUser(request);
    return this.dispatch.cancelTask(user.id, taskId);
  }

  @Post('tasks/:id/evidence')
  @ApiOperation({ summary: '上传任务执行证据（截图/节点树/结果）' })
  addEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body()
    input: {
      type: string;
      stepIndex?: number;
      content: Record<string, unknown>;
    },
  ) {
    const user = this.requireUser(request);
    return this.evidence.addEvidence(user.id, taskId, input);
  }

  @Get('tasks/:id/evidence')
  @ApiOperation({ summary: '查询任务证据列表' })
  listEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
  ) {
    const user = this.requireUser(request);
    return this.evidence.listEvidence(user.id, taskId);
  }

  @Post('tasks/:id/status')
  @ApiOperation({ summary: '回传执行状态（running/done/failed）' })
  reportStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body()
    input: {
      status: 'running' | 'done' | 'failed';
      result?: Record<string, unknown>;
      error?: string;
    },
  ) {
    const user = this.requireUser(request);
    if (!input?.status) throw new BadRequestException('缺少 status');
    return this.status.report(user.id, taskId, input);
  }
}
