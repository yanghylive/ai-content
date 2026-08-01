import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentOptimizationService } from '../content-optimization/content-optimization.service';
import { ComplianceCheckDto } from './dto/compliance-check.dto';
import { QueryComplianceChecksDto } from './dto/query-compliance-checks.dto';
import type {
  ComplianceCheckResult,
  ComplianceChecksListResult,
  ComplianceFinding,
  CompliancePlatform,
  ComplianceRiskLevel,
  ComplianceTargetType,
  ComplianceWorkflowTrace,
} from './compliance.types';

type ComplianceRule = {
  term: string;
  category: ComplianceFinding['category'];
  riskLevel: ComplianceRiskLevel;
  reason: string;
  suggestion: string;
  replacement?: string;
  platforms?: CompliancePlatform[];
};

type RawComplianceCheckRow = {
  id: string;
  target_type: ComplianceTargetType;
  target_id?: string | null;
  platform: CompliancePlatform;
  risk_level: ComplianceRiskLevel;
  risk_score?: number | null;
  summary?: string | null;
  findings?: string | null;
  suggestions?: string | null;
  gate?: string | null;
  raw?: string | null;
  checked_at: string | Date;
};

const RISK_WEIGHT: Record<ComplianceRiskLevel, number> = {
  pass: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const RULES: ComplianceRule[] = [
  {
    term: '加微信',
    category: 'traffic_inducement',
    riskLevel: 'high',
    reason: '可能被平台识别为站外引流或私域诱导',
    suggestion: '改成平台内评论区或私信承接，并保留人工确认',
    replacement: '在评论区留言',
    platforms: ['xiaohongshu', 'douyin', 'all'],
  },
  {
    term: '私信领取',
    category: 'traffic_inducement',
    riskLevel: 'medium',
    reason: '可能触发诱导互动或批量私信风险',
    suggestion: '改成明确的咨询入口，避免承诺自动发送资料',
    replacement: '需要资料可以在评论区说明需求',
  },
  {
    term: '全网第一',
    category: 'absolute_claim',
    riskLevel: 'high',
    reason: '绝对化排名表达需要充分证据，否则有夸大宣传风险',
    suggestion: '改为可验证的范围或经验表达',
    replacement: '我们实测表现靠前',
  },
  {
    term: '百分百',
    category: 'absolute_claim',
    riskLevel: 'high',
    reason: '绝对化结果承诺容易带来发布风险',
    suggestion: '改成概率、趋势或案例口径',
    replacement: '多数情况下',
  },
  {
    term: '稳赚',
    category: 'absolute_claim',
    riskLevel: 'high',
    reason: '收益保证类表达风险高',
    suggestion: '删除收益保证，补充风险提示和适用条件',
    replacement: '有机会提升收益',
  },
  {
    term: '根治',
    category: 'medical_claim',
    riskLevel: 'high',
    reason: '医疗功效承诺属于高风险表达',
    suggestion: '避免医疗疗效承诺，必要时交由负责人复核',
    replacement: '改善',
  },
  {
    term: '最低价',
    category: 'price_claim',
    riskLevel: 'medium',
    reason: '价格极值表达需要证明材料',
    suggestion: '改成当前优惠或活动价，保留时间范围',
    replacement: '限时优惠价',
  },
  {
    term: '手机号',
    category: 'privacy',
    riskLevel: 'medium',
    reason: '评论和内容中收集个人信息需要明确授权和用途',
    suggestion: '避免公开收集隐私信息，改用平台允许的表单或人工确认',
  },
  {
    term: '免费领',
    category: 'traffic_inducement',
    riskLevel: 'low',
    reason: '福利表达需要补充条件，避免诱导互动',
    suggestion: '补充领取条件、数量和截止时间',
  },
];

@Injectable()
export class ComplianceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly contentOptimizationService: ContentOptimizationService,
  ) {}

  async onModuleInit() {
    await this.ensureComplianceTable();
  }

  async check(dto: ComplianceCheckDto): Promise<ComplianceCheckResult> {
    const content = this.cleanMultiline(
      [dto.title, dto.content].filter(Boolean).join('\n'),
    );
    const platform = this.normalizePlatform(dto.platform);
    const targetType = this.normalizeTargetType(dto.targetType);
    const findings = this.detectFindings(content, platform);
    const riskLevel = this.resolveRiskLevel(findings);
    const riskScore = this.toRiskScore(riskLevel, findings.length);

    const result: ComplianceCheckResult = {
      checkId: this.makeCheckId(),
      targetType,
      targetId: dto.targetId,
      platform,
      riskLevel,
      riskScore,
      summary: this.buildSummary(riskLevel, findings),
      findings,
      suggestions: this.buildSuggestions(riskLevel, findings),
      gate: this.buildGate(riskLevel, findings, dto.scenario),
      workflow: this.workflow(),
    };

    await this.persistCheck(result, {
      content,
      scenario: dto.scenario,
      title: dto.title,
    });

    if (dto.targetId) {
      await this.contentOptimizationService.markVersionCompliance({
        versionId: dto.targetId,
        checkId: result.checkId,
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        summary: result.summary,
        checkedAt: result.workflow.generatedAt,
      });
    }

    return result;
  }

  async list(
    query: QueryComplianceChecksDto,
  ): Promise<ComplianceChecksListResult> {
    const scope = await this.resolveScope();
    const conditions: Prisma.Sql[] = [
      Prisma.sql`user_id = ${scope.userId}`,
      scope.tenantId === null
        ? Prisma.sql`tenant_id IS NULL`
        : Prisma.sql`tenant_id = ${scope.tenantId}`,
    ];

    if (query.platform) {
      conditions.push(Prisma.sql`platform = ${query.platform}`);
    }

    if (query.riskLevel) {
      conditions.push(Prisma.sql`risk_level = ${query.riskLevel}`);
    }

    if (query.targetId) {
      conditions.push(Prisma.sql`target_id = ${query.targetId}`);
    }

    const rows = await this.prisma.$queryRaw<
      RawComplianceCheckRow[]
    >(Prisma.sql`
      SELECT * FROM compliance_checks
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY checked_at DESC
      LIMIT 50
    `);

    return {
      items: rows.map((row) => this.mapCheckRow(row)),
      total: rows.length,
      message: '已返回最近的发布前检查记录。',
      workflow: this.workflow(),
    };
  }

  private async persistCheck(
    result: ComplianceCheckResult,
    input: { content: string; title?: string; scenario?: string },
  ) {
    const scope = await this.resolveScope();
    const now = new Date().toISOString();
    await this.prisma.$executeRaw`
      INSERT INTO compliance_checks (
        id, tenant_id, user_id, target_type, target_id, platform, risk_level,
        risk_score, status, summary, findings, suggestions, gate, raw, checked_at,
        created_at, updated_at
      )
      VALUES (
        ${result.checkId}, ${scope.tenantId}, ${scope.userId}, ${result.targetType},
        ${result.targetId || null}, ${result.platform}, ${result.riskLevel},
        ${result.riskScore}, 'completed', ${result.summary},
        ${JSON.stringify(result.findings)}, ${JSON.stringify(result.suggestions)},
        ${JSON.stringify(result.gate)}, ${JSON.stringify({
          title: input.title,
          content: input.content,
          scenario: input.scenario,
          workflow: result.workflow,
        })}, ${now}, ${now}, ${now}
      )
    `;
  }

  private async ensureComplianceTable() {
    const databaseUrl = `${process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) return;

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS compliance_checks (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        material_id TEXT,
        topic_id TEXT,
        redfox_call_log_id TEXT,
        target_type TEXT NOT NULL,
        target_id TEXT,
        platform TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'unknown',
        risk_score INTEGER,
        status TEXT NOT NULL DEFAULT 'completed',
        summary TEXT,
        findings JSONB NOT NULL DEFAULT '[]',
        suggestions JSONB NOT NULL DEFAULT '[]',
        gate JSONB,
        raw JSONB,
        checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.addColumnIfMissing('compliance_checks', 'risk_score', 'INTEGER');
    await this.addColumnIfMissing('compliance_checks', 'summary', 'TEXT');
    await this.addColumnIfMissing('compliance_checks', 'gate', 'JSONB');
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS compliance_checks_user_checked_idx ON compliance_checks(user_id, checked_at)`,
    );
  }

  private async addColumnIfMissing(
    table: string,
    column: string,
    definition: string,
  ) {
    const columns = await this.prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info(${table})`,
    );
    if (columns.some((item) => item.name === column)) return;
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }

  private async resolveScope() {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('缺少登录上下文，不能执行合规检查。');
    }
    if (context?.user?.kaypalLocalOnly === true) {
      return { tenantId: null as string | null, userId };
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return {
      tenantId: tenantId as string | null,
      userId,
    };
  }

  private mapCheckRow(row: RawComplianceCheckRow): ComplianceCheckResult {
    const raw = this.parseJson<Record<string, unknown>>(row.raw, {});
    const workflow =
      (this.readRecord(raw.workflow) as ComplianceWorkflowTrace | null) ||
      ({
        ...this.workflow(),
        generatedAt: this.toIso(row.checked_at),
      } satisfies ComplianceWorkflowTrace);

    return {
      checkId: row.id,
      targetType: row.target_type,
      targetId: row.target_id || undefined,
      platform: row.platform,
      riskLevel: row.risk_level,
      riskScore: Number(row.risk_score || 0),
      summary: row.summary || this.buildSummary(row.risk_level, []),
      findings: this.parseJson<ComplianceFinding[]>(row.findings, []),
      suggestions: this.parseJson<string[]>(row.suggestions, []),
      gate: this.parseJson(
        row.gate,
        this.buildGate(row.risk_level, [], 'pre_publish'),
      ),
      workflow,
    };
  }

  private detectFindings(
    content: string,
    platform: CompliancePlatform,
  ): ComplianceFinding[] {
    return RULES.filter((rule) => this.ruleApplies(rule, platform))
      .map((rule, index) => {
        const startIndex = content.indexOf(rule.term);
        if (startIndex < 0) return null;
        return {
          id: `finding-${index + 1}`,
          category: rule.category,
          riskLevel: rule.riskLevel,
          matchedText: rule.term,
          reason: rule.reason,
          suggestion: rule.suggestion,
          replacement: rule.replacement,
          startIndex,
        };
      })
      .filter(Boolean) as ComplianceFinding[];
  }

  private ruleApplies(rule: ComplianceRule, platform: CompliancePlatform) {
    if (!rule.platforms || rule.platforms.length === 0) return true;
    return (
      platform === 'all' ||
      rule.platforms.includes(platform) ||
      rule.platforms.includes('all')
    );
  }

  private resolveRiskLevel(findings: ComplianceFinding[]): ComplianceRiskLevel {
    if (findings.length === 0) return 'pass';
    return findings.reduce<ComplianceRiskLevel>((highest, finding) => {
      return RISK_WEIGHT[finding.riskLevel] > RISK_WEIGHT[highest]
        ? finding.riskLevel
        : highest;
    }, 'low');
  }

  private toRiskScore(riskLevel: ComplianceRiskLevel, findingCount: number) {
    const base = { pass: 0, low: 28, medium: 58, high: 86 }[riskLevel];
    return Math.min(100, base + Math.max(0, findingCount - 1) * 4);
  }

  private buildSummary(
    riskLevel: ComplianceRiskLevel,
    findings: ComplianceFinding[],
  ) {
    if (riskLevel === 'pass')
      return '未命中当前基础规则，可进入下一步负责人确认或发布准备。';
    return `命中 ${findings.length} 个风险项，最高风险等级为${this.riskLabel(riskLevel)}，建议按命中项逐条改写后复查。`;
  }

  private buildSuggestions(
    riskLevel: ComplianceRiskLevel,
    findings: ComplianceFinding[],
  ) {
    if (riskLevel === 'pass') {
      return ['当前基础检查未发现明显风险，发布前仍建议按目标平台规则复核。'];
    }
    const replacementSuggestions = findings
      .filter((finding) => finding.replacement)
      .map(
        (finding) =>
          `将「${finding.matchedText}」改为「${finding.replacement}」`,
      );
    return [
      ...replacementSuggestions,
      '高风险表达应由负责人复核后再发布',
      '改写后再次检查，避免同类风险残留',
    ];
  }

  private riskLabel(riskLevel: ComplianceRiskLevel) {
    return {
      pass: '通过',
      low: '低风险',
      medium: '中风险',
      high: '高风险',
    }[riskLevel];
  }

  private buildGate(
    riskLevel: ComplianceRiskLevel,
    findings: ComplianceFinding[],
    scenario?: string,
  ) {
    const highRisk = riskLevel === 'high';
    const mediumRisk = riskLevel === 'medium';
    return {
      publishAllowed: !highRisk && !mediumRisk,
      manualReviewRequired: highRisk || mediumRisk,
      reason: highRisk
        ? '存在高风险命中项，发布前必须人工确认'
        : mediumRisk
          ? '存在中风险命中项，建议人工复核后再发布'
          : '当前未发现阻断级风险',
      nextActions: [
        ...(findings.length ? ['按命中项中的替换建议逐条改写'] : []),
        scenario === 'pre_publish'
          ? '保留本次检查结果，继续进入发布准备'
          : '如进入发布流程，请先做发布前检查',
        '重要内容发布前建议由负责人完成最终确认',
      ],
    };
  }

  private workflow(): ComplianceWorkflowTrace {
    return {
      source: 'local_rule',
      status: 'rule_screening',
      plannedSkill: '多平台违禁词检测 / 小红书、抖音、公众号违禁词检测',
      redfoxClientHook: '平台专属检测可继续增强命中项、替换建议和检查记录',
      generatedAt: new Date().toISOString(),
    };
  }

  private normalizePlatform(platform?: CompliancePlatform): CompliancePlatform {
    return platform || 'all';
  }

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private readRecord(value: unknown) {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  }

  private toIso(value?: string | Date | null) {
    if (!value) return new Date().toISOString();
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private normalizeTargetType(
    targetType?: ComplianceTargetType,
  ): ComplianceTargetType {
    return targetType || 'article';
  }

  private cleanMultiline(value: string) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  private makeCheckId() {
    return `compliance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
