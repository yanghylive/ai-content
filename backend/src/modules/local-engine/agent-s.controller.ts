import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { AgentSService } from '../agent-s/agent-s.service';
import { Public } from '../auth/auth.decorator';
import type {
  AgentSSidecarCreateSessionInput,
  AgentSSidecarRunTaskInput,
  AgentSSidecarApprovalDecisionInput,
} from '../agent-s/agent-s.service';

@Controller('agent-s')
export class AgentSController {
  private readonly agentSServiceSessionIds = new Set<string>();

  constructor(
    private readonly agentSService: AgentSService,
    private readonly nodeAgentRuntime: NodeAgentRuntimeService,
    private readonly configService: ConfigService,
  ) {}

  private useNodeRuntime(): boolean {
    const value = (
      this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || ''
    )
      .trim()
      .toLowerCase();
    return value !== '0' && value !== 'false';
  }

  private isRedfoxSkillHubInput(input?: {
    task_type?: string | null;
    metadata?: Record<string, unknown>;
  }): boolean {
    const metadata = input?.metadata || {};
    const values = [
      input?.task_type,
      metadata.task_type,
      metadata.provider,
      metadata.source,
      metadata.skill_id,
      metadata.skillCode,
      metadata.skill_code,
    ]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    return values.some((value) =>
      [
        'redfox.skillhub.run',
        'redfox-skillhub',
        'redfox_skillhub',
        'redfox.skillhub',
      ].includes(value),
    );
  }

  private isAgentConversationInput(input?: {
    task_type?: string | null;
    metadata?: Record<string, unknown>;
  }): boolean {
    const metadata = input?.metadata || {};
    return (
      metadata.conversation_mode === true ||
      metadata.source === 'agent-workbench' ||
      input?.task_type === 'agent.conversation' ||
      input?.task_type === 'agent.conversation.execute'
    );
  }

  private isWechatInteractionInput(input?: {
    task_type?: string | null;
    metadata?: Record<string, unknown>;
  }): boolean {
    const metadata = input?.metadata || {};
    const values = [
      input?.task_type,
      metadata.task_type,
      metadata.skill_id,
      metadata.agent_s_business_scenario,
    ]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    return values.some(
      (value) => value.startsWith('wechat.') || value.startsWith('wechat-'),
    );
  }

  private rememberAgentSServiceSession(result: {
    session?: { session_id?: string; id?: string };
  }) {
    const sessionId = result.session?.session_id || result.session?.id;
    if (sessionId) this.agentSServiceSessionIds.add(sessionId);
  }

  private shouldUseAgentSService(
    sessionId?: string,
    input?: {
      task_type?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): boolean {
    return (
      !this.useNodeRuntime() ||
      this.isRedfoxSkillHubInput(input) ||
      this.isAgentConversationInput(input) ||
      this.isWechatInteractionInput(input) ||
      Boolean(sessionId && this.agentSServiceSessionIds.has(sessionId))
    );
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
    if (this.shouldUseAgentSService(undefined, input)) {
      const result = await this.agentSService.createSession(input);
      this.rememberAgentSServiceSession(result);
      return result;
    }
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.createSession(input);
    }
    return this.agentSService.createSession(input);
  }

  @Get('sessions')
  async listConversationSessions(@Query('limit') limit?: string) {
    return this.agentSService.listConversationSessions(
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('sessions/:sessionId')
  async getConversationSession(@Param('sessionId') sessionId: string) {
    await this.agentSService.getEvents(sessionId);
    return await this.agentSService.getConversationSession(sessionId);
  }

  @Post('sessions/:sessionId/retry')
  async retryConversationSession(@Param('sessionId') sessionId: string) {
    return this.agentSService.retryConversationSession(sessionId);
  }

  @Post('sessions/:sessionId/run')
  async runTask(
    @Param('sessionId') sessionId: string,
    @Body() input: AgentSSidecarRunTaskInput,
  ) {
    if (
      this.shouldUseAgentSService(sessionId, input) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      if (this.isRedfoxSkillHubInput(input)) {
        this.agentSServiceSessionIds.add(sessionId);
      }
      return this.agentSService.runTask(sessionId, input);
    }
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
    if (
      this.shouldUseAgentSService(sessionId) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      return this.agentSService.getEvents(sessionId, seq);
    }
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getEvents(sessionId, seq);
    }
    return this.agentSService.getEvents(sessionId, seq);
  }

  @Post('sessions/:sessionId/cancel')
  async cancelSession(@Param('sessionId') sessionId: string) {
    if (
      this.shouldUseAgentSService(sessionId) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      return this.agentSService.cancelSession(sessionId);
    }
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
    if (
      this.shouldUseAgentSService(sessionId) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      return this.agentSService.approveSession(sessionId, input);
    }
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.approveSession(sessionId, input);
    }
    return this.agentSService.approveSession(sessionId, input);
  }

  @Get('sessions/:sessionId/artifacts')
  async getArtifacts(@Param('sessionId') sessionId: string) {
    if (
      this.shouldUseAgentSService(sessionId) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      return this.agentSService.getArtifacts(sessionId);
    }
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
    if (
      this.shouldUseAgentSService(sessionId) ||
      (await this.agentSService.isConversationSession(sessionId))
    ) {
      return this.agentSService.getArtifact(sessionId, artifactId);
    }
    if (this.useNodeRuntime()) {
      return this.nodeAgentRuntime.getArtifact(sessionId, artifactId);
    }
    return this.agentSService.getArtifact(sessionId, artifactId);
  }
}
