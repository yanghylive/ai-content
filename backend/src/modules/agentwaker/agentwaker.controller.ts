import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateAgentWakerRunDto } from './dto/create-agentwaker-run.dto';
import { AgentWakerService } from './agentwaker.service';
import { RequirePlans } from '../auth/roles.decorator';

@Controller('agentwaker')
export class AgentWakerController {
  constructor(private readonly agentWakerService: AgentWakerService) {}

  @Get('roles')
  listRoles() {
    return this.agentWakerService.listRoles();
  }

  @Get('runs')
  listRuns(@Query('limit') limit?: string) {
    return this.agentWakerService.listRuns(limit ? Number(limit) : 20);
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.agentWakerService.getRun(id);
  }

  @Post('runs')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  createRun(@Body() input: CreateAgentWakerRunDto) {
    return this.agentWakerService.createRun(input);
  }

  @Post('runs/:id/execute')
  @RequirePlans('STANDARD', 'PRO', 'ADVANCED', 'FLAGSHIP')
  executeRun(@Param('id') id: string) {
    return this.agentWakerService.executeRun(id);
  }
}
