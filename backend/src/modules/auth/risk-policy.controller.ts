import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { RiskPolicyService } from './risk-policy.service';
import { RequireKaypalRoles } from './roles.decorator';

type RiskPolicyRequest = {
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
};

@Controller('risk-policies')
export class RiskPolicyController {
  constructor(private readonly riskPolicyService: RiskPolicyService) {}

  @Get()
  listPolicies() {
    return this.riskPolicyService.listPolicies();
  }

  @Put(':action')
  @RequireKaypalRoles('SUPER_ADMIN')
  upsertPolicy(
    @Param('action') action: string,
    @Body() body: any,
    @Req() request: RiskPolicyRequest,
  ) {
    if (
      request.kaypalRole !== 'SUPER_ADMIN' &&
      request.kaypalPlatformRole !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException('此操作需要 SUPER_ADMIN 角色');
    }
    return this.riskPolicyService.upsertPolicy({ action, ...body });
  }
}
