import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { ComplianceCheckDto } from './dto/compliance-check.dto';
import { QueryComplianceChecksDto } from './dto/query-compliance-checks.dto';

@ApiTags('合规审核')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

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
}
