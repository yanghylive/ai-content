import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AgentSService } from '../agent-s/agent-s.service';
import { RunRedfoxSkillDto } from './dto/run-redfox-skill.dto';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxService } from './redfox.service';
import {
  findRedfoxSkillMapping,
  findRedfoxSkillMappingByPath,
  type RedfoxSkillHubRef,
  type RedfoxSkillMapping,
} from './redfox-skill-mapping.catalog';
import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';
import type {
  RedfoxClientRequestOptions,
  RedfoxScope,
  RedfoxSkill,
  RedfoxSkillRunResult,
  RedfoxSkillRunStatus,
} from './redfox.types';

@Injectable()
export class RedfoxSkillRunnerService {
  constructor(
    private readonly config: ConfigService,
    private readonly redfoxService: RedfoxService,
    private readonly redfoxClient: RedfoxClientService,
    private readonly skills: RedfoxSkillCatalogService,
    @Optional() private readonly agentS?: AgentSService,
  ) {}

  async runSkill(
    actor: AuthenticatedUser,
    dto: RunRedfoxSkillDto = {},
  ): Promise<RedfoxSkillRunResult> {
    const dryRun = dto.dryRun !== false;
    const scope = await this.redfoxService.resolveScope(actor);
    const mapping = this.resolveMapping(dto);
    const skill = await this.resolveSkill(scope, dto, mapping);
    const operation =
      dto.operation ||
      `redfox.skill.${dryRun ? 'dry_run' : 'execute'}.${this.operationKey(
        dto,
        skill,
        mapping,
      )}`;
    const method = dto.method || mapping?.method || 'POST';
    const path = dto.path?.trim() || mapping?.path || null;
    const estimatedCostPoints = Math.max(
      0,
      Math.floor(dto.estimatedCostPoints ?? mapping?.estimatedCostPoints ?? 1),
    );

    if (dryRun) {
      return this.createDryRunResult({
        dto,
        skill,
        mapping,
        method,
        path,
        operation,
        estimatedCostPoints,
      });
    }

    if (!mapping) {
      throw new ForbiddenException('该数据能力暂未开放真实执行');
    }
    if (!path && mapping.skillHubRefs?.length) {
      return this.runSkillHubSkill({
        dto,
        skill,
        mapping,
        method,
        operation,
        estimatedCostPoints,
      });
    }

    if (!path) {
      throw new BadRequestException('该数据能力暂未配置可执行通道');
    }

    const connection = await this.redfoxService.getEffectiveConnection(scope);
    let callLogId: string | null = null;
    const payload = await this.redfoxClient.request<unknown>(
      scope,
      connection,
      {
        method,
        path,
        query: dto.query,
        body: dto.body ?? dto.input,
        bodyEncoding: dto.bodyEncoding || mapping.bodyEncoding || 'json',
        operation,
        skillCode: skill?.code || mapping.skillCode,
        estimatedCostPoints,
        confirmHighCost: true,
        requireApiKey: true,
        onCallLogRecorded: (log) => {
          callLogId = log.id;
        },
      },
    );
    this.assertRedfoxApiPayloadSuccess(payload, mapping.skillName);

    return {
      id: randomUUID(),
      dryRun: false,
      status: 'success',
      skill: this.skillSummary(skill, dto, mapping),
      endpoint: {
        method,
        path,
        operation,
      },
      estimatedCostPoints,
      requestPreview: {
        query: this.sanitize(dto.query),
        body: this.sanitize(dto.body ?? dto.input),
        input: this.sanitize(dto.input),
      },
      warnings: [],
      solutionRunId: dto.solutionRunId || null,
      solutionTaskId: dto.solutionTaskId || null,
      idempotencyKey: dto.idempotencyKey || null,
      callLogId,
      payloadSummary: this.summarizePayload(payload),
      payloadSample: this.samplePayload(payload),
      createdAt: new Date().toISOString(),
    };
  }

  private async runSkillHubSkill(input: {
    dto: RunRedfoxSkillDto;
    skill: RedfoxSkill | null;
    mapping: RedfoxSkillMapping;
    method: NonNullable<RedfoxClientRequestOptions['method']>;
    operation: string;
    estimatedCostPoints: number;
  }): Promise<RedfoxSkillRunResult> {
    const { dto, skill, mapping, method, operation, estimatedCostPoints } =
      input;
    if (!this.agentS) {
      throw new BadRequestException(
        '系统数据服务暂未开通，请联系管理员处理。',
      );
    }

    const skillHubRef = this.resolveSkillHubRef(mapping, dto);
    if (!skillHubRef) {
      throw new BadRequestException('该数据能力缺少执行通道');
    }

    const agentInput = this.buildSkillHubInput(dto);
    const metadata = {
      provider: 'redfox-skillhub',
      source: 'redfox-skillhub',
      skillCode: skillHubRef.skillCode,
      skillName: skillHubRef.skillName,
      skillNo: skillHubRef.skillNo,
      repoUrl: skillHubRef.repoUrl,
      requiresApiKey: skillHubRef.requiresApiKey,
      input: agentInput,
      outputObjects: mapping.outputObjects,
      solutionRunId: dto.solutionRunId || null,
      solutionTaskId: dto.solutionTaskId || null,
      idempotencyKey: dto.idempotencyKey || null,
      operation,
      estimatedCostPoints,
      mappingCode: mapping.code,
      mappingSkillCode: mapping.skillCode,
      mappingScenario: mapping.scenario,
    };

    const session = await this.agentS.createSession({
      session_name: `RedFox SkillHub · ${skillHubRef.skillName}`,
      task_type: 'redfox.skillhub.run',
      labels: ['redfox', 'skillhub', mapping.platform, mapping.scenario],
      metadata,
    });
    const sessionId = session.session.session_id;
    const run = await this.agentS.runTask(sessionId, {
      task_type: 'redfox.skillhub.run',
      instruction: this.buildSkillHubInstruction(mapping, skillHubRef, dto),
      risk_level: 'medium',
      metadata,
    });

    const eventsResult = await this.agentS
      .getEvents(sessionId)
      .catch(() => ({ events: [], next_seq: 0 }));
    const agentEvents = eventsResult.events as Array<{
      message?: string | null;
      event_type?: string;
    }>;
    const artifactsResult = await this.agentS
      .getArtifacts(sessionId)
      .catch(() => ({ artifacts: [] }));
    const agentArtifacts = artifactsResult.artifacts as Array<{
      artifact_id: string;
      filename: string;
      kind: string;
    }>;
    const primaryArtifact =
      agentArtifacts.find((artifact) =>
        /-(result|failed|preflight)\.json$/.test(artifact.filename),
      ) || agentArtifacts[0];
    const artifactPayload = primaryArtifact
      ? await this.agentS
          .getArtifact(sessionId, primaryArtifact.artifact_id)
          .then((result) => this.parseJsonContent(result.content))
          .catch(() => null)
      : null;
    const status = this.mapSkillHubRunStatus(run.status);
    const warnings = this.createSkillHubWarnings(status, agentEvents);

    return {
      id: randomUUID(),
      dryRun: false,
      status,
      skill: {
        code: skillHubRef.skillCode,
        name: skill?.name || skillHubRef.skillName,
        platform: skill?.platform || mapping.platform || null,
        enabled: Boolean(skill?.enabled) || status === 'success',
        resolved: true,
      },
      endpoint: {
        method,
        path: null,
        operation,
      },
      estimatedCostPoints,
      requestPreview: {
        query: this.sanitize(dto.query),
        body: this.sanitize(dto.body),
        input: this.sanitize(dto.input),
      },
      warnings,
      solutionRunId: dto.solutionRunId || null,
      solutionTaskId: dto.solutionTaskId || null,
      idempotencyKey: dto.idempotencyKey || null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        agentSessionId: sessionId,
        agentRunId: run.run_id,
        agentStatus: run.status,
        mappedStatus: status,
        eventCount: agentEvents.length,
        artifactCount: agentArtifacts.length,
        primaryArtifact: primaryArtifact
          ? {
              artifactId: primaryArtifact.artifact_id,
              filename: primaryArtifact.filename,
              kind: primaryArtifact.kind,
            }
          : null,
        mapping: {
          code: mapping.code,
          scenario: mapping.scenario,
          outputObjects: mapping.outputObjects,
        },
        skillHubRef: this.skillHubRefSummary(skillHubRef),
      },
      payloadSample: this.samplePayload(artifactPayload),
      createdAt: new Date().toISOString(),
    };
  }

  private async resolveSkill(
    scope: RedfoxScope,
    dto: RunRedfoxSkillDto,
    mapping: RedfoxSkillMapping | null,
  ) {
    const keyword = (
      mapping?.skillCode ||
      dto.skillCode ||
      dto.skillName ||
      mapping?.skillName ||
      ''
    ).trim();
    if (!keyword) return null;
    const result = await this.skills.list(scope, {
      keyword,
      page: 1,
      limit: 20,
    });
    return (
      result.items.find((item) => item.code === keyword) ||
      result.items.find((item) => item.skillNo === keyword) ||
      result.items.find((item) => item.name === keyword) ||
      result.items[0] ||
      null
    );
  }

  private resolveSkillHubRef(
    mapping: RedfoxSkillMapping,
    dto: RunRedfoxSkillDto,
  ): RedfoxSkillHubRef | null {
    const refs = mapping.skillHubRefs || [];
    if (!refs.length) return null;
    const requested = [
      dto.skillCode,
      dto.skillName,
      this.readString(dto.input?.skillCode),
      this.readString(dto.input?.skill_code),
      this.readString(dto.input?.skillNo),
      this.readString(dto.input?.skill_no),
    ]
      .map((value) => this.normalizeLookupKey(value))
      .filter(Boolean);
    if (requested.length) {
      const matched = refs.find((ref) =>
        [ref.skillCode, ref.skillNo, ref.skillName]
          .map((value) => this.normalizeLookupKey(value))
          .some((value) => requested.includes(value)),
      );
      if (matched) return matched;
    }
    return refs[0];
  }

  private buildSkillHubInput(dto: RunRedfoxSkillDto) {
    const input = this.recordOrEmpty(dto.input);
    const body = this.recordOrEmpty(dto.body);
    const query = this.recordOrEmpty(dto.query);
    return {
      ...query,
      ...body,
      ...input,
      query,
      body,
      input,
    };
  }

  private buildSkillHubInstruction(
    mapping: RedfoxSkillMapping,
    skillHubRef: RedfoxSkillHubRef,
    dto: RunRedfoxSkillDto,
  ) {
    const input = this.buildSkillHubInput(dto);
    const inputKeys = Object.keys(input)
      .filter((key) => !['query', 'body', 'input'].includes(key))
      .slice(0, 12);
    return [
      `执行 RedFox SkillHub 能力：${skillHubRef.skillName}`,
      `Skill Code：${skillHubRef.skillCode}`,
      `业务场景：${mapping.scenario}`,
      `输出对象：${mapping.outputObjects.join('、') || '未指定'}`,
      `输入字段：${inputKeys.join('、') || '无'}`,
    ].join('\n');
  }

  private mapSkillHubRunStatus(status: string): RedfoxSkillRunStatus {
    if (status === 'completed' || status === 'success') return 'success';
    if (status === 'blocked' || status === 'waiting_approval') return 'blocked';
    return 'failed';
  }

  private createSkillHubWarnings(
    status: RedfoxSkillRunStatus,
    events: Array<{ message?: string | null; event_type?: string }>,
  ) {
    const warnings: string[] = [];
    if (status === 'success') return warnings;
    const importantMessages = events
      .filter((event) =>
        ['SkillBlocked', 'SkillFailed', 'SkillPreflight'].includes(
          event.event_type || '',
        ),
      )
      .map((event) => event.message)
      .filter((message): message is string => Boolean(message));
    warnings.push(
      status === 'blocked'
        ? '本机数据能力暂未就绪。'
        : '本机数据能力执行失败。',
    );
    warnings.push(...importantMessages.slice(0, 3));
    return Array.from(new Set(warnings));
  }

  private skillHubRefSummary(ref: RedfoxSkillHubRef) {
    return {
      skillNo: ref.skillNo,
      skillCode: ref.skillCode,
      skillName: ref.skillName,
      url: ref.url,
      repoUrl: ref.repoUrl,
      requiresApiKey: ref.requiresApiKey,
    };
  }

  private parseJsonContent(content: unknown) {
    const text = Buffer.isBuffer(content)
      ? content.toString('utf8')
      : typeof content === 'string'
        ? content
        : '';
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { rawText: text };
    }
  }

  private recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
  }

  private normalizeLookupKey(value?: string | null) {
    return (value || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  private createDryRunResult(input: {
    dto: RunRedfoxSkillDto;
    skill: RedfoxSkill | null;
    mapping: RedfoxSkillMapping | null;
    method: NonNullable<RedfoxClientRequestOptions['method']>;
    path: string | null;
    operation: string;
    estimatedCostPoints: number;
  }): RedfoxSkillRunResult {
    const {
      dto,
      skill,
      mapping,
      method,
      path,
      operation,
      estimatedCostPoints,
    } = input;
    const warnings = [
      '当前先生成可检查的执行计划，不会直接外呼数据服务。',
      '真实执行前需要完成输入映射、成本授权和人工确认。',
    ];

    if (!mapping) {
      warnings.push('该数据能力暂未开放真实执行。');
    }

    if (!skill && mapping) {
      warnings.push('已匹配能力映射，但本地能力目录未同步或未命中。');
    } else if (!skill) {
      warnings.push('本地能力目录未解析到该能力。');
    } else if (!skill.enabled) {
      warnings.push('该数据能力尚未在当前账号范围启用。');
    }

    if (!path && mapping?.skillHubRefs?.length) {
      warnings.push('已匹配本机数据能力，真实执行需等待本机通道就绪。');
    } else if (!path) {
      warnings.push('尚未绑定可执行通道，只能停留在计划阶段。');
    }

    return {
      id: randomUUID(),
      dryRun: true,
      status: 'dry_run_ready',
      skill: this.skillSummary(skill, dto, mapping),
      endpoint: {
        method,
        path,
        operation,
      },
      estimatedCostPoints,
      requestPreview: {
        query: this.sanitize(dto.query),
        body: this.sanitize(dto.body),
        input: this.sanitize(dto.input),
      },
      warnings,
      solutionRunId: dto.solutionRunId || null,
      solutionTaskId: dto.solutionTaskId || null,
      idempotencyKey: dto.idempotencyKey || null,
      callLogId: null,
      payloadSummary: {
        kind: 'dry_run_plan',
        readyForRealExecution: Boolean(skill?.enabled && mapping && path),
        mapping: mapping
          ? {
              code: mapping.code,
              scenario: mapping.scenario,
              inputContract: mapping.inputContract,
              outputObjects: mapping.outputObjects,
              skillHubRefs: mapping.skillHubRefs || [],
              source: mapping.source,
            }
          : null,
      },
      payloadSample: null,
      createdAt: new Date().toISOString(),
    };
  }

  private skillSummary(
    skill: RedfoxSkill | null,
    dto: RunRedfoxSkillDto,
    mapping?: RedfoxSkillMapping | null,
  ) {
    return {
      code: skill?.code || mapping?.skillCode || dto.skillCode || null,
      name:
        skill?.name ||
        mapping?.skillName ||
        dto.skillName ||
        dto.skillCode ||
        '未指定数据能力',
      platform: skill?.platform || mapping?.platform || null,
      enabled: Boolean(skill?.enabled),
      resolved: Boolean(skill || mapping),
    };
  }

  private operationKey(
    dto: RunRedfoxSkillDto,
    skill: RedfoxSkill | null,
    mapping: RedfoxSkillMapping | null,
  ) {
    return (
      skill?.code ||
      mapping?.skillCode ||
      dto.skillCode ||
      dto.skillName ||
      'unknown'
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private resolveMapping(dto: RunRedfoxSkillDto) {
    return (
      findRedfoxSkillMapping(dto.skillCode) ||
      findRedfoxSkillMapping(dto.skillName) ||
      findRedfoxSkillMappingByPath(dto.path)
    );
  }

  private summarizePayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return { kind: 'array', count: payload.length };
    }
    if (!payload || typeof payload !== 'object') {
      return { kind: typeof payload };
    }
    const record = payload as Record<string, unknown>;
    const data = record.data;
    return {
      kind: 'object',
      keys: Object.keys(record).slice(0, 10),
      dataKind: Array.isArray(data) ? 'array' : typeof data,
      dataCount: Array.isArray(data) ? data.length : undefined,
    };
  }

  private assertRedfoxApiPayloadSuccess(payload: unknown, skillName: string) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const record = payload as Record<string, unknown>;
    const code = record.code;
    if (code === undefined || code === null || String(code) === '2000') {
      return;
    }
    const message =
      this.readString(record.msg) ||
      this.readString(record.message) ||
      this.readString(record.error) ||
      this.readString(record.errorMessage) ||
      '数据服务返回非成功状态';
    throw new BadRequestException(`${skillName} 执行失败：${message}`);
  }

  private samplePayload(value: unknown, depth = 0): unknown {
    if (depth > 5) return '[truncated]';
    const sanitized = this.sanitize(value);
    if (!sanitized || typeof sanitized !== 'object') {
      return this.truncateString(sanitized);
    }
    if (Array.isArray(sanitized)) {
      return sanitized
        .slice(0, 10)
        .map((item) => this.samplePayload(item, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(sanitized as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, this.samplePayload(item, depth + 1)]),
    );
  }

  private truncateString(value: unknown) {
    if (typeof value !== 'string') return value ?? null;
    return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  }

  private sanitize(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value ?? null;
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /api[-_]?key|token|secret|password/i.test(key)
          ? '[redacted]'
          : this.sanitize(item),
      ]),
    );
  }
}
