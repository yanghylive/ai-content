import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RiskPolicyService } from './risk-policy.service';

type RiskPolicyRequest = Request & {
  authSessionId?: string;
  authUser?: {
    id?: string;
    role?: string;
    name?: string;
    username?: string;
    email?: string;
  };
};

type RiskPolicyUpdateBody = {
  riskLevel?: string;
  requireConfirm?: boolean;
  autoExecute?: boolean;
  forbidden?: boolean;
  minPlan?: string;
  allowedRoles?: string[];
  whitelist?: string[];
  description?: string;
};

@Controller('risk-policies')
export class RiskPolicyController {
  constructor(private readonly riskPolicyService: RiskPolicyService) {}

  @Get()
  listPolicies() {
    return this.riskPolicyService.listPolicies();
  }

  @Post('approvals')
  issueApproval(
    @Req() request: RiskPolicyRequest,
    @Body()
    body: {
      action?: string;
      riskLevel?: string;
      target?: string;
      reason?: string;
    },
  ) {
    const userId = request.authUser?.id;
    const sessionId = request.authSessionId;
    if (!userId || !sessionId) {
      throw new ForbiddenException('当前登录状态不能确认高风险操作');
    }
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: body?.action || '',
        riskLevel: body?.riskLevel || '',
        target: body?.target,
        reason: body?.reason,
      },
      {
        userId,
        sessionId,
        operator:
          request.authUser?.name ||
          request.authUser?.username ||
          request.authUser?.email ||
          userId,
      },
    );
  }

  @Put(':action')
  upsertPolicy(
    @Req() request: RiskPolicyRequest,
    @Param('action') action: string,
    @Body() body: RiskPolicyUpdateBody,
  ) {
    if (request.authUser?.role !== 'admin') {
      throw new ForbiddenException('只有管理员可以修改风险策略');
    }
    return this.riskPolicyService.upsertPolicy({ ...body, action });
  }
}
