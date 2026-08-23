// 审批中心端点（Sprint 3 ApprovalGateService + 前端入口打通，Sprint 5）
// 高风险动作（首次私信/批量评论/批量触达/商机阶段变化）的审批列表与操作。
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApprovalGateService,
  type ApprovalAction,
} from './approval-gate.service';

@ApiTags('approval')
@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approvalGate: ApprovalGateService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireUser() {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { userId, tenantId };
  }

  @Get()
  @ApiOperation({ summary: '待审批列表（高风险动作）' })
  async listPending(@Query('limit') limit?: string) {
    const { tenantId } = await this.requireUser();
    return this.approvalGate.listPending(
      tenantId,
      Math.min(Number(limit) || 50, 200),
    );
  }

  @Post()
  @ApiOperation({
    summary: '创建审批（MAI-UI 外发动作：一次性+短时+内容 hash 绑定）',
  })
  async createApproval(
    @Body()
    body: {
      actionType: string;
      riskLevel?: string;
      inputHash: string;
      actionId: string;
      reason?: string;
    },
  ) {
    const { userId, tenantId } = await this.requireUser();
    if (!body.actionType || !body.inputHash || !body.actionId) {
      throw new BadRequestException('缺少 actionType/inputHash/actionId');
    }
    const riskLevel = body.riskLevel || 'medium';
    const created = await this.prisma.approval.create({
      data: {
        tenantId,
        userId,
        actionId: body.actionId,
        actionType: body.actionType,
        riskLevel,
        inputHash: body.inputHash,
        affectedLeadIds: [],
        excludedLeadIds: [],
        status: 'pending',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 分钟短时
      },
    });
    return {
      id: created.id,
      status: created.status,
      riskLevel: created.riskLevel,
      expiresAt: created.expiresAt,
    };
  }

  @Post(':id/consume')
  @ApiOperation({
    summary:
      '执行前消费审批（执行器校验：批准+未消费+hash 未变+未过期，一次性）',
  })
  async consumeApproval(
    @Param('id') id: string,
    @Body() body: { currentHash?: string },
  ) {
    const { tenantId } = await this.requireUser();
    return this.approvalGate.consume(tenantId, id, body?.currentHash);
  }

  @Post(':id/act')
  @ApiOperation({
    summary: '审批操作：approve/reject/request_changes/expire/resubmit',
  })
  act(
    @Param('id') id: string,
    @Body()
    body: {
      action: ApprovalAction;
      reason?: string;
      /** 审批时校验内容是否已变（inputHash 不匹配自动失效） */
      currentInput?: Record<string, unknown>;
    },
  ) {
    return this.requireUser().then(({ userId, tenantId }) =>
      this.approvalGate.act({
        tenantId,
        approvalId: id,
        action: body.action,
        approverId: userId,
        reason: body.reason,
        currentInput: body.currentInput as never,
      }),
    );
  }
}
