import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AgentSService } from './agent-s.service';
import type {
  AgentSSidecarCreateSessionInput,
  AgentSSidecarRunTaskInput,
  AgentSSidecarApprovalDecisionInput,
} from './agent-s.service';

@Controller('agent-s')
export class AgentSController {
  constructor(private readonly agentSService: AgentSService) {}

  @Get('status')
  async getStatus() {
    return this.agentSService.getStatus({ refresh: true });
  }

  @Post('ensure-running')
  async ensureRunning() {
    return this.agentSService.ensureRunning();
  }

  @Post('stop')
  async stop() {
    return this.agentSService.stop();
  }

  @Get('health')
  async health() {
    return this.agentSService.health();
  }

  @Post('sessions')
  async createSession(@Body() input: AgentSSidecarCreateSessionInput) {
    return this.agentSService.createSession(input);
  }

  @Post('sessions/:sessionId/run')
  async runTask(
    @Param('sessionId') sessionId: string,
    @Body() input: AgentSSidecarRunTaskInput,
  ) {
    return this.agentSService.runTask(sessionId, input);
  }

  @Get('sessions/:sessionId/events')
  async getEvents(
    @Param('sessionId') sessionId: string,
    @Query('after_seq') afterSeq?: string,
  ) {
    const seq = afterSeq ? parseInt(afterSeq, 10) : undefined;
    return this.agentSService.getEvents(sessionId, seq);
  }

  @Post('sessions/:sessionId/cancel')
  async cancelSession(@Param('sessionId') sessionId: string) {
    return this.agentSService.cancelSession(sessionId);
  }

  @Post('sessions/:sessionId/approve')
  async approveSession(
    @Param('sessionId') sessionId: string,
    @Body() input: AgentSSidecarApprovalDecisionInput,
  ) {
    return this.agentSService.approveSession(sessionId, input);
  }

  @Get('sessions/:sessionId/artifacts')
  async getArtifacts(@Param('sessionId') sessionId: string) {
    return this.agentSService.getArtifacts(sessionId);
  }

  @Get('sessions/:sessionId/artifacts/:artifactId')
  async getArtifact(
    @Param('sessionId') sessionId: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.agentSService.getArtifact(sessionId, artifactId);
  }
}
