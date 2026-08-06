import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AgentSService } from '../agent-s/agent-s.service';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';

/** 违禁词检测结果（发布向导「合规体检」用） */
export interface ComplianceViolation {
  word: string;
  suggestion?: string;
  reason?: string;
}

export interface ComplianceResult {
  pass: boolean;
  violations: ComplianceViolation[];
  platform: string;
  checkedAt: string;
  /** skill 未返回产物时的降级标记 */
  degraded?: boolean;
}

const COMPLIANCE_SKILL = 'multi-wordcheck';

/**
 * 发布前合规体检：
 * 调 RedFox 多平台违禁词检测技能 → 取 agent 产物 JSON → 解析违禁词列表
 * 结构参照 hot-topics（skillRunner + agentS 取 artifact），多字段宽容解析。
 */
@Injectable()
export class RedfoxComplianceService {
  private readonly logger = new Logger(RedfoxComplianceService.name);

  constructor(
    private readonly skillRunner: RedfoxSkillRunnerService,
    private readonly agentS: AgentSService,
  ) {}

  async checkProhibited(
    authUser: AuthenticatedUser,
    input: { text: string; platforms?: string[] },
  ): Promise<ComplianceResult> {
    try {
      const result = await this.skillRunner.runSkill(authUser, {
        skillCode: COMPLIANCE_SKILL,
        input: {
          text: input.text,
          platforms: input.platforms ?? ['douyin', 'xiaohongshu'],
        },
        dryRun: false,
      } as never);

      const summary = (result as { payloadSummary?: Record<string, unknown> })
        .payloadSummary;
      const sessionId = summary?.agentSessionId as string | undefined;
      const artifact = summary?.primaryArtifact as
        | { artifactId?: string }
        | undefined;
      if (!sessionId || !artifact?.artifactId) {
        this.logger.warn('违禁词技能未返回产物，降级为通过');
        return {
          pass: true,
          violations: [],
          platform: input.platforms?.join(',') || 'multi',
          checkedAt: new Date().toISOString(),
          degraded: true,
        };
      }

      const artifactResult = await this.agentS.getArtifact(
        sessionId,
        artifact.artifactId,
      );
      const payload = this.parseJsonContent(artifactResult.content);
      const violations = this.extractViolations(payload);

      return {
        pass: violations.length === 0,
        violations,
        platform: input.platforms?.join(',') || 'multi',
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`违禁词检测失败（降级为通过）: ${message}`);
      return {
        pass: true,
        violations: [],
        platform: input.platforms?.join(',') || 'multi',
        checkedAt: new Date().toISOString(),
        degraded: true,
      };
    }
  }

  private parseJsonContent(content: unknown): unknown {
    const text = Buffer.isBuffer(content)
      ? content.toString('utf-8')
      : String(content ?? '');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** 从产物 JSON 提取违禁词（宽容匹配：output.violations / output.risks / 顶层数组等） */
  private extractViolations(payload: unknown): ComplianceViolation[] {
    if (!payload || typeof payload !== 'object') return [];
    const root = payload as Record<string, unknown>;
    const output = root.output as Record<string, unknown> | undefined;

    const candidates: unknown[] = [];
    const listKeys = [
      'violations',
      'risks',
      'riskWords',
      'prohibitedWords',
      'bannedWords',
      'items',
      'results',
    ];
    for (const key of listKeys) {
      if (
        output &&
        Array.isArray(output[key]) &&
        (output[key] as unknown[]).length > 0
      ) {
        candidates.push(output[key]);
      }
      if (Array.isArray(root[key]) && (root[key] as unknown[]).length > 0) {
        candidates.push(root[key]);
      }
      const nested = root.data as Record<string, unknown> | undefined;
      if (
        nested &&
        Array.isArray(nested[key]) &&
        (nested[key] as unknown[]).length > 0
      ) {
        candidates.push(nested[key]);
      }
    }

    const list =
      (candidates[0] as Array<Record<string, unknown>> | undefined) ?? [];
    const seen = new Set<string>();
    const violations: ComplianceViolation[] = [];

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const word = String(
        entry.word ??
          entry.violation ??
          entry.term ??
          entry.bannedWord ??
          entry.keyword ??
          '',
      ).trim();
      if (!word || seen.has(word)) continue;
      seen.add(word);
      violations.push({
        word,
        suggestion: this.pickString(entry, [
          'suggestion',
          'recommendation',
          'replace',
          'replacement',
          'suggest',
        ]),
        reason: this.pickString(entry, [
          'reason',
          'reasoning',
          'risk',
          'riskLevel',
          'type',
          'description',
        ]),
      });
    }
    return violations.slice(0, 20);
  }

  private pickString(
    obj: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const v = obj[key];
      if (v != null && typeof v === 'string' && v.trim()) return v.trim();
      if (v != null && typeof v === 'number') return String(v);
    }
    return undefined;
  }
}
