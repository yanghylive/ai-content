import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { AgentSService } from './agent-s.service';
import { Public } from '../auth/auth.decorator';
import type {
  AgentSSidecarCreateSessionInput,
  AgentSSidecarRunTaskInput,
  AgentSSidecarApprovalDecisionInput,
} from './agent-s.service';

@Controller('agent-s')
export class AgentSController {
  constructor(
    private readonly agentSService: AgentSService,
    private readonly nodeAgentRuntime: NodeAgentRuntimeService,
    private readonly configService: ConfigService,
  ) {}

  private useNodeRuntime(): boolean {
    const value = (this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || '')
      .trim()
      .toLowerCase();
    return value !== '0' && value !== 'false';
  }

  @Get('status')
  @Public()
  async getStatus() {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getStatus();
    }
    return this.agentSService.getStatus({ refresh: true });
  }

  @Post('ensure-running')
  async ensureRunning() {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.ensureRunning();
    }
    return this.agentSService.ensureRunning();
  }

  @Post('stop')
  async stop() {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.stop();
    }
    return this.agentSService.stop();
  }

  @Get('health')
  @Public()
  async health() {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.health();
    }
    return this.agentSService.health();
  }

  @Post('sessions')
  async createSession(@Body() input: AgentSSidecarCreateSessionInput) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.createSession(input);
    }
    return this.agentSService.createSession(input);
  }

  @Post('sessions/:sessionId/run')
  async runTask(
    @Param('sessionId') sessionId: string,
    @Body() input: AgentSSidecarRunTaskInput,
  ) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.runTask(sessionId, input);
    }
    return this.agentSService.runTask(sessionId, input);
  }

  @Get('sessions/:sessionId/events')
  async getEvents(
    @Param('sessionId') sessionId: string,
    @Query('after_seq') afterSeq?: string,
  ) {
    const seq = afterSeq ? parseInt(afterSeq, 10) : undefined;
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getEvents(sessionId, seq);
    }
    return this.agentSService.getEvents(sessionId, seq);
  }

  @Post('sessions/:sessionId/cancel')
  async cancelSession(@Param('sessionId') sessionId: string) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.cancelSession(sessionId);
    }
    return this.agentSService.cancelSession(sessionId);
  }

  @Post('sessions/:sessionId/approve')
  async approveSession(
    @Param('sessionId') sessionId: string,
    @Body() input: AgentSSidecarApprovalDecisionInput,
  ) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.approveSession(sessionId, input);
    }
    return this.agentSService.approveSession(sessionId, input);
  }

  @Get('sessions/:sessionId/artifacts')
  async getArtifacts(@Param('sessionId') sessionId: string) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getArtifacts(sessionId);
    }
    return this.agentSService.getArtifacts(sessionId);
  }

  @Get('sessions/:sessionId/artifacts/:artifactId')
  async getArtifact(
    @Param('sessionId') sessionId: string,
    @Param('artifactId') artifactId: string,
  ) {
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getArtifact(sessionId, artifactId);
    }
    return this.agentSService.getArtifact(sessionId, artifactId);
  }
}
