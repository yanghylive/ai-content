import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { PlatformComplianceAuditService } from './platform-compliance-audit.service';
import { ComplianceCheckDto } from './dto/compliance-check.dto';
import { QueryComplianceChecksDto } from './dto/query-compliance-checks.dto';

@ApiTags('合规审核')
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    private readonly platformAudit: PlatformComplianceAuditService,
  ) {}

  @Post('check')
  @ApiOperation({ summary: '发布前合规审核' })
  check(@Body() dto: ComplianceCheckDto) {
    return this.complianceService.check(dto);
  }

  @Get('checks')
  @ApiOperation({ summary: '获取合规审核记录列表' })
  list(@Query() query: QueryComplianceChecksDto) {
    return this.complianceService.list(query);
  }

  @Get('platform-audit')
  @ApiOperation({ summary: '平台合规审计（授权/退订/删除/同意/隐私/条款）' })
  runPlatformAudit(@Req() request: Request) {
    const user = (request as unknown as { authUser?: { id?: string } }).authUser;
    const userId = user?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return this.platformAudit.auditAndPersist(userId);
  }
}
