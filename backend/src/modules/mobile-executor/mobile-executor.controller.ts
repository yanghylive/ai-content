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
import { ExecutorRunService } from './executor-run.service';
import { ApprovalGateService } from '../workflow/approval-gate.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    private readonly run: ExecutorRunService,
    private readonly approvalGate: ApprovalGateService,
    private readonly prisma: PrismaService,
  ) {}

  private requireUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return request.authUser;
  }

  /** 设备侧接口认证：校验 x-device-token → { userId, deviceId }（P0-4） */
  private async requireDevice(request: AuthenticatedRequest): Promise<{
    userId: string;
    deviceId: string;
  }> {
    const token = String(request.headers['x-device-token'] || '');
    const dev = token ? await this.devices.verifyDeviceToken(token) : null;
    if (!dev) {
      throw new UnauthorizedException(
        '设备认证失败（缺少或无效 device token）',
      );
    }
    return dev;
  }

  // ---------- 设备 ----------

  @Post('devices')
  @ApiOperation({ summary: '注册手机设备（agent 启动时调用）' })
  registerDevice(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: {
      deviceName: string;
      platform?: string;
      agentVersion?: string;
      deviceUuid?: string;
      capabilities?: Record<string, unknown>;
    },
  ) {
    const user = this.requireUser(request);
    return this.devices.register(user.id, input || {});
  }

  @Post('devices/:id/heartbeat')
  @ApiOperation({
    summary: '设备心跳（agent 周期上报，标记在线；x-device-token 认证）',
  })
  async heartbeat(
    @Req() request: AuthenticatedRequest,
    @Param('id') deviceId: string,
  ) {
    const dev = await this.requireDevice(request);
    if (dev.deviceId !== deviceId) {
      throw new UnauthorizedException('token 与设备不匹配');
    }
    return this.devices.heartbeat(dev.userId, dev.deviceId);
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
  @ApiOperation({
    summary:
      '领取待办任务（agent 调用；x-device-token 认证，deviceId 从 token 解析）',
  })
  async claimTask(@Req() request: AuthenticatedRequest) {
    const dev = await this.requireDevice(request);
    return this.dispatch.claimNext(dev.userId, dev.deviceId);
  }

  @Post('approvals/:id/consume')
  @ApiOperation({
    summary: '执行器消费审批（x-device-token 认证，执行外发前校验一次性）',
  })
  async consumeApproval(
    @Req() request: AuthenticatedRequest,
    @Param('id') approvalId: string,
    @Body() body: { currentHash?: string },
  ) {
    const dev = await this.requireDevice(request);
    // 设备 token → userId → 默认租户（设备侧无 session context，从 tenant_members 取）
    const member = await this.prisma.tenantMember.findFirst({
      where: { userId: dev.userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!member) throw new BadRequestException('设备所属用户无租户');
    return this.approvalGate.consume(
      member.tenantId,
      approvalId,
      body?.currentHash,
    );
  }

  @Post('tasks/:id/run')
  @ApiOperation({
    summary:
      '开始一次执行会话（P1-12；x-device-token 认证，deviceId 从 token）',
  })
  async startRun(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body() body: { accountId?: string },
  ) {
    const dev = await this.requireDevice(request);
    return this.run.startRun(dev.userId, taskId, dev.deviceId, body?.accountId);
  }

  @Post('runs/:id/step')
  @ApiOperation({
    summary: '上报单步进度 + 断点（P1-12；x-device-token 认证）',
  })
  async stepRun(
    @Req() request: AuthenticatedRequest,
    @Param('id') runId: string,
    @Body()
    body: {
      stepIndex: number;
      type: string;
      status?: string;
      detail?: Record<string, unknown>;
      checkpoint?: string;
    },
  ) {
    const dev = await this.requireDevice(request);
    if (body?.stepIndex === undefined || !body?.type) {
      throw new BadRequestException('缺少 stepIndex/type');
    }
    return this.run.stepRun(dev.userId, runId, body);
  }

  @Post('runs/:id/finish')
  @ApiOperation({ summary: '执行会话终态收尾（P1-12；x-device-token 认证）' })
  async finishRun(
    @Req() request: AuthenticatedRequest,
    @Param('id') runId: string,
    @Body()
    body: { status: 'completed' | 'failed' | 'unknown'; checkpoint?: string },
  ) {
    const dev = await this.requireDevice(request);
    if (!body?.status) throw new BadRequestException('缺少 status');
    return this.run.finishRun(dev.userId, runId, body.status, body.checkpoint);
  }

  @Get('tasks/:id/run')
  @ApiOperation({ summary: '查询执行会话断点（P1-12 断点恢复）' })
  getRun(@Req() request: AuthenticatedRequest, @Param('id') taskId: string) {
    const user = this.requireUser(request);
    return this.run.getRun(user.id, taskId);
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
  @ApiOperation({ summary: '上传任务执行证据（x-device-token 认证）' })
  async addEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body()
    input: {
      type: string;
      stepIndex?: number;
      content: Record<string, unknown>;
      modelVersion?: string;
      policyVersion?: string;
      approvalId?: string;
      collectedAt?: string;
    },
  ) {
    const dev = await this.requireDevice(request);
    return this.evidence.addEvidence(dev.userId, taskId, {
      ...input,
      deviceId: dev.deviceId,
    });
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
  @ApiOperation({
    summary: '回传执行状态（x-device-token 认证，deviceId 从 token 解析）',
  })
  async reportStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body()
    input: {
      status: 'running' | 'done' | 'failed' | 'unknown';
      result?: Record<string, unknown>;
      error?: string;
    },
  ) {
    const dev = await this.requireDevice(request);
    if (!input?.status) throw new BadRequestException('缺少 status');
    return this.status.report(dev.userId, taskId, {
      ...input,
      deviceId: dev.deviceId,
    });
  }
}
