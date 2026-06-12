import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { RiskPolicyService } from './risk-policy.service';

@Controller('risk-policies')
export class RiskPolicyController {
  constructor(private readonly riskPolicyService: RiskPolicyService) {}

  @Get()
  listPolicies() {
    return this.riskPolicyService.listPolicies();
  }

  @Put(':action')
  upsertPolicy(@Param('action') action: string, @Body() body: any) {
    return this.riskPolicyService.upsertPolicy({ action, ...body });
  }
}
